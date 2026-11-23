import "server-only";

import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  notInArray,
  or,
  sql,
} from "drizzle-orm";

import { db } from "@/db";
import {
  boards,
  customers,
  feedbackPosts,
  inAppNotifications,
  notificationDeliveries,
  outboundMessageEvents,
  outboundMessages,
  surveyImpressions,
  surveyResponses,
  surveys,
  workspaces,
  widgetExperienceCompletions,
  widgetExperienceDismissals,
  widgetExperiences,
  widgetExperienceViews,
} from "@/db/schema";
import { emailSuppressions } from "@/db/schema/email";
import { enqueueJob } from "@/features/jobs/queue";
import { isEmailSuppressed } from "@/features/email/suppressions";
import { getWorkspacePlan } from "@/features/entitlements/entitlements";
import { planLimit } from "@/features/entitlements/plans";
import { resolvePublicPortalProduct } from "@/features/public/resolver";
import { evaluateSegmentById, getSegmentForProduct } from "@/features/segments/service";
import { slugify } from "@/lib/slug";

import {
  audienceFromTraits,
  matchesTargeting,
  normalizeTargetingRules,
  type TargetingContext,
  type TargetingRule,
} from "./rules";
import { reconcileOutboundAnalytics } from "./analytics";
import { npsTrend, summarizeNps } from "./nps";
import { toSurveyResponseCsv, type SurveyCsvRow } from "./responses-csv";
import { validateSurveyQuestions, visibleSurveyQuestions } from "./survey-logic";
import { extractKeywordThemes } from "./themes";
import {
  experienceScheduleProblem,
  experienceScheduleState,
  filterExperienceStepAudience,
  frequencyReached,
  normalizeExperienceContent,
} from "./experiences";
import { resolveExperiencePreview } from "./preview";
import {
  isInSendWindow,
  normalizeTimeZone,
  recurrenceKey,
  sendWindowProblem,
} from "./cadence";
import { normalizeOutboundTranslations, translatedOutbound } from "@/features/i18n/content";
import { workspaceBranding } from "@/db/schema/branding";
import type {
  ExperienceContent,
  SurveyQuestion,
} from "@/db/schema/engagement";

export type { ExperienceContent, SurveyQuestion };

const DAY_MS = 24 * 60 * 60 * 1000;

export type AdminResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

function failure(error: unknown, fallback: string) {
  if (error instanceof Error && /unique|duplicate/i.test(error.message)) {
    return { ok: false as const, error: "That slug is already used in this product." };
  }
  return {
    ok: false as const,
    error: error instanceof Error ? error.message : fallback,
  };
}

export { visibleSurveyQuestions } from "./survey-logic";

function normalizeQuestions(input: unknown): SurveyQuestion[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object")
    .map((value) => ({
      id:
        typeof value.id === "string" && /^[a-zA-Z0-9_-]{1,40}$/.test(value.id)
          ? value.id
          : `q_${Math.random().toString(36).slice(2, 9)}`,
      type: (value.type === "text" || value.type === "choice"
        ? value.type
        : "rating") as SurveyQuestion["type"],
      prompt: typeof value.prompt === "string" ? value.prompt.trim().slice(0, 300) : "",
      required: value.required === true,
      options: Array.isArray(value.options)
        ? value.options
            .filter((option): option is string => typeof option === "string")
            .map((option) => option.trim().slice(0, 120))
            .filter(Boolean)
            .slice(0, 12)
        : undefined,
      condition:
        value.condition &&
        typeof value.condition === "object" &&
        typeof (value.condition as Record<string, unknown>).questionId === "string" &&
        typeof (value.condition as Record<string, unknown>).equals === "string"
          ? {
              questionId: (value.condition as Record<string, string>).questionId!,
              equals: (value.condition as Record<string, string>).equals!,
            }
          : undefined,
    }))
    .filter((question) => question.prompt.length > 0)
    .slice(0, 20);
}

function parseQuestionsJson(value: unknown): SurveyQuestion[] {
  if (typeof value !== "string") return normalizeQuestions(value);
  try {
    return normalizeQuestions(JSON.parse(value) as unknown);
  } catch {
    return [];
  }
}

async function customerTraits(customerId: string | null | undefined, workspaceId: string) {
  if (!customerId) return {};
  const rows = await db
    .select({ traits: customers.traits })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.workspaceId, workspaceId)))
    .limit(1);
  return audienceFromTraits(rows[0]?.traits);
}

// ---------------------------------------------------------------------------
// Surveys
// ---------------------------------------------------------------------------

export async function listSurveys(productId: string) {
  const responseCounts = db
    .select({
      surveyId: surveyResponses.surveyId,
      total: count().as("total"),
    })
    .from(surveyResponses)
    .groupBy(surveyResponses.surveyId)
    .as("response_counts");

  return db
    .select({
      id: surveys.id,
      name: surveys.name,
      slug: surveys.slug,
      kind: surveys.kind,
      status: surveys.status,
      createdAt: surveys.createdAt,
      responseCount: sql<number>`coalesce(${responseCounts.total}, 0)::int`,
    })
    .from(surveys)
    .leftJoin(responseCounts, eq(responseCounts.surveyId, surveys.id))
    .where(eq(surveys.productId, productId))
    .orderBy(desc(surveys.createdAt));
}

