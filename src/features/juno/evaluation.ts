import "server-only";

import { and, desc, eq, gte, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  junoEvalCases,
  junoEvalRuns,
  junoSettings,
  junoUsage,
  type JunoSettings,
} from "@/db/schema/knowledge";
import { generateAiText } from "@/features/ai/provider";
import { getWorkspacePlan } from "@/features/entitlements/entitlements";
import { hasFeature, isJunoModelAllowed } from "@/features/entitlements/plans";
import { workspaceBranding } from "@/db/schema/branding";
import { products } from "@/db/schema/workspaces";
import { getAiConfig } from "@/lib/env";
import { formatCurrency } from "@/lib/format";

import { checkBudget, recordAiUsage, usageDay } from "./budget";
import { sanitizeModelInput } from "./guardrails";
import {
  buildAnswerPrompt,
  buildAnswerSystemPrompt,
  classifySensitiveQuestion,
  cleanAnswer,
  customerAskedForHuman,
} from "./policy";
import { retrieveKnowledge, type RetrievedChunk } from "./retrieval";

/**
 * Evaluation harness.
 *
 * A product keeps a small golden set of questions. A run answers each one
 * without writing to a conversation, then records pass/fail with the model and
 * prompt version that produced it. Changing the model is refused until a run
 * for the target model has passed every current enabled case.
 */

import { JUNO_PROMPT_VERSION } from "./prompt-version";

export { JUNO_PROMPT_VERSION } from "./prompt-version";

export const MAX_EVAL_CASES = 50;

export type EvalRunSummary = {
  total: number;
  passed: number;
  failed: number;
  model: string | null;
  promptVersion: string;
};

export type EvalResult =
  | { ok: true; summary: EvalRunSummary }
  | { ok: false; error: string };

function keywordScore(answer: string, expected: string[]): number {
  const normalized = answer.toLowerCase();
  const wanted = expected
    .map((keyword) => keyword.trim().toLowerCase())
    .filter((keyword) => keyword !== "");
  if (wanted.length === 0) return 1;
  const matched = wanted.filter((keyword) => normalized.includes(keyword)).length;
  return matched / wanted.length;
}

