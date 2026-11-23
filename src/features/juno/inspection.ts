import "server-only";

import { and, desc, eq, lt, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { conversations } from "@/db/schema/conversations";
import { customers } from "@/db/schema/customers";
import {
  junoAnswers,
  junoKnowledgeTasks,
  junoSettings,
  type JunoRetrievedSource,
  type KnowledgeCitation,
} from "@/db/schema/knowledge";
import { user } from "@/db/schema/auth";

/**
 * Team-only answer inspection.
 *
 * Every row is scoped by product. Retrieval scores and the answer's outcome are
 * stored beside the answer, not reconstructed from a mutable knowledge base, so
 * the trace remains what the customer actually received.
 */

export type JunoAnswerInspectionRow = {
  id: string;
  conversationId: string;
  conversationSubject: string;
  customerName: string | null;
  customerEmail: string | null;
  status: "answered" | "handoff" | "skipped" | "failed";
  question: string;
  answer: string | null;
  handoffReason: string | null;
  confidence: number | null;
  citations: KnowledgeCitation[] | null;
  retrievedSources: JunoRetrievedSource[] | null;
  model: string | null;
  promptVersion: string | null;
  costCents: number;
  feedbackRating: "up" | "down" | null;
  feedbackByName: string | null;
  feedbackAt: string | null;
  createdAt: string;
};

export type AnswerInspectionFilter = {
  lowConfidenceOnly: boolean;
  status?: "answered" | "handoff" | "skipped" | "failed" | undefined;
};

export async function listJunoAnswers(input: {
  productId: string;
  filter: AnswerInspectionFilter;
  limit?: number;
}): Promise<{
  rows: JunoAnswerInspectionRow[];
  confidenceFloor: number;
  lowConfidenceThreshold: number;
}> {
  const settings = await db
    .select({ confidenceFloor: junoSettings.confidenceFloor })
    .from(junoSettings)
    .where(eq(junoSettings.productId, input.productId))
    .limit(1);
  const confidenceFloor = settings[0]?.confidenceFloor ?? 0.35;
  const lowConfidenceThreshold = Math.min(0.99, confidenceFloor + 0.15);

  const conditions = [eq(junoAnswers.productId, input.productId)];
  if (input.filter.status) conditions.push(eq(junoAnswers.status, input.filter.status));
  if (input.filter.lowConfidenceOnly) {
    conditions.push(
      or(
        and(
          eq(junoAnswers.status, "answered"),
          lt(junoAnswers.confidence, lowConfidenceThreshold),
        ),
        and(
          eq(junoAnswers.status, "handoff"),
          eq(junoAnswers.handoffReason, "low_confidence"),
        ),
      )!,
    );
  }

  const rows = await db
    .select({
      id: junoAnswers.id,
      conversationId: junoAnswers.conversationId,
      conversationSubject: conversations.subject,
      customerName: customers.name,
      customerEmail: customers.email,
      status: junoAnswers.status,
      question: junoAnswers.question,
      answer: junoAnswers.answer,
      handoffReason: junoAnswers.handoffReason,
      confidence: junoAnswers.confidence,
      citations: junoAnswers.citations,
      retrievedSources: junoAnswers.retrievedSources,
      model: junoAnswers.model,
      promptVersion: junoAnswers.promptVersion,
      costCents: junoAnswers.costCents,
      feedbackRating: junoAnswers.feedbackRating,
      feedbackByName: user.name,
      feedbackAt: junoAnswers.feedbackAt,
      createdAt: junoAnswers.createdAt,
    })
    .from(junoAnswers)
    .innerJoin(
      conversations,
      and(
        eq(junoAnswers.conversationId, conversations.id),
        eq(junoAnswers.productId, conversations.productId),
      ),
    )
    .innerJoin(customers, eq(conversations.customerId, customers.id))
    .leftJoin(user, eq(junoAnswers.feedbackBy, user.id))
    .where(and(...conditions))
    .orderBy(desc(junoAnswers.createdAt))
    .limit(Math.min(Math.max(input.limit ?? 60, 1), 200));

  return {
    confidenceFloor,
    lowConfidenceThreshold,
    rows: rows.map((row) => ({
      ...row,
      handoffReason: row.handoffReason ?? null,
      citations: row.citations ?? null,
      retrievedSources: row.retrievedSources ?? null,
      feedbackByName: row.feedbackByName ?? null,
      feedbackAt: row.feedbackAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

export async function getJunoAnswerForEvaluation(input: {
  productId: string;
  answerId: string;
}): Promise<{ question: string; status: string } | null> {
  const rows = await db
    .select({ question: junoAnswers.question, status: junoAnswers.status })
    .from(junoAnswers)
    .where(
      and(
        eq(junoAnswers.productId, input.productId),
        eq(junoAnswers.id, input.answerId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function rateJunoAnswer(input: {
  productId: string;
  answerId: string;
  userId: string;
  rating: "up" | "down";
  now?: Date;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const now = input.now ?? new Date();

  const updated = await db.transaction(async (tx) => {
    const rows = await tx
      .update(junoAnswers)
      .set({
        feedbackRating: input.rating,
        feedbackBy: input.userId,
        feedbackAt: now,
      })
      .where(
        and(
          eq(junoAnswers.productId, input.productId),
          eq(junoAnswers.id, input.answerId),
        ),
      )
      .returning({
        id: junoAnswers.id,
        conversationId: junoAnswers.conversationId,
        question: junoAnswers.question,
      });

    const row = rows[0];
    if (!row) return null;

    if (input.rating === "down") {
      // The question is already redacted on the answer row. One task per answer
      // keeps repeated thumbs-down clicks from filling the list.
      await tx
        .insert(junoKnowledgeTasks)
        .values({
          productId: input.productId,
          answerId: row.id,
          conversationId: row.conversationId,
          question: row.question,
          createdBy: input.userId,
          createdAt: now,
        })
        .onConflictDoNothing();
    }

    return row;
  });

  if (!updated) return { ok: false, error: "That answer no longer exists." };
  return { ok: true };
}

/** Count answers that the inspection filter would surface, for the badge. */
export async function countLowConfidenceAnswers(productId: string): Promise<number> {
  const settings = await db
    .select({ confidenceFloor: junoSettings.confidenceFloor })
    .from(junoSettings)
    .where(eq(junoSettings.productId, productId))
    .limit(1);
  const threshold = Math.min(0.99, (settings[0]?.confidenceFloor ?? 0.35) + 0.15);

  const rows = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(junoAnswers)
    .where(
      and(
        eq(junoAnswers.productId, productId),
        or(
          and(eq(junoAnswers.status, "answered"), lt(junoAnswers.confidence, threshold)),
          and(
            eq(junoAnswers.status, "handoff"),
            eq(junoAnswers.handoffReason, "low_confidence"),
          ),
        )!,
      ),
    );
  return rows[0]?.value ?? 0;
}