export async function getSurveyAdmin(productId: string, surveyId: string) {
  const rows = await db
    .select()
    .from(surveys)
    .where(and(eq(surveys.id, surveyId), eq(surveys.productId, productId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createSurvey(input: {
  workspaceId: string;
  productId: string;
  name: string;
  slug?: string | undefined;
  kind: "nps" | "csat" | "custom";
  questions: unknown;
  audience: unknown;
  suppressDays: number;
  status?: "draft" | "active" | undefined;
  createdBy: string | null;
}): Promise<AdminResult<{ surveyId: string }>> {
  const name = input.name.trim().slice(0, 160);
  if (name.length < 2) return { ok: false, error: "Give the survey a name." };
  const questions = parseQuestionsJson(input.questions);
  if (questions.length === 0) {
    return { ok: false, error: "Add at least one question." };
  }
  const branchProblem = validateSurveyQuestions(questions, input.kind);
  if (!branchProblem.ok) return { ok: false, error: branchProblem.error };
  const slug = (slugify(input.slug?.trim() || name) || "survey").slice(0, 80);
  const clampDays = Math.min(Math.max(Math.trunc(input.suppressDays || 0), 0), 365);

  try {
    const inserted = await db
      .insert(surveys)
      .values({
        workspaceId: input.workspaceId,
        productId: input.productId,
        name,
        slug,
        kind: input.kind,
        status: input.status ?? "draft",
        questions,
        audience: normalizeTargetingRules(input.audience),
        suppressDays: clampDays,
        createdBy: input.createdBy,
      })
      .returning({ id: surveys.id });
    const surveyId = inserted[0]?.id;
    return surveyId
      ? { ok: true, surveyId }
      : { ok: false, error: "Could not create the survey." };
  } catch (error) {
    return failure(error, "Could not create the survey.");
  }
}

export async function setSurveyStatus(
  productId: string,
  surveyId: string,
  status: "draft" | "active" | "paused",
): Promise<AdminResult> {
  const updated = await db
    .update(surveys)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(surveys.id, surveyId), eq(surveys.productId, productId)))
    .returning({ id: surveys.id });
  return updated[0] ? { ok: true } : { ok: false, error: "Survey not found." };
}

export async function deleteSurvey(productId: string, surveyId: string): Promise<AdminResult> {
  const removed = await db
    .delete(surveys)
    .where(and(eq(surveys.id, surveyId), eq(surveys.productId, productId)))
    .returning({ id: surveys.id });
  return removed[0] ? { ok: true } : { ok: false, error: "Survey not found." };
}

export async function getPublicSurvey(input: {
  workspaceSlug: string;
  productSlug: string;
  slug: string;
  customerId?: string | null;
  context?: TargetingContext;
}): Promise<{
  id: string;
  name: string;
  slug: string;
  kind: "nps" | "csat" | "custom";
  questions: SurveyQuestion[];
} | null> {
  const tenant = await resolvePublicPortalProduct(input);
  if (!tenant) return null;
  const rows = await db
    .select()
    .from(surveys)
    .where(
      and(
        eq(surveys.productId, tenant.product.id),
        eq(surveys.slug, input.slug),
        eq(surveys.status, "active"),
      ),
    )
    .limit(1);
  const survey = rows[0];
  if (!survey) return null;

  let customerId = input.customerId ?? null;
  if (customerId) {
    const owned = await db
      .select({ id: customers.id })
      .from(customers)
      .where(
        and(eq(customers.id, customerId), eq(customers.workspaceId, tenant.workspace.id)),
      )
      .limit(1);
    customerId = owned[0]?.id ?? null;
  }
  const attributes = await customerTraits(customerId, tenant.workspace.id);
  // Page, time, selector and event rules are delivery triggers that only the
  // browser can see. They decide when to prompt, never whether a direct link
  // works; attribute rules are the server-enforceable audience.
  if (
    !matchesTargeting(attributeRules(survey.audience), {
      ...input.context,
      attributes,
    })
  ) {
    return null;
  }

  return {
    id: survey.id,
    name: survey.name,
    slug: survey.slug,
    kind: survey.kind,
    questions: survey.questions,
  };
}

function validateAnswers(
  survey: { kind: "nps" | "csat" | "custom"; questions: SurveyQuestion[] },
  answers: Record<string, string>,
): { ok: true; score: number | null } | { ok: false; error: string } {
  const visible = visibleSurveyQuestions(survey.questions, answers);
  let score: number | null = null;
  for (const question of visible) {
    const answer = answers[question.id]?.trim() ?? "";
    if (question.required && answer.length === 0) {
      return { ok: false, error: `Answer “${question.prompt}”.` };
    }
    if (answer.length === 0) continue;
    if (question.type === "rating") {
      const value = Number.parseInt(answer, 10);
      const max = survey.kind === "nps" ? 10 : 5;
      if (!Number.isInteger(value) || value < (survey.kind === "nps" ? 0 : 1) || value > max) {
        return { ok: false, error: "Choose a valid rating." };
      }
      if (score === null) score = value;
    }
    if (question.type === "choice" && question.options && !question.options.includes(answer)) {
      return { ok: false, error: "Choose one of the listed answers." };
    }
  }
  return { ok: true, score };
}

export async function submitSurveyResponse(input: {
  workspaceSlug: string;
  productSlug: string;
  slug: string;
  visitorKey: string;
  answers: Record<string, string>;
  optIn: boolean;
  customerId?: string | null;
}): Promise<
  | { state: "not_found" }
  | { state: "suppressed" }
  | { state: "invalid"; error: string }
  | { state: "ready"; responseId: string; score: number | null }
> {
  const tenant = await resolvePublicPortalProduct(input);
  if (!tenant) return { state: "not_found" };
  const visitorKey = input.visitorKey.trim().slice(0, 200);
  if (visitorKey.length < 8) return { state: "invalid", error: "A visitor key is required." };

  const rows = await db
    .select()
    .from(surveys)
    .where(
      and(
        eq(surveys.productId, tenant.product.id),
        eq(surveys.slug, input.slug),
        eq(surveys.status, "active"),
      ),
    )
    .limit(1);
  const survey = rows[0];
  if (!survey) return { state: "not_found" };

  let customerId = input.customerId ?? null;
  if (customerId) {
    const owned = await db
      .select({ id: customers.id })
      .from(customers)
      .where(
        and(eq(customers.id, customerId), eq(customers.workspaceId, tenant.workspace.id)),
      )
      .limit(1);
    customerId = owned[0]?.id ?? null;
  }
  const attributes = await customerTraits(customerId, tenant.workspace.id);
  if (!matchesTargeting(attributeRules(survey.audience), { attributes })) {
    return { state: "not_found" };
  }

  const cutoff =
    survey.suppressDays > 0 ? new Date(Date.now() - survey.suppressDays * DAY_MS) : null;
  if (cutoff) {
    const previous = await db
      .select({ id: surveyResponses.id })
      .from(surveyResponses)
      .where(
        and(
          eq(surveyResponses.surveyId, survey.id),
          gte(surveyResponses.createdAt, cutoff),
          customerId
            ? or(
                eq(surveyResponses.visitorKey, visitorKey),
                eq(surveyResponses.customerId, customerId),
              )
            : eq(surveyResponses.visitorKey, visitorKey),
        ),
      )
      .limit(1);
    if (previous[0]) return { state: "suppressed" };
  }

  const answers: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.answers)) {
    if (typeof value === "string" && key.length <= 60) {
      answers[key] = value.slice(0, 4000);
    }
  }
  const validated = validateAnswers(survey, answers);
  if (!validated.ok) return { state: "invalid", error: validated.error };

  // Only answers whose branch was actually on screen are stored. Without this
  // a visitor who changes "yes" to "no" would keep the abandoned follow-up
  // answer and the export would attribute it to them.
  const stored: Record<string, string> = {};
  for (const question of visibleSurveyQuestions(survey.questions, answers)) {
    const answer = answers[question.id];
    if (answer !== undefined) stored[question.id] = answer;
  }

  let feedbackPostId: string | null = null;
  if (input.optIn && customerId) {
    const boardRows = await db
      .select({ id: boards.id })
      .from(boards)
      .where(
        and(
          eq(boards.productId, tenant.product.id),
          eq(boards.visibility, "public"),
          isNull(boards.archivedAt),
        ),
      )
      .orderBy(asc(boards.position), asc(boards.name))
      .limit(1);
    const board = boardRows[0];
    if (board) {
      const summary = visibleSurveyQuestions(survey.questions, stored)
        .filter((question) => (stored[question.id] ?? "").length > 0)
        .map((question) => `${question.prompt}\n${stored[question.id]}`)
        .join("\n\n")
        .slice(0, 4000);
      const inserted = await db
        .insert(feedbackPosts)
        .values({
          productId: tenant.product.id,
          boardId: board.id,
          authorCustomerId: customerId,
          title: survey.name.slice(0, 160),
          body: summary,
          category: "question",
          source: "in_app",
          privacy: "public",
        })
        .returning({ id: feedbackPosts.id });
      feedbackPostId = inserted[0]?.id ?? null;
    }
  }

  const created = await db
    .insert(surveyResponses)
    .values({
      surveyId: survey.id,
      workspaceId: tenant.workspace.id,
      productId: tenant.product.id,
      customerId,
      visitorKey,
      score: validated.score,
      answers: stored,
      optedIn: input.optIn,
      feedbackPostId,
    })
    .returning({ id: surveyResponses.id });

  const responseId = created[0]?.id;
  return responseId
    ? { state: "ready", responseId, score: validated.score }
    : { state: "invalid", error: "Could not save the response." };
}

function surveyMonthStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export type SurveyImpressionUsage = {
  used: number;
  limit: number | null;
  remaining: number | null;
};

/**
 * Monthly proactive-survey impressions for the workspace.
 *
 * The allowance is workspace-wide and lives in the plan catalogue beside the
 * other counted limits, so a plan change moves this number too. `null` means
 * unlimited; `used` is always reported, because an operator should see the
 * number before a downgrade turns it into a hard stop.
 */
export async function getSurveyImpressionUsage(
  workspaceId: string,
): Promise<SurveyImpressionUsage> {
  const [plan, rows] = await Promise.all([
    getWorkspacePlan(workspaceId),
    db
      .select({ value: count() })
      .from(surveyImpressions)
      .where(
        and(
          eq(surveyImpressions.workspaceId, workspaceId),
          gte(surveyImpressions.createdAt, surveyMonthStart()),
        ),
      ),
  ]);
  const limit = planLimit(plan, "monthlySurveyImpressions");
  const used = rows[0]?.value ?? 0;
  return {
    used,
    limit,
    remaining: limit === null ? null : Math.max(0, limit - used),
  };
}