export async function runJunoEvaluation(input: {
  productId: string;
  /** Team-only opt-in: include internal-only sources in this run. */
  includeInternal?: boolean;
  now?: Date;
  generate?: typeof generateAiText;
  retrieve?: typeof retrieveKnowledge;
}): Promise<EvalResult> {
  const now = input.now ?? new Date();
  const generate = input.generate ?? generateAiText;
  const retrieve = input.retrieve ?? retrieveKnowledge;

  const settingRows = await db
    .select()
    .from(junoSettings)
    .where(eq(junoSettings.productId, input.productId))
    .limit(1);
  const settings: JunoSettings | undefined = settingRows[0];
  if (!settings) {
    return { ok: false, error: "Configure Mira before running an evaluation." };
  }

  const cases = await db
    .select()
    .from(junoEvalCases)
    .where(
      and(eq(junoEvalCases.productId, input.productId), eq(junoEvalCases.enabled, true)),
    )
    .orderBy(junoEvalCases.createdAt)
    .limit(MAX_EVAL_CASES);

  if (cases.length === 0) {
    return {
      ok: false,
      error: "Add at least one golden question before running an evaluation.",
    };
  }

  const model = settings.model ?? getAiConfig()?.AI_MODEL ?? null;
  const audience = input.includeInternal ? "internal" : "public";

  const productRows = await db
    .select({ workspaceId: products.workspaceId })
    .from(products)
    .where(eq(products.id, input.productId))
    .limit(1);
  const workspaceId = productRows[0]?.workspaceId;
  if (!workspaceId) {
    return { ok: false, error: "That product no longer exists." };
  }
  const plan = await getWorkspacePlan(workspaceId);
  if (!hasFeature(plan, "ai")) {
    return { ok: false, error: "Mira is not included on this workspace's plan." };
  }
  if (!isJunoModelAllowed(plan, getAiConfig()?.AI_MODEL ?? null, settings.model)) {
    return { ok: false, error: "The configured Mira model is not allowed on this workspace's plan." };
  }
  const brandingRows = await db
    .select({ locale: workspaceBranding.locale })
    .from(workspaceBranding)
    .where(eq(workspaceBranding.workspaceId, workspaceId))
    .limit(1);
  const workspaceLocale = brandingRows[0]?.locale ?? null;

  const budget = await checkBudget({
    productId: input.productId,
    costCents: cases.length,
    now,
  });
  if (!budget.allowed) {
    return {
      ok: false,
      error: `The evaluation needs ${formatCurrency(cases.length, "USD")} but only ${
        budget.limitCents - budget.spentCents
      } remain in today's budget.`,
    };
  }

  let passed = 0;
  let failed = 0;

  for (const testCase of cases) {
    const question = sanitizeModelInput(testCase.question);
    let chunks: RetrievedChunk[] = [];
    try {
      chunks = await retrieve({
        productId: input.productId,
        query: question,
        limit: 4,
        audience,
      });
    } catch {
      chunks = [];
    }

    const sensitive = classifySensitiveQuestion(question);
    const human = customerAskedForHuman(question);
    let answer: string | null = null;
    let pass = false;
    let score = 0;
    let reason = "";

    if (testCase.expectHandoff) {
      pass =
        Boolean(sensitive || human) ||
        !chunks[0] ||
        chunks[0].score < settings.confidenceFloor;
      score = chunks[0]?.score ?? 0;
      reason = pass
        ? "Handed off as expected."
        : "The question was answerable, but the case expects a handoff.";
    } else if (sensitive || human) {
      reason = "The question must hand off, not be answered.";
    } else if (!chunks[0] || chunks[0].score < settings.confidenceFloor) {
      reason = "No source cleared the confidence floor.";
    } else {
      try {
        const raw = await generate({
          system: buildAnswerSystemPrompt(settings, workspaceLocale),
          prompt: buildAnswerPrompt({
            question,
            history: [],
            sources: chunks.slice(0, 4).map((chunk) => ({
              title: chunk.title,
              url: chunk.url,
              content: chunk.content,
            })),
          }),
          temperature: 0.2,
          maxTokens: 600,
        });
        answer = cleanAnswer(raw);
        score = keywordScore(answer, testCase.expectedKeywords);
        pass = answer !== "" && score === 1;
        reason = pass
          ? "Answer contained every expected phrase."
          : `Answer matched ${Math.round(score * 100)}% of the expected phrases.`;
      } catch {
        reason = "The model was unavailable.";
      }
    }

    await db.insert(junoEvalRuns).values({
      productId: input.productId,
      caseId: testCase.id,
      model,
      promptVersion: JUNO_PROMPT_VERSION,
      passed: pass,
      score,
      answer,
      reason,
      createdAt: now,
    });

    await db.transaction(async (tx) => {
      await recordAiUsage(tx, {
        productId: input.productId,
        now,
        costCents: 1,
        dailyLimitCents: budget.limitCents,
      });
    });

    if (pass) passed += 1;
    else failed += 1;
  }

  return {
    ok: true,
    summary: {
      total: cases.length,
      passed,
      failed,
      model,
      promptVersion: JUNO_PROMPT_VERSION,
    },
  };
}

/**
 * Refuse a model change that has not been evaluated.
 *
 * A product with no golden set can still choose a model; as soon as it has
 * one, the latest run for the target model must exist, cover every enabled
 * case and pass all of them, and must be newer than the case's last edit.
 */
