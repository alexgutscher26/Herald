import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { feedbackPosts } from "@/db/schema/feedback";
import {
  feedbackInsights,
  type FeedbackInsight,
} from "@/db/schema/feedback-extensions";

import { normalizeInsightDraft } from "./insight-rules";

export * from "./insight-rules";

/**
 * Evidence behind a request.
 *
 * A request is a decision; an insight is what justified it. Support
 * conversations, emails, calls and team notes are stored as separate rows with
 * their own source, timestamp and author, so the customer's wording survives a
 * merge and a status change. Nothing here is public: the public projections do
 * not read this table, and an insight stores a customer id and a display label
 * rather than an address.
 */

export type AddInsightInput = {
  productId: string;
  postId: string;
  quote: string;
  source: string;
  sourceRef?: string | null;
  authorLabel?: string | null;
  authorCustomerId?: string | null;
  createdBy?: string | null;
  occurredAt?: Date | null;
};

export type AddInsightResult =
  | { ok: true; insight: FeedbackInsight }
  | { ok: false; error: string; field?: "quote" | "source" | "occurredAt" };

/**
 * Attach one insight to an existing request.
 *
 * The post is resolved inside the product first, so a foreign request id adds
 * nothing anywhere rather than creating an orphan row.
 */
export async function addRequestInsight(
  input: AddInsightInput,
): Promise<AddInsightResult> {
  const draft = normalizeInsightDraft(input);
  if (!draft.ok) {
    return { ok: false, error: draft.error, field: draft.field };
  }

  const post = await db
    .select({ id: feedbackPosts.id })
    .from(feedbackPosts)
    .where(
      and(
        eq(feedbackPosts.id, input.postId),
        eq(feedbackPosts.productId, input.productId),
      ),
    )
    .limit(1);

  if (!post[0]) {
    return { ok: false, error: "That request no longer exists." };
  }

  const rows = await db
    .insert(feedbackInsights)
    .values({
      productId: input.productId,
      feedbackPostId: input.postId,
      quote: draft.value.quote,
      source: draft.value.source,
      sourceRef: draft.value.sourceRef,
      authorLabel: draft.value.authorLabel,
      authorCustomerId: input.authorCustomerId ?? null,
      createdBy: input.createdBy ?? null,
      occurredAt: draft.value.occurredAt,
    })
    .returning();

  const insight = rows[0];
  if (!insight) {
    return { ok: false, error: "Could not save that insight." };
  }
  return { ok: true, insight };
}

/** Newest first. The request detail shows the latest evidence without paging. */
export async function listRequestInsights(input: {
  productId: string;
  postId: string;
  limit?: number;
}): Promise<FeedbackInsight[]> {
  return db
    .select()
    .from(feedbackInsights)
    .where(
      and(
        eq(feedbackInsights.productId, input.productId),
        eq(feedbackInsights.feedbackPostId, input.postId),
      ),
    )
    .orderBy(desc(feedbackInsights.occurredAt), desc(feedbackInsights.createdAt))
    .limit(Math.min(Math.max(input.limit ?? 50, 1), 200));
}

/**
 * Remove one insight.
 *
 * Scoped by product *and* post so an id from another request (or tenant)
 * deletes nothing.
 */
export async function deleteRequestInsight(input: {
  productId: string;
  postId: string;
  insightId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const removed = await db
    .delete(feedbackInsights)
    .where(
      and(
        eq(feedbackInsights.id, input.insightId),
        eq(feedbackInsights.feedbackPostId, input.postId),
        eq(feedbackInsights.productId, input.productId),
      ),
    )
    .returning({ id: feedbackInsights.id });

  if (!removed[0]) {
    return { ok: false, error: "That insight no longer exists." };
  }
  return { ok: true };
}