export async function getSurveyResults(productId: string, surveyId: string) {
  const survey = await getSurveyAdmin(productId, surveyId);
  if (!survey) return null;
  const responses = await db
    .select()
    .from(surveyResponses)
    .where(eq(surveyResponses.surveyId, surveyId))
    .orderBy(desc(surveyResponses.createdAt))
    .limit(5000);

  const ratings = responses
    .map((response) => response.score)
    .filter((value): value is number => typeof value === "number");
  const average =
    ratings.length === 0
      ? null
      : Math.round((ratings.reduce((sum, value) => sum + value, 0) / ratings.length) * 10) / 10;

  const nps = survey.kind === "nps" ? summarizeNps(ratings) : null;
  const trend =
    survey.kind === "nps"
      ? npsTrend(
          responses.map((response) => ({
            createdAt: response.createdAt,
            score: response.score,
          })),
        )
      : [];

  const answerCounts = new Map<string, Map<string, number>>();
  for (const response of responses) {
    for (const [questionId, answer] of Object.entries(response.answers)) {
      const bucket = answerCounts.get(questionId) ?? new Map<string, number>();
      bucket.set(answer, (bucket.get(answer) ?? 0) + 1);
      answerCounts.set(questionId, bucket);
    }
  }

  const textQuestions = survey.questions.filter((question) => question.type === "text");
  const textAnswers = responses.flatMap((response) =>
    textQuestions
      .map((question) => response.answers[question.id])
      .filter((value): value is string => typeof value === "string" && value.trim() !== ""),
  );

  const audienceRows = await db
    .select({ id: customers.id, traits: customers.traits })
    .from(customers)
    .where(
      and(
        eq(customers.workspaceId, survey.workspaceId),
        isNull(customers.bannedAt),
      ),
    );
  const eligibleIds = new Set(
    audienceRows
      .filter((row) =>
        matchesTargeting(attributeRules(survey.audience), {
          attributes: audienceFromTraits(row.traits),
        }),
      )
      .map((row) => row.id),
  );
  const eligibleCount = eligibleIds.size;
  const customerResponses = responses.filter(
    (response) => response.customerId && eligibleIds.has(response.customerId),
  ).length;
  const responseRate =
    eligibleCount > 0
      ? Math.min(100, Math.round((customerResponses / eligibleCount) * 1000) / 10)
      : null;

  return {
    survey,
    responseCount: responses.length,
    eligibleCount,
    responseRate,
    average,
    nps,
    npsTrend: trend,
    optedInCount: responses.filter((response) => response.optedIn).length,
    feedbackCount: responses.filter((response) => response.feedbackPostId).length,
    textAnswerCount: textAnswers.length,
    themes: extractKeywordThemes(textAnswers),
    impressions: await getSurveyImpressionUsage(survey.workspaceId),
    recent: responses.slice(0, 50).map((response) => ({
      id: response.id,
      score: response.score,
      createdAt: response.createdAt,
      optedIn: response.optedIn,
      answers: response.answers,
    })),
    questionResults: survey.questions.map((question) => {
      const answers = Array.from(answerCounts.get(question.id)?.entries() ?? [])
        .map(([answer, total]) => ({ answer, total }))
        .sort((left, right) => right.total - left.total);
      return {
        ...question,
        answered: answers.reduce((sum, entry) => sum + entry.total, 0),
        answers,
      };
    }),
  };
}

/** One response in full, scoped to its survey and product. */
export async function getSurveyResponse(
  productId: string,
  surveyId: string,
  responseId: string,
) {
  const survey = await getSurveyAdmin(productId, surveyId);
  if (!survey) return null;
  const rows = await db
    .select({
      response: surveyResponses,
      customerEmail: customers.email,
    })
    .from(surveyResponses)
    .leftJoin(customers, eq(customers.id, surveyResponses.customerId))
    .where(
      and(
        eq(surveyResponses.id, responseId),
        eq(surveyResponses.surveyId, surveyId),
        eq(surveyResponses.productId, productId),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    survey,
    response: row.response,
    customerEmail: row.customerEmail,
    visibleQuestions: visibleSurveyQuestions(survey.questions, row.response.answers),
  };
}

/** Every response plus the ready-to-send CSV, for the export route. */
export async function exportSurveyResponses(productId: string, surveyId: string) {
  const survey = await getSurveyAdmin(productId, surveyId);
  if (!survey) return null;
  const rows = await db
    .select()
    .from(surveyResponses)
    .where(eq(surveyResponses.surveyId, surveyId))
    .orderBy(asc(surveyResponses.createdAt))
    .limit(50_000);
  const csvRows: SurveyCsvRow[] = rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt,
    score: row.score,
    optedIn: row.optedIn,
    feedbackPostId: row.feedbackPostId,
    customerId: row.customerId,
    visitorKey: row.visitorKey,
    answers: row.answers,
  }));
  return {
    survey,
    count: rows.length,
    csv: toSurveyResponseCsv({
      kind: survey.kind,
      questions: survey.questions,
      rows: csvRows,
    }),
  };
}

export type PublicSurveyPrompt = {
  id: string;
  kind: "banner";
  name: string;
  audience: TargetingRule[];
  defaultLocale: "en";
  dismissDays: number;
  /** Same-origin path the iframe posts to only once the prompt is rendered. */
  impressionPath: string;
  content: Record<
    string,
    { title: string; body: string; ctaLabel: string; ctaUrl: string }
  >;
};

const SURVEY_PROMPT_COPY = {
  en: {
    nps: "How likely are you to recommend us? One question, under a minute.",
    csat: "How satisfied are you with us? One question, under a minute.",
    custom: "We would love your feedback. It takes under a minute.",
  },
  es: {
    nps: "¿Qué probabilidad hay de que nos recomiendes? Una pregunta, menos de un minuto.",
    csat: "¿Qué tan satisfecho estás con nosotros? Una pregunta, menos de un minuto.",
    custom: "Nos encantaría conocer tu opinión. Menos de un minuto.",
  },
} as const;

/**
 * Surveys the widget may show proactively on this page load.
 *
 * Attribute targeting is evaluated here, where the customer traits are known;
 * page, time-on-page, selector and event rules travel with the item so the
 * loader can evaluate them in the browser. An impression is written before the
 * item is returned, capped by the plan's monthly allowance, deduplicated per
 * visitor and UTC day, and skipped for a survey this person already answered
 * inside its own suppression window.
 *
 * A cap of `null` means unlimited. When the cap is reached nothing is returned
 * and nothing is written; direct survey links keep working.
 */
function attributeRules(rules: TargetingRule[]): TargetingRule[] {
  return rules.filter((rule) => rule.type === "attribute");
}

export async function publicSurveyPrompts(input: {
  workspaceSlug: string;
  productSlug: string;
  visitorKey: string;
  customerId?: string | null;
}): Promise<PublicSurveyPrompt[]> {
  const tenant = await resolvePublicPortalProduct(input);
  if (!tenant) return [];
  const visitorKey = input.visitorKey.trim().slice(0, 200);
  if (visitorKey.length < 8) return [];

  const allowance = await getSurveyImpressionUsage(tenant.workspace.id);
  if (allowance.remaining !== null && allowance.remaining <= 0) return [];

  const rows = await db
    .select()
    .from(surveys)
    .where(
      and(eq(surveys.productId, tenant.product.id), eq(surveys.status, "active")),
    )
    .orderBy(desc(surveys.createdAt))
    .limit(5);
  if (rows.length === 0) return [];

  const attributes = await customerTraits(input.customerId, tenant.workspace.id);
  const candidates = rows.filter((row) =>
    matchesTargeting(attributeRules(row.audience), { attributes }),
  );
  if (candidates.length === 0) return [];

  const previous = await db
    .select({
      surveyId: surveyResponses.surveyId,
      createdAt: surveyResponses.createdAt,
    })
    .from(surveyResponses)
    .where(
      and(
        inArray(
          surveyResponses.surveyId,
          candidates.map((row) => row.id),
        ),
        input.customerId
          ? or(
              eq(surveyResponses.visitorKey, visitorKey),
              eq(surveyResponses.customerId, input.customerId),
            )
          : eq(surveyResponses.visitorKey, visitorKey),
      ),
    );
  const lastAnswer = new Map<string, number>();
  for (const row of previous) {
    const at = row.createdAt.getTime();
    if (at > (lastAnswer.get(row.surveyId) ?? 0)) lastAnswer.set(row.surveyId, at);
  }

  const shownOn = new Date().toISOString().slice(0, 10);
  const shownRows = await db
    .select({ surveyId: surveyImpressions.surveyId })
    .from(surveyImpressions)
    .where(
      and(
        inArray(
          surveyImpressions.surveyId,
          candidates.map((row) => row.id),
        ),
        eq(surveyImpressions.visitorKey, visitorKey),
        eq(surveyImpressions.shownOn, shownOn),
      ),
    );
  const shownToday = new Set(shownRows.map((row) => row.surveyId));
  const prompts: PublicSurveyPrompt[] = [];

  for (const row of candidates) {
    if (shownToday.has(row.id)) continue;
    const answeredAt = lastAnswer.get(row.id);
    if (
      answeredAt &&
      Date.now() - answeredAt < Math.max(0, row.suppressDays) * DAY_MS
    ) {
      continue;
    }

    // The impression is written by `recordSurveyImpression` after the loader
    // has actually rendered the prompt. Returning it here is only an offer; a
    // page or event rule may still filter it out on this page.
    prompts.push({
      id: `survey:${row.id}`,
      kind: "banner",
      name: row.name,
      audience: row.audience,
      defaultLocale: "en",
      dismissDays: Math.max(row.suppressDays, 1),
      impressionPath: `/api/public/surveys/${row.slug}/impressions`,
      content: {
        en: {
          title: row.name,
          body: SURVEY_PROMPT_COPY.en[row.kind],
          ctaLabel: "Take the survey",
          ctaUrl: `/p/${tenant.workspace.slug}/${tenant.product.slug}/surveys/${row.slug}`,
        },
        es: {
          title: row.name,
          body: SURVEY_PROMPT_COPY.es[row.kind],
          ctaLabel: "Responder la encuesta",
          ctaUrl: `/p/${tenant.workspace.slug}/${tenant.product.slug}/surveys/${row.slug}`,
        },
      },
    });
  }

  return prompts;
}

