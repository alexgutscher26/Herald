import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { feedbackPosts } from "@/db/schema/feedback";
import { duplicateReviews } from "@/db/schema/feedback-extensions";
import { mergeFeedbackRequests } from "@/features/feedback/merge";

/**
 * Human duplicate triage.
 *
 * The AI proposes; a person decides. Merging goes through the same
 * `mergeFeedbackRequests` transaction as the inbox, so undo moves exactly the
 * engagement the merge moved and the existing merge history stays the source
 * of truth. Dismissal never changes either request.
 */

export type DuplicateReviewView = {
  id: string;
  sourceId: string;
  sourceTitle: string;
  sourceBody: string;
  targetId: string;
  targetTitle: string;
  targetBody: string;
  score: number;
  mode: string;
  createdAt: string;
};

export async function listDuplicateReviews(
  productId: string,
  limit = 40,
): Promise<DuplicateReviewView[]> {
  const rows = await db
    .select()
    .from(duplicateReviews)
    .where(
      and(
        eq(duplicateReviews.productId, productId),
        eq(duplicateReviews.status, "pending"),
      ),
    )
    .orderBy(desc(duplicateReviews.score), desc(duplicateReviews.createdAt))
    .limit(Math.min(Math.max(limit, 1), 100));

  if (rows.length === 0) return [];

  const postRows = await db
    .select({
      id: feedbackPosts.id,
      title: feedbackPosts.title,
      body: feedbackPosts.body,
    })
    .from(feedbackPosts)
    .where(
      inArray(
        feedbackPosts.id,
        [...new Set(rows.flatMap((row) => [row.sourcePostId, row.targetPostId]))],
      ),
    );
  const posts = new Map(postRows.map((post) => [post.id, post]));

  return rows.flatMap((row) => {
    const source = posts.get(row.sourcePostId);
    const target = posts.get(row.targetPostId);
    if (!source || !target) return [];
    return [
      {
        id: row.id,
        sourceId: source.id,
        sourceTitle: source.title,
        sourceBody: source.body,
        targetId: target.id,
        targetTitle: target.title,
        targetBody: target.body,
        score: row.score,
        mode: row.mode,
        createdAt: row.createdAt.toISOString(),
      },
    ];
  });
}

export async function resolveDuplicateReview(input: {
  productId: string;
  reviewId: string;
  userId: string;
  decision: "merge" | "dismiss";
  now?: Date;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const now = input.now ?? new Date();
  const rows = await db
    .select()
    .from(duplicateReviews)
    .where(
      and(
        eq(duplicateReviews.productId, input.productId),
        eq(duplicateReviews.id, input.reviewId),
        eq(duplicateReviews.status, "pending"),
      ),
    )
    .limit(1);
  const review = rows[0];
  if (!review) return { ok: false, error: "That duplicate review is no longer pending." };

  if (input.decision === "dismiss") {
    const updated = await db
      .update(duplicateReviews)
      .set({ status: "dismissed", resolvedBy: input.userId, resolvedAt: now })
      .where(
        and(
          eq(duplicateReviews.id, review.id),
          eq(duplicateReviews.productId, input.productId),
          eq(duplicateReviews.status, "pending"),
        ),
      )
      .returning({ id: duplicateReviews.id });
    if (!updated[0]) return { ok: false, error: "That duplicate review changed." };
    return { ok: true };
  }

  const merged = await mergeFeedbackRequests({
    productId: input.productId,
    sourceId: review.sourcePostId,
    targetId: review.targetPostId,
    userId: input.userId,
  });
  if (!merged.ok) return merged;

  const updated = await db
    .update(duplicateReviews)
    .set({
      status: "merged",
      mergeId: merged.mergeId,
      resolvedBy: input.userId,
      resolvedAt: now,
    })
    .where(
      and(
        eq(duplicateReviews.id, review.id),
        eq(duplicateReviews.productId, input.productId),
        eq(duplicateReviews.status, "pending"),
      ),
    )
    .returning({ id: duplicateReviews.id });
  if (!updated[0]) {
    return { ok: false, error: "The merge succeeded but the review could not be closed." };
  }

  return { ok: true };
}