export async function assertModelChangeAllowed(input: {
  productId: string;
  currentModel: string | null;
  nextModel: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (input.currentModel === input.nextModel) return { ok: true };

  const cases = await db
    .select({
      id: junoEvalCases.id,
      updatedAt: junoEvalCases.updatedAt,
    })
    .from(junoEvalCases)
    .where(
      and(eq(junoEvalCases.productId, input.productId), eq(junoEvalCases.enabled, true)),
    );

  if (cases.length === 0) return { ok: true };

  const runs = await db
    .select({
      caseId: junoEvalRuns.caseId,
      passed: junoEvalRuns.passed,
      createdAt: junoEvalRuns.createdAt,
    })
    .from(junoEvalRuns)
    .where(
      and(
        eq(junoEvalRuns.productId, input.productId),
        eq(junoEvalRuns.promptVersion, JUNO_PROMPT_VERSION),
        input.nextModel === null
          ? sql`${junoEvalRuns.model} IS NULL`
          : eq(junoEvalRuns.model, input.nextModel),
      ),
    )
    .orderBy(desc(junoEvalRuns.createdAt))
    .limit(500);

  const latest = new Map<string, { passed: boolean; createdAt: Date }>();
  for (const run of runs) {
    if (!latest.has(run.caseId)) {
      latest.set(run.caseId, { passed: run.passed, createdAt: run.createdAt });
    }
  }

  const missing = cases.filter((testCase) => {
    const run = latest.get(testCase.id);
    return !run || !run.passed || run.createdAt.getTime() < testCase.updatedAt.getTime();
  });

  if (missing.length > 0) {
    return {
      ok: false,
      error:
        "Run the evaluation for this model first: the latest run must pass every current golden question.",
    };
  }

  return { ok: true };
}

export async function addEvalCase(input: {
  productId: string;
  question: string;
  expectedKeywords: string[];
  expectHandoff: boolean;
  userId: string;
  now?: Date;
}): Promise<{ ok: true; caseId: string } | { ok: false; error: string }> {
  const question = input.question.trim();
  if (question.length < 3 || question.length > 500) {
    return { ok: false, error: "Use a question between 3 and 500 characters." };
  }

  const keywords = [...new Set(
    input.expectedKeywords.map((keyword) => keyword.trim().toLowerCase()).filter(Boolean),
  )].slice(0, 8);
  if (!input.expectHandoff && keywords.length === 0) {
    return { ok: false, error: "Add at least one phrase the answer must contain." };
  }
  if (keywords.some((keyword) => keyword.length > 80)) {
    return { ok: false, error: "Keep each expected phrase under 80 characters." };
  }

  const now = input.now ?? new Date();
  const inserted = await db
    .insert(junoEvalCases)
    .values({
      productId: input.productId,
      question,
      expectedKeywords: keywords,
      expectHandoff: input.expectHandoff,
      createdBy: input.userId,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: junoEvalCases.id });

  const row = inserted[0];
  if (!row) return { ok: false, error: "Could not save that question." };
  return { ok: true, caseId: row.id };
}

export async function removeEvalCase(input: {
  productId: string;
  caseId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const deleted = await db
    .delete(junoEvalCases)
    .where(
      and(
        eq(junoEvalCases.id, input.caseId),
        eq(junoEvalCases.productId, input.productId),
      ),
    )
    .returning({ id: junoEvalCases.id });
  if (!deleted[0]) return { ok: false, error: "That question no longer exists." };
  return { ok: true };
}

/** Most recent run per case, for the settings card. */
export async function listEvalStatus(productId: string): Promise<
  {
    caseId: string;
    question: string;
    expectHandoff: boolean;
    passed: boolean | null;
    reason: string | null;
    model: string | null;
    ranAt: string | null;
  }[]
> {
  const cases = await db
    .select()
    .from(junoEvalCases)
    .where(eq(junoEvalCases.productId, productId))
    .orderBy(desc(junoEvalCases.createdAt))
    .limit(MAX_EVAL_CASES);

  const runs = await db
    .select()
    .from(junoEvalRuns)
    .where(eq(junoEvalRuns.productId, productId))
    .orderBy(desc(junoEvalRuns.createdAt))
    .limit(500);

  const latest = new Map<string, (typeof runs)[number]>();
  for (const run of runs) {
    if (!latest.has(run.caseId)) latest.set(run.caseId, run);
  }

  return cases.map((testCase) => {
    const run = latest.get(testCase.id);
    return {
      caseId: testCase.id,
      question: testCase.question,
      expectHandoff: testCase.expectHandoff,
      passed: run?.passed ?? null,
      reason: run?.reason ?? null,
      model: run?.model ?? null,
      ranAt: run?.createdAt.toISOString() ?? null,
    };
  });
}

/** Total Mira spend since a UTC day, used by the activity meter. */
export async function sumJunoCost(input: {
  productId: string;
  since: Date;
}): Promise<number> {
  const rows = await db
    .select({ value: sql<number>`coalesce(sum(${junoUsage.costCents}), 0)::int` })
    .from(junoUsage)
    .where(
      and(
        eq(junoUsage.productId, input.productId),
        gte(junoUsage.day, usageDay(input.since)),
      ),
    );
  return rows[0]?.value ?? 0;
}