/**
 * Count one proactive impression, once the prompt was actually rendered.
 *
 * The iframe calls this, so the visitor cookie is first-party and the write is
 * same-origin. The unique key makes a duplicate post harmless, and the plan
 * cap is re-checked here because the offer was made before the render.
 */
export async function recordSurveyImpression(input: {
  workspaceSlug: string;
  productSlug: string;
  slug: string;
  visitorKey: string;
}): Promise<{ ok: boolean; capped: boolean }> {
  const tenant = await resolvePublicPortalProduct(input);
  if (!tenant) return { ok: false, capped: false };
  const visitorKey = input.visitorKey.trim().slice(0, 200);
  if (visitorKey.length < 8) return { ok: false, capped: false };

  const rows = await db
    .select({ id: surveys.id })
    .from(surveys)
    .where(
      and(
        eq(surveys.productId, tenant.product.id),
        eq(surveys.slug, input.slug),
        eq(surveys.status, "active"),
      ),
    )
    .limit(1);
  const survey = rows[0];
  if (!survey) return { ok: false, capped: false };

  const allowance = await getSurveyImpressionUsage(tenant.workspace.id);
  if (allowance.remaining !== null && allowance.remaining <= 0) {
    return { ok: false, capped: true };
  }

  const inserted = await db
    .insert(surveyImpressions)
    .values({
      surveyId: survey.id,
      workspaceId: tenant.workspace.id,
      productId: tenant.product.id,
      visitorKey,
      shownOn: new Date().toISOString().slice(0, 10),
      source: "widget",
    })
    .onConflictDoNothing()
    .returning({ id: surveyImpressions.id });

  return { ok: Boolean(inserted[0]), capped: false };
}

export async function listActiveSurveys(productId: string) {
  return db
    .select({
      id: surveys.id,
      name: surveys.name,
      slug: surveys.slug,
      kind: surveys.kind,
      questions: surveys.questions,
    })
    .from(surveys)
    .where(and(eq(surveys.productId, productId), eq(surveys.status, "active")))
    .orderBy(desc(surveys.createdAt))
    .limit(5);
}

// ---------------------------------------------------------------------------
// Tours and banners
// ---------------------------------------------------------------------------

export async function listExperiences(productId: string) {
  const dismissalCounts = db
    .select({
      experienceId: widgetExperienceDismissals.experienceId,
      total: count().as("total"),
    })
    .from(widgetExperienceDismissals)
    .groupBy(widgetExperienceDismissals.experienceId)
    .as("dismissal_counts");
  const completionCounts = db
    .select({
      experienceId: widgetExperienceCompletions.experienceId,
      total: count().as("total"),
    })
    .from(widgetExperienceCompletions)
    .groupBy(widgetExperienceCompletions.experienceId)
    .as("completion_counts");
  const viewCounts = db
    .select({
      experienceId: widgetExperienceViews.experienceId,
      total: count().as("total"),
    })
    .from(widgetExperienceViews)
    .groupBy(widgetExperienceViews.experienceId)
    .as("view_counts");

  return db
    .select({
      id: widgetExperiences.id,
      name: widgetExperiences.name,
      kind: widgetExperiences.kind,
      status: widgetExperiences.status,
      defaultLocale: widgetExperiences.defaultLocale,
      dismissDays: widgetExperiences.dismissDays,
      audience: widgetExperiences.audience,
      content: widgetExperiences.content,
      scheduleStart: widgetExperiences.scheduleStart,
      scheduleEnd: widgetExperiences.scheduleEnd,
      frequencyCap: widgetExperiences.frequencyCap,
      frequencyWindowDays: widgetExperiences.frequencyWindowDays,
      previewExpiresAt: widgetExperiences.previewExpiresAt,
      createdAt: widgetExperiences.createdAt,
      dismissals: sql<number>`coalesce("dismissal_counts"."total", 0)::int`,
      completions: sql<number>`coalesce("completion_counts"."total", 0)::int`,
      views: sql<number>`coalesce("view_counts"."total", 0)::int`,
    })
    .from(widgetExperiences)
    .leftJoin(
      dismissalCounts,
      eq(dismissalCounts.experienceId, widgetExperiences.id),
    )
    .leftJoin(
      completionCounts,
      eq(completionCounts.experienceId, widgetExperiences.id),
    )
    .leftJoin(viewCounts, eq(viewCounts.experienceId, widgetExperiences.id))
    .where(eq(widgetExperiences.productId, productId))
    .orderBy(desc(widgetExperiences.createdAt));
}

export async function createExperience(input: {
  workspaceId: string;
  productId: string;
  name: string;
  kind: "tour" | "banner";
  content: unknown;
  audience: unknown;
  defaultLocale: string;
  dismissDays: number;
  scheduleStart?: Date | null;
  scheduleEnd?: Date | null;
  frequencyCap?: number;
  frequencyWindowDays?: number;
  status: "draft" | "active";
  createdBy: string | null;
}): Promise<AdminResult<{ experienceId: string }>> {
  const name = input.name.trim().slice(0, 160);
  if (name.length < 2) return { ok: false, error: "Give the experience a name." };
  const parsed = normalizeExperienceContent(input.content, input.kind, input.defaultLocale);
  if (!parsed.ok) return parsed;
  const scheduleStart = input.scheduleStart ?? null;
  const scheduleEnd = input.scheduleEnd ?? null;
  const scheduleProblem = experienceScheduleProblem(scheduleStart, scheduleEnd);
  if (scheduleProblem) return { ok: false, error: scheduleProblem };
  try {
    const inserted = await db
      .insert(widgetExperiences)
      .values({
        workspaceId: input.workspaceId,
        productId: input.productId,
        name,
        kind: input.kind,
        status: input.status,
        content: parsed.content,
        audience: normalizeTargetingRules(input.audience),
        defaultLocale: parsed.locale,
        dismissDays: Math.min(Math.max(Math.trunc(input.dismissDays || 0), 0), 365),
        scheduleStart,
        scheduleEnd,
        frequencyCap: Math.min(Math.max(Math.trunc(input.frequencyCap || 0), 0), 100),
        frequencyWindowDays: Math.min(
          Math.max(Math.trunc(input.frequencyWindowDays || 7), 1),
          365,
        ),
        createdBy: input.createdBy,
      })
      .returning({ id: widgetExperiences.id });
    const experienceId = inserted[0]?.id;
    return experienceId
      ? { ok: true, experienceId }
      : { ok: false, error: "Could not create the experience." };
  } catch (error) {
    return failure(error, "Could not create the experience.");
  }
}

