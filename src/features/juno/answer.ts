import "server-only";

import { and, asc, count, desc, eq, gte, sql } from "drizzle-orm";

import { db } from "@/db";
import { generateAiText } from "@/features/ai/provider";
import { conversationMessages, conversations } from "@/db/schema/conversations";
import { customers } from "@/db/schema/customers";
import { products } from "@/db/schema/workspaces";
import { workspaceBranding } from "@/db/schema/branding";
import { getWorkspacePlan } from "@/features/entitlements/entitlements";
import { hasFeature, isJunoModelAllowed, PLANS } from "@/features/entitlements/plans";
import {
  junoAnswers,
  junoConversations,
  junoSettings,
  junoUsage,
  type JunoSettings,
  type JunoRetrievedSource,
  type KnowledgeCitation,
} from "@/db/schema/knowledge";
import { queueConversationReplyNotification } from "@/features/email/inbound";
import { getAiConfig } from "@/lib/env";
import { formatCurrency } from "@/lib/format";
import { logEvent, serializeError } from "@/lib/logger";
import { normalizeEmail } from "@/lib/email";

import {
  buildAnswerPrompt,
  buildAnswerSystemPrompt,
  classifySensitiveQuestion,
  cleanAnswer,
  customerAskedForHuman,
  HANDOFF_MESSAGES,
  HANDOFF_NOTES,
  shouldPickup,
  type JunoHandoffReason,
} from "./policy";
import { executeRequestedAgentAction } from "./agent-actions";
import { maybeOfferFeedbackCard } from "./feedback-cards";
import { JUNO_PROMPT_VERSION } from "./evaluation";
import {
  countRedactions,
  requestsProtectedAction,
  sanitizeModelInput,
} from "./guardrails";
import { recordRedactionEvent } from "./audit";
import { recordAiUsage } from "./budget";
import { retrieveKnowledge, type RetrievedChunk } from "./retrieval";

/**
 * One pickup attempt.
 *
 * Order matters: cheap, deterministic refusals happen before the model is
 * called. Billing/account questions and human requests hand off without
 * generation; retrieval must clear the configured confidence floor; the daily
 * budget is a hard stop, not a downgrade. An answered message stores its
 * citations on the message so the customer can see where it came from, and the
 * internal handoff note never reaches the customer thread.
 */

export type JunoAnswerStatus = "answered" | "handoff" | "skipped" | "failed";

export type JunoAnswerOutcome = {
  status: JunoAnswerStatus;
  reason?: string;
  messageId?: string | null;
  confidence?: number;
};

export type JunoAnswerDeps = {
  generate?: typeof generateAiText;
  retrieve?: typeof retrieveKnowledge;
  now?: Date;
};

const MAX_HISTORY = 6;

function usageDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function estimateCostCents(model: string | null): number {
  // A conservative per-answer estimate for budget enforcement. The provider's
  // invoice remains authoritative; this only decides when to stop.
  return model ? 1 : 0;
}

function retrievedSourcesFor(chunks: RetrievedChunk[]): JunoRetrievedSource[] {
  return chunks.slice(0, 5).map((chunk) => ({
    sourceId: chunk.sourceId,
    sourceName: chunk.sourceName,
    title: chunk.title,
    url: chunk.url,
    score: Number(chunk.score.toFixed(4)),
    excerpt: chunk.content.slice(0, 500),
  }));
}