/** Edit copy, locale variants, audience, schedule and frequency in one save. */
export async function updateExperience(input: {
  productId: string;
  experienceId: string;
  name: string;
  content: unknown;
  audience: unknown;
  defaultLocale: string;
  dismissDays: number;
  scheduleStart: Date | null;
  scheduleEnd: Date | null;
  frequencyCap: number;
  frequencyWindowDays: number;
}): Promise<AdminResult> {
  const name = input.name.trim().slice(0, 160);
  if (name.length < 2) return { ok: false, error: "Give the experience a name." };
  const existing = await db
    .select({ id: widgetExperiences.id, kind: widgetExperiences.kind })
    .from(widgetExperiences)
    .where(
      and(
        eq(widgetExperiences.id, input.experienceId),
        eq(widgetExperiences.productId, input.productId),
      ),
    )
    .limit(1);
  if (!existing[0]) return { ok: false, error: "Experience not found." };

  const parsed = normalizeExperienceContent(
    input.content,
    existing[0].kind,
    input.defaultLocale,
  );
  if (!parsed.ok) return parsed;
  const scheduleProblem = experienceScheduleProblem(input.scheduleStart, input.scheduleEnd);
  if (scheduleProblem) return { ok: false, error: scheduleProblem };

  await db
    .update(widgetExperiences)
    .set({
      name,
      content: parsed.content,
      audience: normalizeTargetingRules(input.audience),
      defaultLocale: parsed.locale,
      dismissDays: Math.min(Math.max(Math.trunc(input.dismissDays || 0), 0), 365),
      scheduleStart: input.scheduleStart,
      scheduleEnd: input.scheduleEnd,
      frequencyCap: Math.min(Math.max(Math.trunc(input.frequencyCap || 0), 0), 100),
      frequencyWindowDays: Math.min(
        Math.max(Math.trunc(input.frequencyWindowDays || 7), 1),
        365,
      ),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(widgetExperiences.id, input.experienceId),
        eq(widgetExperiences.productId, input.productId),
      ),
    );
  return { ok: true };
}

export async function setExperienceStatus(
  productId: string,
  experienceId: string,
  status: "draft" | "active" | "paused",
): Promise<AdminResult> {
  const updated = await db
    .update(widgetExperiences)
    .set({ status, updatedAt: new Date() })
    .where(
      and(
        eq(widgetExperiences.id, experienceId),
        eq(widgetExperiences.productId, productId),
      ),
    )
    .returning({ id: widgetExperiences.id });
  return updated[0] ? { ok: true } : { ok: false, error: "Experience not found." };
}

export async function deleteExperience(
  productId: string,
  experienceId: string,
): Promise<AdminResult> {
  const removed = await db
    .delete(widgetExperiences)
    .where(
      and(
        eq(widgetExperiences.id, experienceId),
        eq(widgetExperiences.productId, productId),
      ),
    )
    .returning({ id: widgetExperiences.id });
  return removed[0] ? { ok: true } : { ok: false, error: "Experience not found." };
}

export async function publicExperiences(input: {
  workspaceSlug: string;
  productSlug: string;
  visitorKey: string;
  customerId?: string | null | undefined;
  context?: TargetingContext | undefined;
  /** A live preview link returns exactly that saved experience, unfiltered. */
  previewToken?: string | null;
}) {
  const tenant = await resolvePublicPortalProduct(input);
  if (!tenant) return [];

  if (input.previewToken) {
    const preview = await resolveExperiencePreview(input.previewToken);
    if (!preview || preview.productId !== tenant.product.id) return [];
    return [
      {
        id: preview.experienceId,
        kind: preview.kind,
        name: preview.name,
        content: preview.content,
        audience: [],
        defaultLocale: preview.defaultLocale,
        dismissDays: preview.dismissDays,
      },
    ];
  }

  const rows = await db
    .select()
    .from(widgetExperiences)
    .where(
      and(
        eq(widgetExperiences.productId, tenant.product.id),
        eq(widgetExperiences.status, "active"),
      ),
    )
    .orderBy(asc(widgetExperiences.createdAt));
  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);
  const customerId = input.customerId ?? null;
  const visitorScope = customerId
    ? or(
        eq(widgetExperienceDismissals.visitorKey, input.visitorKey),
        eq(widgetExperienceDismissals.customerId, customerId),
      )
    : eq(widgetExperienceDismissals.visitorKey, input.visitorKey);

  const dismissals = await db
    .select({
      experienceId: widgetExperienceDismissals.experienceId,
      dismissedAt: widgetExperienceDismissals.dismissedAt,
    })
    .from(widgetExperienceDismissals)
    .where(and(inArray(widgetExperienceDismissals.experienceId, ids), visitorScope));
  const dismissed = new Map<string, Date>();
  for (const row of dismissals) {
    const current = dismissed.get(row.experienceId);
    if (!current || current.getTime() < row.dismissedAt.getTime()) {
      dismissed.set(row.experienceId, row.dismissedAt);
    }
  }

  const windowDays = Math.max(
    1,
    ...rows.map((row) => row.frequencyWindowDays),
  );
  const viewScope = customerId
    ? or(
        eq(widgetExperienceViews.visitorKey, input.visitorKey),
        eq(widgetExperienceViews.customerId, customerId),
      )
    : eq(widgetExperienceViews.visitorKey, input.visitorKey);
  const viewRows = rows.some((row) => row.frequencyCap > 0)
    ? await db
        .select({
          experienceId: widgetExperienceViews.experienceId,
          createdAt: widgetExperienceViews.createdAt,
        })
        .from(widgetExperienceViews)
        .where(
          and(
            inArray(widgetExperienceViews.experienceId, ids),
            viewScope,
            gte(widgetExperienceViews.createdAt, new Date(Date.now() - windowDays * DAY_MS)),
          ),
        )
    : [];
  const views = new Map<string, Date[]>();
  for (const row of viewRows) {
    const list = views.get(row.experienceId) ?? [];
    list.push(row.createdAt);
    views.set(row.experienceId, list);
  }

  const attributes = await customerTraits(customerId, tenant.workspace.id);
  const now = Date.now();

  return rows
    .filter((row) => {
      const state = experienceScheduleState(row, now);
      return state === "live" || state === "always";
    })
    .filter((row) =>
      matchesTargeting(
        row.audience.filter((rule) => rule.type === "attribute"),
        { ...input.context, attributes },
      ),
    )
    .filter((row) => {
      const when = dismissed.get(row.id);
      return !when || now - when.getTime() > row.dismissDays * DAY_MS;
    })
    .filter((row) => {
      return !frequencyReached(
        views.get(row.id) ?? [],
        row.frequencyCap,
        row.frequencyWindowDays,
        now,
      );
    })
    .map((row) => ({
      id: row.id,
      kind: row.kind,
      name: row.name,
      content: filterExperienceStepAudience(row.content, attributes),
      audience: row.audience,
      defaultLocale: row.defaultLocale,
      dismissDays: row.dismissDays,
      viewPath: `/api/public/widget/experiences/${row.id}/view`,
    }));
}

/** Count one rendered banner or tour, at most once per visitor and UTC day. */
export async function recordExperienceView(input: {
  workspaceSlug: string;
  productSlug: string;
  experienceId: string;
  visitorKey: string;
  customerId?: string | null;
}): Promise<boolean> {
  const tenant = await resolvePublicPortalProduct(input);
  if (!tenant) return false;
  const visitorKey = input.visitorKey.trim().slice(0, 200);
  if (visitorKey.length < 8) return false;

  const rows = await db
    .select({ id: widgetExperiences.id })
    .from(widgetExperiences)
    .where(
      and(
        eq(widgetExperiences.id, input.experienceId),
        eq(widgetExperiences.productId, tenant.product.id),
        eq(widgetExperiences.status, "active"),
      ),
    )
    .limit(1);
  if (!rows[0]) return false;

  const inserted = await db
    .insert(widgetExperienceViews)
    .values({
      experienceId: input.experienceId,
      workspaceId: tenant.workspace.id,
      productId: tenant.product.id,
      visitorKey,
      customerId: input.customerId ?? null,
      shownOn: new Date().toISOString().slice(0, 10),
    })
    .onConflictDoNothing()
    .returning({ id: widgetExperienceViews.id });
  return Boolean(inserted[0]);
}

export async function dismissExperience(input: {
  workspaceSlug: string;
  productSlug: string;
  experienceId: string;
  visitorKey: string;
  customerId?: string | null;
}): Promise<boolean> {
  // Survey prompts share the experience list but use a `survey:` id. Their
  // suppression is local (the loader stores it) and the response window is
  // checked server-side, so there is no experience row to touch — and passing
  // the prefixed id to a uuid column would fail.
  if (input.experienceId.startsWith("survey:")) return true;

  const tenant = await resolvePublicPortalProduct(input);
  if (!tenant) return false;
  const rows = await db
    .select({ id: widgetExperiences.id })
    .from(widgetExperiences)
    .where(
      and(
        eq(widgetExperiences.id, input.experienceId),
        eq(widgetExperiences.productId, tenant.product.id),
      ),
    )
    .limit(1);
  if (!rows[0]) return false;
  await db
    .insert(widgetExperienceDismissals)
    .values({
      experienceId: input.experienceId,
      workspaceId: tenant.workspace.id,
      visitorKey: input.visitorKey.slice(0, 200),
      customerId: input.customerId ?? null,
    })
    .onConflictDoNothing();
  return true;
}

/**
 * Record a completed tour once per recipient and suppress it like a dismissal.
 *
 * The unique key makes a repeated Done click idempotent, so reports count
 * recipients rather than button presses. Both writes share a transaction: a
 * completion that was not also dismissed could reappear on the next load.
 */
export async function completeExperience(input: {
  workspaceSlug: string;
  productSlug: string;
  experienceId: string;
  visitorKey: string;
  customerId?: string | null;
}): Promise<boolean> {
  const tenant = await resolvePublicPortalProduct(input);
  if (!tenant) return false;
  const rows = await db
    .select({ id: widgetExperiences.id })
    .from(widgetExperiences)
    .where(
      and(
        eq(widgetExperiences.id, input.experienceId),
        eq(widgetExperiences.productId, tenant.product.id),
      ),
    )
    .limit(1);
  if (!rows[0]) return false;

  const visitorKey = input.visitorKey.slice(0, 200);
  await db.transaction(async (tx) => {
    await tx
      .insert(widgetExperienceCompletions)
      .values({
        experienceId: input.experienceId,
        workspaceId: tenant.workspace.id,
        productId: tenant.product.id,
        visitorKey,
        customerId: input.customerId ?? null,
      })
      .onConflictDoNothing();
    await tx
      .insert(widgetExperienceDismissals)
      .values({
        experienceId: input.experienceId,
        workspaceId: tenant.workspace.id,
        visitorKey,
        customerId: input.customerId ?? null,
      })
      .onConflictDoNothing();
  });
  return true;
}

// ---------------------------------------------------------------------------
// Targeted outbound messages
// ---------------------------------------------------------------------------

export async function listOutboundMessages(productId: string) {
  const messages = await db
    .select()
    .from(outboundMessages)
    .where(eq(outboundMessages.productId, productId))
    .orderBy(desc(outboundMessages.createdAt));

  if (messages.length === 0) return [];
  const ids = messages.map((message) => message.id);
  const deliveryCounts = await db
    .select({
      outboundMessageId: notificationDeliveries.outboundMessageId,
      status: notificationDeliveries.status,
      total: count(),
    })
    .from(notificationDeliveries)
    .where(inArray(notificationDeliveries.outboundMessageId, ids))
    .groupBy(
      notificationDeliveries.outboundMessageId,
      notificationDeliveries.status,
    );
  const eventCounts = await db
    .select({
      messageId: outboundMessageEvents.messageId,
      type: outboundMessageEvents.type,
      total: count(),
    })
    .from(outboundMessageEvents)
    .where(inArray(outboundMessageEvents.messageId, ids))
    .groupBy(outboundMessageEvents.messageId, outboundMessageEvents.type);

  return messages.map((message) => ({
    ...message,
    deliveries: deliveryCounts
      .filter((row) => row.outboundMessageId === message.id)
      .map((row) => ({ status: row.status, total: row.total })),
    events: eventCounts
      .filter((row) => row.messageId === message.id)
      .map((row) => ({ type: row.type, total: row.total })),
  }));
}

async function recentOutboundCounts(input: {
  workspaceId: string;
  customerIds: string[];
  windowDays: number;
}): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (input.customerIds.length === 0 || input.windowDays <= 0) return result;
  const cutoff = new Date(Date.now() - input.windowDays * DAY_MS);

  const [emailRows, inAppRows] = await Promise.all([
    db
      .select({
        customerId: notificationDeliveries.recipientCustomerId,
        total: count(),
      })
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.workspaceId, input.workspaceId),
          isNotNull(notificationDeliveries.outboundMessageId),
          inArray(notificationDeliveries.recipientCustomerId, input.customerIds),
          notInArray(notificationDeliveries.status, ["skipped", "failed"]),
          gte(notificationDeliveries.createdAt, cutoff),
        ),
      )
      .groupBy(notificationDeliveries.recipientCustomerId),
    db
      .select({ customerId: outboundMessageEvents.customerId, total: count() })
      .from(outboundMessageEvents)
      .where(
        and(
          eq(outboundMessageEvents.workspaceId, input.workspaceId),
          eq(outboundMessageEvents.type, "sent"),
          inArray(outboundMessageEvents.customerId, input.customerIds),
          gte(outboundMessageEvents.createdAt, cutoff),
        ),
      )
      .groupBy(outboundMessageEvents.customerId),
  ]);

  for (const row of [...emailRows, ...inAppRows]) {
    if (!row.customerId) continue;
    result.set(row.customerId, (result.get(row.customerId) ?? 0) + row.total);
  }
  return result;
}

export type OutboundAudiencePreview = {
  total: number;
  eligible: number;
  excluded: number;
  banned: number;
  outside_targeting: number;
  segment_mismatch: number;
  no_email: number;
  suppressed: number;
  frequency_capped: number;
  frequencyCap: number;
  frequencyWindowDays: number;
};

/**
 * Preview exactly what a message would reach before it sends. The same rules
 * are applied at delivery time, including the workspace frequency cap, so an
 * excluded-because count is never only cosmetic.
 */
export async function previewOutboundAudience(input: {
  workspaceId: string;
  productId: string;
  audience: unknown;
  segmentId?: string | null;
  channel: "email" | "in_app";
}): Promise<OutboundAudiencePreview> {
  const [customerRows, settingsRows] = await Promise.all([
    db
      .select({
        id: customers.id,
        email: customers.email,
        emailNormalized: customers.emailNormalized,
        traits: customers.traits,
        bannedAt: customers.bannedAt,
      })
      .from(customers)
      .where(eq(customers.workspaceId, input.workspaceId))
      .limit(5_000),
    db
      .select({
        cap: workspaces.outboundFrequencyCap,
        windowDays: workspaces.outboundFrequencyWindowDays,
      })
      .from(workspaces)
      .where(eq(workspaces.id, input.workspaceId))
      .limit(1),
  ]);

  const rules = normalizeTargetingRules(input.audience);
  const segmentIds = input.segmentId
    ? ((await evaluateSegmentById({
        workspaceId: input.workspaceId,
        productId: input.productId,
        segmentId: input.segmentId,
      }))?.customerIds ?? new Set<string>())
    : null;

  const normalizedEmails = customerRows
    .map((customer) => customer.emailNormalized)
    .filter((value): value is string => Boolean(value));
  const suppressed = new Set<string>();
  if (input.channel === "email" && normalizedEmails.length > 0) {
    const suppressedRows = await db
      .select({ emailNormalized: emailSuppressions.emailNormalized })
      .from(emailSuppressions)
      .where(
        and(
          eq(emailSuppressions.workspaceId, input.workspaceId),
          inArray(emailSuppressions.emailNormalized, normalizedEmails),
        ),
      );
    for (const row of suppressedRows) suppressed.add(row.emailNormalized);
  }

  const cap = settingsRows[0]?.cap ?? 0;
  const windowDays = settingsRows[0]?.windowDays ?? 7;
  const frequencyCounts =
    cap > 0
      ? await recentOutboundCounts({
          workspaceId: input.workspaceId,
          customerIds: customerRows.map((customer) => customer.id),
          windowDays,
        })
      : new Map<string, number>();

  const preview: OutboundAudiencePreview = {
    total: customerRows.length,
    eligible: 0,
    excluded: 0,
    banned: 0,
    outside_targeting: 0,
    segment_mismatch: 0,
    no_email: 0,
    suppressed: 0,
    frequency_capped: 0,
    frequencyCap: cap,
    frequencyWindowDays: windowDays,
  };

  for (const customer of customerRows) {
    if (customer.bannedAt) {
      preview.banned += 1;
    } else if (
      !matchesTargeting(rules, {
        attributes: audienceFromTraits(customer.traits),
      })
    ) {
      preview.outside_targeting += 1;
    } else if (input.segmentId && !segmentIds?.has(customer.id)) {
      preview.segment_mismatch += 1;
    } else if (input.channel === "email" && !customer.email) {
      preview.no_email += 1;
    } else if (
      input.channel === "email" &&
      customer.emailNormalized &&
      suppressed.has(customer.emailNormalized)
    ) {
      preview.suppressed += 1;
    } else if (cap > 0 && (frequencyCounts.get(customer.id) ?? 0) >= cap) {
      preview.frequency_capped += 1;
    } else {
      preview.eligible += 1;
    }
  }
  preview.excluded = preview.total - preview.eligible;
  return preview;
}