function citationsFor(chunks: RetrievedChunk[]): KnowledgeCitation[] {
  const seen = new Set<string>();
  const citations: KnowledgeCitation[] = [];

  for (const chunk of chunks) {
    const key = `${chunk.sourceId}:${chunk.title}:${chunk.url ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    citations.push({
      sourceId: chunk.sourceId,
      sourceName: chunk.sourceName,
      title: chunk.title,
      url: chunk.url,
    });
    if (citations.length >= 4) break;
  }

  return citations;
}

async function upsertState(
  executor: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: {
    conversationId: string;
    productId: string;
    state: "active" | "paused" | "handed_off" | "resolved";
    reason?: JunoHandoffReason | null;
    lastJunoMessageAt?: Date | null;
    resolvedAt?: Date | null;
    now: Date;
  },
): Promise<void> {
  const values = {
    conversationId: input.conversationId,
    productId: input.productId,
    state: input.state,
    handoffReason: input.reason ?? null,
    lastJunoMessageAt: input.lastJunoMessageAt ?? null,
    resolvedAt: input.resolvedAt ?? null,
    updatedAt: input.now,
  };

  await executor
    .insert(junoConversations)
    .values(values)
    .onConflictDoUpdate({
      target: junoConversations.conversationId,
      set: {
        state: values.state,
        handoffReason: values.handoffReason,
        lastJunoMessageAt: sql`coalesce(${values.lastJunoMessageAt}, ${junoConversations.lastJunoMessageAt})`,
        resolvedAt: values.resolvedAt,
        updatedAt: values.updatedAt,
      },
    });
}

async function handoff(input: {
  conversation: typeof conversations.$inferSelect;
  reason: JunoHandoffReason;
  question: string;
  detail?: string;
  now: Date;
}): Promise<JunoAnswerOutcome> {
  const body = HANDOFF_MESSAGES[input.reason];
  const note = `${HANDOFF_NOTES[input.reason]}${input.detail ? ` ${input.detail}` : ""}`;

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(conversationMessages)
      .values({
        conversationId: input.conversation.id,
        productId: input.conversation.productId,
        authorType: "juno",
        channel: "team",
        body,
        createdAt: input.now,
      })
      .returning({ id: conversationMessages.id });

    await tx.insert(conversationMessages).values({
      conversationId: input.conversation.id,
      productId: input.conversation.productId,
      authorType: "system",
      kind: "note",
      channel: "team",
      body: note,
      createdAt: input.now,
    });

    await tx
      .update(conversations)
      .set({
        status: "queue",
        resolvedAt: null,
        snoozedUntil: null,
        unreadForTeam: sql`${conversations.unreadForTeam} + 1`,
        lastMessagePreview: body.slice(0, 160),
        lastMessageAt: input.now,
        updatedAt: input.now,
      })
      .where(eq(conversations.id, input.conversation.id));

    await upsertState(tx, {
      conversationId: input.conversation.id,
      productId: input.conversation.productId,
      state: "handed_off",
      reason: input.reason,
      lastJunoMessageAt: input.now,
      now: input.now,
    });

    await tx.insert(junoAnswers).values({
      conversationId: input.conversation.id,
      productId: input.conversation.productId,
      messageId: inserted[0]?.id ?? null,
      status: "handoff",
      question: input.question.slice(0, 4_000),
      answer: body,
      handoffReason: input.reason,
      promptVersion: JUNO_PROMPT_VERSION,
      confidence: null,
      citations: null,
      model: null,
      costCents: 0,
      createdAt: input.now,
    });

    return { status: "handoff" as const, reason: input.reason, messageId: inserted[0]!.id };
  });
}

export async function answerConversation(input: {
  conversationId: string;
  productId: string;
  deps?: JunoAnswerDeps;
}): Promise<JunoAnswerOutcome> {
  const now = input.deps?.now ?? new Date();
  const generate = input.deps?.generate ?? generateAiText;
  const retrieve = input.deps?.retrieve ?? retrieveKnowledge;

  const settingRows = await db
    .select()
    .from(junoSettings)
    .where(eq(junoSettings.productId, input.productId))
    .limit(1);
  const settings: JunoSettings | undefined = settingRows[0];

  if (!settings || !settings.enabled) {
    return { status: "skipped", reason: "disabled" };
  }

  const conversationRows = await db
    .select({ conversation: conversations, customerEmail: customers.email })
    .from(conversations)
    .innerJoin(customers, eq(conversations.customerId, customers.id))
    .where(
      and(
        eq(conversations.id, input.conversationId),
        eq(conversations.productId, input.productId),
      ),
    )
    .limit(1);

  const row = conversationRows[0];
  if (!row) return { status: "skipped", reason: "missing" };

  const { conversation } = row;

  const latestRows = await db
    .select({
      id: conversationMessages.id,
      authorType: conversationMessages.authorType,
      kind: conversationMessages.kind,
      body: conversationMessages.body,
      createdAt: conversationMessages.createdAt,
    })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.conversationId, conversation.id),
        eq(conversationMessages.productId, input.productId),
      ),
    )
    .orderBy(desc(conversationMessages.createdAt))
    .limit(1);

  const latest = latestRows[0];
  if (!latest) return { status: "skipped", reason: "empty" };

  const stateRows = await db
    .select()
    .from(junoConversations)
    .where(eq(junoConversations.conversationId, conversation.id))
    .limit(1);
  const state = stateRows[0] ?? null;

  const reopenedByCustomer =
    state?.state === "resolved" &&
    state.resolvedAt !== null &&
    conversation.lastCustomerMessageAt !== null &&
    conversation.lastCustomerMessageAt.getTime() > state.resolvedAt.getTime();

  const effectiveState = reopenedByCustomer ? "active" : (state?.state ?? null);

  const decision = shouldPickup({
    enabled: settings.enabled,
    status: conversation.status,
    state: effectiveState,
    lastAuthor: latest.authorType,
    lastKind: latest.kind,
  });

  if (!decision.pickup) {
    return { status: "skipped", reason: decision.reason };
  }

  // The lifetime plan has a metered monthly reply allowance. It is checked
  // after the pickup decision so a resolved or disabled conversation is still
  // a skip, and before any model call so an exhausted allowance is a clean
  // handoff rather than a failed generation or a surprise bill.
  const productRows = await db
    .select({ workspaceId: products.workspaceId })
    .from(products)
    .where(eq(products.id, input.productId))
    .limit(1);
  const workspaceId = productRows[0]?.workspaceId;
  const brandingRows = workspaceId
    ? await db
        .select({ locale: workspaceBranding.locale })
        .from(workspaceBranding)
        .where(eq(workspaceBranding.workspaceId, workspaceId))
        .limit(1)
    : [];
  const workspaceLocale = brandingRows[0]?.locale ?? null;
  const plan = workspaceId ? await getWorkspacePlan(workspaceId) : "free";
  const configuredModel = getAiConfig()?.AI_MODEL ?? null;
  if (!hasFeature(plan, "ai")) {
    return handoff({
      conversation,
      reason: "plan",
      question: sanitizeModelInput(latest.body),
      detail: `Juno is not included on the ${PLANS[plan].name} plan.`,
      now,
    });
  }
  if (
    settings.model &&
    !isJunoModelAllowed(plan, configuredModel, settings.model)
  ) {
    return handoff({
      conversation,
      reason: "plan",
      question: sanitizeModelInput(latest.body),
      detail: `The ${PLANS[plan].name} plan does not allow the ${settings.model} model.`,
      now,
    });
  }

  const replyCap = PLANS[plan].limits.monthlyJunoReplies;
  if (replyCap !== null && workspaceId) {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    // The allowance is workspace-wide, not per product: a lifetime workspace
    // with several products shares one 150-reply pool.
    const usedRows = await db
      .select({ value: count() })
      .from(junoAnswers)
      .innerJoin(products, eq(junoAnswers.productId, products.id))
      .where(
        and(
          eq(products.workspaceId, workspaceId),
          eq(junoAnswers.status, "answered"),
          gte(junoAnswers.createdAt, monthStart),
        ),
      );
    const used = Number(usedRows[0]?.value ?? 0);
    if (used >= replyCap) {
      return handoff({
        conversation,
        reason: "quota",
        question: sanitizeModelInput(latest.body),
        detail: `Used ${used} of ${replyCap} replies this month.`,
        now,
      });
    }
  }

  const question = latest.body;
  // Money and secrets never reach the provider or the audit row verbatim.
  const modelQuestion = sanitizeModelInput(question);
  await recordRedactionEvent({
    productId: input.productId,
    messageId: latest.id,
    counts: countRedactions(question),
    now,
  });

  if (customerAskedForHuman(question)) {
    return handoff({ conversation, reason: "human_requested", question: modelQuestion, now });
  }

  const sensitive = classifySensitiveQuestion(`${conversation.subject}\n${question}`);
  if (sensitive) {
    return handoff({
      conversation,
      reason: sensitive,
      question: modelQuestion,
      detail: "The question mentions billing or account details.",
      now,
    });
  }

  // Actions are a closed, reviewed allowlist. Detection is literal, and an
  // action that is off or cannot run hands the request to a person.
  const action = await executeRequestedAgentAction({
    productId: input.productId,
    conversationId: conversation.id,
    question: modelQuestion,
    now,
  });
  if (action.handled) {
    if (action.queued) {
      return {
        status: "answered",
        reason: "action:send_transcript",
        messageId: action.messageId,
      };
    }
    return handoff({
      conversation,
      reason: "action_unavailable",
      question: modelQuestion,
      detail: action.detail,
      now,
    });
  }

  // A request to change a plan, permission or credential is handed to a human
  // rather than answered with a claim Juno cannot fulfil.
  if (requestsProtectedAction(question)) {
    return handoff({
      conversation,
      reason: "account",
      question: modelQuestion,
      detail: "The customer asked for a settings, permission or billing change.",
      now,
    });
  }

  let results: RetrievedChunk[];
  try {
    // Every conversation is customer-facing, so internal-only sources can never
    // reach a widget, email or Slack answer.
    results = await retrieve({
      productId: input.productId,
      query: modelQuestion,
      limit: 6,
      audience: "public",
    });
  } catch (error) {
    logEvent("error", "juno.retrieval_failed", { error: serializeError(error) });
    return handoff({ conversation, reason: "unavailable", question: modelQuestion, now });
  }

  const best = results[0];
  if (!best) {
    return handoff({ conversation, reason: "knowledge_gap", question: modelQuestion, now });
  }
  if (best.score < settings.confidenceFloor) {
    return handoff({
      conversation,
      reason: "low_confidence",
      question: modelQuestion,
      detail: `Best score ${best.score.toFixed(2)} is below the ${settings.confidenceFloor.toFixed(2)} floor.`,
      now,
    });
  }

  const model = settings.model ?? configuredModel;
  const costCents = estimateCostCents(model);
  const day = usageDay(now);

  const usageRows = await db
    .select({ costCents: junoUsage.costCents })
    .from(junoUsage)
    .where(and(eq(junoUsage.productId, input.productId), eq(junoUsage.day, day)))
    .limit(1);
  const spent = usageRows[0]?.costCents ?? 0;

  if (settings.dailyBudgetCents <= 0 || spent + costCents > settings.dailyBudgetCents) {
    return handoff({
      conversation,
      reason: "budget",
      question: modelQuestion,
      detail: `Spent ${formatCurrency(spent, "USD")} of ${formatCurrency(
        settings.dailyBudgetCents,
        "USD",
      )} today.`,
      now,
    });
  }

  const historyRows = await db
    .select({
      authorType: conversationMessages.authorType,
      body: conversationMessages.body,
    })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.conversationId, conversation.id),
        eq(conversationMessages.kind, "message"),
      ),
    )
    .orderBy(asc(conversationMessages.createdAt))
    .limit(20);

  const history = historyRows.slice(-MAX_HISTORY).map((message) => ({
    author:
      message.authorType === "customer"
        ? ("customer" as const)
        : message.authorType === "juno"
          ? ("juno" as const)
          : ("team" as const),
    body: sanitizeModelInput(message.body),
  }));

  let answerText: string;
  try {
    const raw = await generate({
      system: buildAnswerSystemPrompt(settings, workspaceLocale),
      prompt: buildAnswerPrompt({
        question: modelQuestion,
        history: history.filter((message) => message.body !== modelQuestion),
        sources: results.slice(0, 5).map((chunk) => ({
          title: chunk.title,
          url: chunk.url,
          content: chunk.content,
        })),
      }),
      temperature: 0.3,
      maxTokens:
        settings.replyLength === "short" ? 300 : settings.replyLength === "long" ? 1_000 : 600,
    });
    answerText = cleanAnswer(raw);
  } catch (error) {
    logEvent("error", "juno.generate_failed", { error: serializeError(error) });
    return handoff({ conversation, reason: "unavailable", question: modelQuestion, now });
  }

  if (answerText === "") {
    return handoff({ conversation, reason: "unavailable", question: modelQuestion, now });
  }

  const citations = citationsFor(results);

  const outcome = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(conversationMessages)
      .values({
        conversationId: conversation.id,
        productId: conversation.productId,
        authorType: "juno",
        channel: "team",
        body: answerText,
        citations: citations.map(({ sourceName, title, url }) => ({
          sourceName,
          title,
          url,
        })),
        createdAt: now,
      })
      .returning({ id: conversationMessages.id });

    const messageId = inserted[0]?.id ?? null;

    await tx
      .update(conversations)
      .set({
        lastMessagePreview: answerText.slice(0, 160),
        lastMessageAt: now,
        updatedAt: now,
        unreadForTeam: 0,
        unreadForCustomer: sql`${conversations.unreadForCustomer} + 1`,
      })
      .where(eq(conversations.id, conversation.id));

    await upsertState(tx, {
      conversationId: conversation.id,
      productId: conversation.productId,
      state: "active",
      reason: null,
      lastJunoMessageAt: now,
      now,
    });

    await tx.insert(junoAnswers).values({
      conversationId: conversation.id,
      productId: conversation.productId,
      messageId,
      status: "answered",
      question: modelQuestion.slice(0, 4_000),
      answer: answerText,
      confidence: best.score,
      citations,
      retrievedSources: retrievedSourcesFor(results),
      model,
      promptVersion: JUNO_PROMPT_VERSION,
      costCents,
      createdAt: now,
    });

    await recordAiUsage(tx, {
      productId: conversation.productId,
      now,
      costCents,
      dailyLimitCents: settings.dailyBudgetCents,
    });

    // Email threads get the same reply mail a human reply would queue.
    if (conversation.sourceContext?.channel === "email" && row.customerEmail && messageId) {
      await queueConversationReplyNotification(tx, {
        workspaceId: conversation.workspaceId,
        productId: conversation.productId,
        conversationId: conversation.id,
        conversationMessageId: messageId,
        recipientEmail: row.customerEmail,
        recipientEmailNormalized: normalizeEmail(row.customerEmail),
        now,
      });
    }

    return { status: "answered" as const, messageId, confidence: best.score };
  });

  // A request-shaped question may earn a feedback card, but only as an offer:
  // nothing is filed, voted or followed until the customer confirms it.
  if (outcome.status === "answered") {
    await maybeOfferFeedbackCard({ conversation, question: modelQuestion, now });
  }

  return outcome;
}

/**
 * Human takeover: once a team member replies, Juno stays out until somebody
 * explicitly hands the thread back. A handoff state is left intact.
 */
export async function recordHumanTakeover(
  executor: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: { conversationId: string; productId: string; now: Date },
): Promise<void> {
  const updated = await executor
    .update(junoConversations)
    .set({ state: "paused", updatedAt: input.now })
    .where(
      and(
        eq(junoConversations.conversationId, input.conversationId),
        sql`${junoConversations.state} <> 'handed_off'`,
      ),
    )
    .returning({ id: junoConversations.conversationId });

  if (updated.length > 0) return;

  await executor
    .insert(junoConversations)
    .values({
      conversationId: input.conversationId,
      productId: input.productId,
      state: "paused",
      updatedAt: input.now,
    })
    .onConflictDoNothing();
}