export async function updateOutboundCadence(input: {
  productId: string;
  messageId: string;
  channel: "email" | "in_app";
  recurrence: "one_shot" | "daily" | "weekly";
  windowStart: string;
  windowEnd: string;
  timezone: string;
  scheduleStart: Date | null;
  scheduleEnd: Date | null;
}): Promise<AdminResult> {
  const windowProblem = sendWindowProblem(input.windowStart, input.windowEnd);
  if (windowProblem) return { ok: false, error: windowProblem };
  if (
    input.scheduleStart &&
    input.scheduleEnd &&
    input.scheduleEnd.getTime() <= input.scheduleStart.getTime()
  ) {
    return { ok: false, error: "The end must be after the start." };
  }

  const updated = await db
    .update(outboundMessages)
    .set({
      channel: input.channel,
      recurrence: input.recurrence,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      timezone: normalizeTimeZone(input.timezone),
      scheduleStart: input.scheduleStart,
      scheduleEnd: input.scheduleEnd,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(outboundMessages.id, input.messageId),
        eq(outboundMessages.productId, input.productId),
      ),
    )
    .returning({ id: outboundMessages.id });
  return updated[0]
    ? { ok: true }
    : { ok: false, error: "Message not found." };
}

export async function setOutboundFrequencyCaps(input: {
  workspaceId: string;
  cap: number;
  windowDays: number;
}): Promise<AdminResult> {
  const cap = Math.min(Math.max(Math.trunc(input.cap), 0), 100);
  const windowDays = Math.min(Math.max(Math.trunc(input.windowDays), 1), 365);
  await db
    .update(workspaces)
    .set({
      outboundFrequencyCap: cap,
      outboundFrequencyWindowDays: windowDays,
      updatedAt: new Date(),
    })
    .where(eq(workspaces.id, input.workspaceId));
  return { ok: true };
}

export async function createOutboundMessage(input: {
  workspaceId: string;
  productId: string;
  name: string;
  channel: "email" | "in_app";
  title: string;
  body: string;
  translations?: unknown;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  audience: unknown;
  segmentId?: string | null;
  scheduleStart: Date | null;
  scheduleEnd: Date | null;
  windowStart: string;
  windowEnd: string;
  timezone: string;
  recurrence: "one_shot" | "daily" | "weekly";
  status: "draft" | "scheduled";
  createdBy: string | null;
}): Promise<AdminResult<{ messageId: string }>> {
  const name = input.name.trim().slice(0, 160);
  const title = input.title.trim().slice(0, 200);
  const body = input.body.trim().slice(0, 4000);
  if (name.length < 2 || title.length < 2 || body.length < 2) {
    return { ok: false, error: "Add a name, title and message." };
  }
  const windowProblem = sendWindowProblem(input.windowStart, input.windowEnd);
  if (windowProblem) return { ok: false, error: windowProblem };

  const segmentId = input.segmentId ?? null;
  if (segmentId) {
    const segment = await getSegmentForProduct({
      workspaceId: input.workspaceId,
      productId: input.productId,
      segmentId,
    });
    if (!segment) {
      return { ok: false, error: "That segment does not belong to this product." };
    }
  }

  try {
    const inserted = await db
      .insert(outboundMessages)
      .values({
        workspaceId: input.workspaceId,
        productId: input.productId,
        name,
        channel: input.channel,
        status: input.status,
        title,
        body,
        translations: normalizeOutboundTranslations(input.translations),
        ctaLabel: input.ctaLabel?.trim().slice(0, 80) || null,
        ctaUrl: input.ctaUrl?.trim().slice(0, 2000) || null,
        audience: normalizeTargetingRules(input.audience),
        segmentId,
        scheduleStart: input.scheduleStart,
        scheduleEnd: input.scheduleEnd,
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
        timezone: normalizeTimeZone(input.timezone),
        recurrence: input.recurrence,
        createdBy: input.createdBy,
      })
      .returning({ id: outboundMessages.id });
    const messageId = inserted[0]?.id;
    return messageId
      ? { ok: true, messageId }
      : { ok: false, error: "Could not create the message." };
  } catch (error) {
    return failure(error, "Could not create the message.");
  }
}

export async function setOutboundStatus(
  productId: string,
  messageId: string,
  status: "draft" | "scheduled" | "active" | "paused" | "completed",
): Promise<AdminResult> {
  const updated = await db
    .update(outboundMessages)
    .set({ status, updatedAt: new Date() })
    .where(
      and(
        eq(outboundMessages.id, messageId),
        eq(outboundMessages.productId, productId),
      ),
    )
    .returning({ id: outboundMessages.id });
  return updated[0] ? { ok: true } : { ok: false, error: "Message not found." };
}

export async function deleteOutboundMessage(
  productId: string,
  messageId: string,
): Promise<AdminResult> {
  const removed = await db
    .delete(outboundMessages)
    .where(
      and(
        eq(outboundMessages.id, messageId),
        eq(outboundMessages.productId, productId),
      ),
    )
    .returning({ id: outboundMessages.id });
  return removed[0] ? { ok: true } : { ok: false, error: "Message not found." };
}

export async function publicOutboundMessages(input: {
  workspaceSlug: string;
  productSlug: string;
  customerId?: string | null | undefined;
  context?: TargetingContext | undefined;
  locale?: string | undefined;
}) {
  const tenant = await resolvePublicPortalProduct(input);
  if (!tenant) return [];
  const now = new Date();
  const rows = await db
    .select()
    .from(outboundMessages)
    .where(
      and(
        eq(outboundMessages.productId, tenant.product.id),
        eq(outboundMessages.channel, "in_app"),
        eq(outboundMessages.status, "active"),
      ),
    )
    .orderBy(desc(outboundMessages.createdAt))
    .limit(20);
  const attributes = await customerTraits(input.customerId, tenant.workspace.id);
  const branding = await db
    .select({ enabled: workspaceBranding.contentTranslationEnabled })
    .from(workspaceBranding)
    .where(eq(workspaceBranding.workspaceId, tenant.workspace.id))
    .limit(1);
  const translationsEnabled = Boolean(branding[0]?.enabled);
  const segmentCache = new Map<string, Set<string> | null>();
  const visible: typeof rows = [];

  for (const row of rows) {
    if (row.scheduleStart && row.scheduleStart > now) continue;
    if (row.scheduleEnd && row.scheduleEnd < now) continue;
    if (!matchesTargeting(row.audience, { ...input.context, attributes })) continue;

    // A segment is a saved customer list; an anonymous visitor never matches
    // one, because activity and traits belong to an identified customer.
    if (row.segmentId) {
      if (!input.customerId) continue;
      if (!segmentCache.has(row.segmentId)) {
        const audience = await evaluateSegmentById({
          workspaceId: tenant.workspace.id,
          productId: tenant.product.id,
          segmentId: row.segmentId,
        });
        segmentCache.set(row.segmentId, audience ? audience.customerIds : null);
      }
      const ids = segmentCache.get(row.segmentId);
      if (!ids?.has(input.customerId)) continue;
    }

    visible.push(row);
  }

  return visible.map((row) => ({
    ...row,
    ...translatedOutbound(row, input.locale, translationsEnabled),
  }));
}

export async function recordOutboundEvent(input: {
  workspaceSlug: string;
  productSlug: string;
  messageId: string;
  type: "opened" | "clicked" | "converted" | "dismissed";
  customerId?: string | null;
}): Promise<boolean> {
  const tenant = await resolvePublicPortalProduct(input);
  if (!tenant) return false;
  const rows = await db
    .select({ id: outboundMessages.id })
    .from(outboundMessages)
    .where(
      and(
        eq(outboundMessages.id, input.messageId),
        eq(outboundMessages.productId, tenant.product.id),
      ),
    )
    .limit(1);
  if (!rows[0]) return false;
  await db.insert(outboundMessageEvents).values({
    messageId: input.messageId,
    workspaceId: tenant.workspace.id,
    customerId: input.customerId ?? null,
    type: input.type,
  });
  return true;
}

export async function getOutboundAnalytics(productId: string, messageId: string) {
  const message = await db
    .select()
    .from(outboundMessages)
    .where(
      and(
        eq(outboundMessages.id, messageId),
        eq(outboundMessages.productId, productId),
      ),
    )
    .limit(1);
  if (!message[0]) return null;
  const [deliveries, deliveryRecipients, sentRecipients, eventRows, events] = await Promise.all([
    db
      .select({ status: notificationDeliveries.status, total: count() })
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.outboundMessageId, messageId))
      .groupBy(notificationDeliveries.status),
    db
      .selectDistinct({ customerId: notificationDeliveries.recipientCustomerId })
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.outboundMessageId, messageId),
          eq(notificationDeliveries.status, "sent"),
        ),
      ),
    db
      .selectDistinct({ customerId: outboundMessageEvents.customerId })
      .from(outboundMessageEvents)
      .where(
        and(
          eq(outboundMessageEvents.messageId, messageId),
          eq(outboundMessageEvents.type, "sent"),
        ),
      ),
    db
      .select({ type: outboundMessageEvents.type, customerId: outboundMessageEvents.customerId })
      .from(outboundMessageEvents)
      .where(eq(outboundMessageEvents.messageId, messageId)),
    db
      .select({ type: outboundMessageEvents.type, total: count() })
      .from(outboundMessageEvents)
      .where(eq(outboundMessageEvents.messageId, messageId))
      .groupBy(outboundMessageEvents.type),
  ]);
  return {
    message: message[0],
    deliveries,
    events,
    reconciliation: reconcileOutboundAnalytics({
      deliveries,
      deliveryRecipients: deliveryRecipients
        .map((row) => row.customerId)
        .filter((id): id is string => Boolean(id)),
      sentRecipients: sentRecipients
        .map((row) => row.customerId)
        .filter((id): id is string => Boolean(id)),
      events: eventRows,
    }),
  };
}

export async function scheduleDueOutboundMessages(now: Date = new Date()) {
  const rows = await db
    .select()
    .from(outboundMessages)
    .where(inArray(outboundMessages.status, ["active", "scheduled"]));
  let queued = 0;
  for (const message of rows) {
    if (message.scheduleStart && message.scheduleStart > now) continue;
    if (message.scheduleEnd && message.scheduleEnd < now) {
      await db
        .update(outboundMessages)
        .set({ status: "completed", updatedAt: now })
        .where(eq(outboundMessages.id, message.id));
      continue;
    }
    if (
      !isInSendWindow(
        now,
        message.windowStart,
        message.windowEnd,
        message.timezone,
      )
    ) {
      continue;
    }
    if (message.status === "scheduled") {
      await db
        .update(outboundMessages)
        .set({ status: "active", updatedAt: now })
        .where(eq(outboundMessages.id, message.id));
    }
    const key = recurrenceKey(message.recurrence, now);
    if (message.lastRunKey === key) continue;
    await enqueueJob({
      type: "deliver_outbound_message",
      payload: { messageId: message.id, runKey: key },
      dedupeKey: `outbound:${message.id}:${key}`,
    });
    await db
      .update(outboundMessages)
      .set({
        lastRunKey: key,
        updatedAt: now,
      })
      .where(eq(outboundMessages.id, message.id));
    queued += 1;
  }
  return { checked: rows.length, queued };
}

export async function deliverOutboundMessage(
  messageId: string,
  runKey: string,
): Promise<{ queued: number; skipped: number; channel: string } | null> {
  const rows = await db
    .select()
    .from(outboundMessages)
    .where(eq(outboundMessages.id, messageId))
    .limit(1);
  const message = rows[0];
  if (!message) return null;

  const recipients = await db
    .select({
      id: customers.id,
      email: customers.email,
      traits: customers.traits,
    })
    .from(customers)
    .where(
      and(
        eq(customers.workspaceId, message.workspaceId),
        isNull(customers.bannedAt),
      ),
    )
    .limit(2000);

  const segmentCustomerIds = message.segmentId
    ? ((await evaluateSegmentById({
        workspaceId: message.workspaceId,
        productId: message.productId,
        segmentId: message.segmentId,
      }))?.customerIds ?? new Set<string>())
    : null;

  const matching = recipients.filter(
    (customer) =>
      matchesTargeting(message.audience, {
        attributes: audienceFromTraits(customer.traits),
      }) && (!segmentCustomerIds || segmentCustomerIds.has(customer.id)),
  );

  const settingsRows = await db
    .select({
      cap: workspaces.outboundFrequencyCap,
      windowDays: workspaces.outboundFrequencyWindowDays,
    })
    .from(workspaces)
    .where(eq(workspaces.id, message.workspaceId))
    .limit(1);
  const frequencyCap = settingsRows[0]?.cap ?? 0;
  const frequencyWindowDays = settingsRows[0]?.windowDays ?? 7;
  const frequencyCounts =
    frequencyCap > 0
      ? await recentOutboundCounts({
          workspaceId: message.workspaceId,
          customerIds: matching.map((customer) => customer.id),
          windowDays: frequencyWindowDays,
        })
      : new Map<string, number>();

  const branding = await db
    .select({ enabled: workspaceBranding.contentTranslationEnabled })
    .from(workspaceBranding)
    .where(eq(workspaceBranding.workspaceId, message.workspaceId))
    .limit(1);
  const translationsEnabled = Boolean(branding[0]?.enabled);

  let queued = 0;
  let skipped = 0;
  for (const customer of matching) {
    if (
      frequencyCap > 0 &&
      (frequencyCounts.get(customer.id) ?? 0) >= frequencyCap
    ) {
      skipped += 1;
      continue;
    }
    if (message.channel === "email") {
      if (!customer.email) {
        skipped += 1;
        continue;
      }
      if (await isEmailSuppressed(message.workspaceId, customer.email)) {
        skipped += 1;
        continue;
      }
      const delivery = await db
        .insert(notificationDeliveries)
        .values({
          workspaceId: message.workspaceId,
          productId: message.productId,
          channel: "email",
          template: "outbound_message",
          outboundMessageId: message.id,
          recipientCustomerId: customer.id,
          recipientEmail: customer.email,
          recipientEmailNormalized: customer.email.toLowerCase(),
          dedupeKey: `outbound_message:${message.id}:${runKey}:${customer.id}`,
        })
        .onConflictDoNothing()
        .returning({ id: notificationDeliveries.id });
      if (delivery[0]) {
        await enqueueJob({
          type: "send_email",
          payload: { deliveryId: delivery[0].id },
          dedupeKey: `outbound-email:${delivery[0].id}`,
        });
        await db.insert(outboundMessageEvents).values({
          messageId: message.id,
          workspaceId: message.workspaceId,
          customerId: customer.id,
          type: "queued",
        });
        queued += 1;
      }
    } else {
      const href = message.ctaUrl || `/p`;
      const customerLocale = (customer.traits as Record<string, unknown> | null)?.locale;
      const copy = translatedOutbound(
        message,
        typeof customerLocale === "string" ? customerLocale : null,
        translationsEnabled,
      );
      const inserted = await db
        .insert(inAppNotifications)
        .values({
          workspaceId: message.workspaceId,
          productId: message.productId,
          customerId: customer.id,
          kind: "outbound_message",
          outboundMessageId: message.id,
          title: copy.title,
          body: copy.body,
          href,
          dedupeKey: `outbound_message:${message.id}:${runKey}:${customer.id}`,
        })
        .onConflictDoNothing()
        .returning({ id: inAppNotifications.id });
      if (inserted[0]) {
        await db.insert(outboundMessageEvents).values({
          messageId: message.id,
          workspaceId: message.workspaceId,
          customerId: customer.id,
          type: "sent",
        });
        queued += 1;
      }
    }
  }

  if (message.recurrence === "one_shot") {
    await db
      .update(outboundMessages)
      .set({ status: "completed", updatedAt: new Date() })
      .where(eq(outboundMessages.id, message.id));
  }

  return { queued, skipped, channel: message.channel };
}

export async function countExperienceDismissals(experienceId: string): Promise<number> {
  const rows = await db
    .select({ total: count() })
    .from(widgetExperienceDismissals)
    .where(eq(widgetExperienceDismissals.experienceId, experienceId));
  return rows[0]?.total ?? 0;
}

export async function resetExperienceDismissals(
  productId: string,
  experienceId: string,
): Promise<AdminResult> {
  const owned = await db
    .select({ id: widgetExperiences.id })
    .from(widgetExperiences)
    .where(
      and(
        eq(widgetExperiences.id, experienceId),
        eq(widgetExperiences.productId, productId),
      ),
    )
    .limit(1);
  if (!owned[0]) return { ok: false, error: "Experience not found." };
  await db
    .delete(widgetExperienceDismissals)
    .where(eq(widgetExperienceDismissals.experienceId, experienceId));
  await db
    .delete(widgetExperienceViews)
    .where(eq(widgetExperienceViews.experienceId, experienceId));
  return { ok: true };
}

export async function activeSurveyForPortal(productId: string) {
  return listActiveSurveys(productId);
}
