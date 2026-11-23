import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  customerSessions,
  customers,
  feedbackAttachments,
  feedbackComments,
  feedbackPosts,
  moderationReviews,
  type ModerationChecks,
} from "@/db/schema";
import { queueFeedbackReplyNotifications } from "@/features/notifications/service";
import { getStorage } from "@/features/storage";

import { loadReviewContent, screenContent } from "./screening";
import type { ModerationAction } from "./types";

export type { ModerationAction };

/**
 * Moderation writes.
 *
 * Every lookup starts from the review id *and* the authorized product id, so a
 * guessed review from another tenant is a 404. Deleting content removes its
 * object-storage attachments best-effort after the database commits; a failed
 * object delete never restores a row that a moderator removed.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const AUTO_REASONS = new Set([
  "spam",
  "abuse",
  "sensitive_info",
  "sensitive_info_image",
  "scan_unavailable",
  "scan_error",
]);

/**
 * Create or update the item's single open review.
 *
 * Repeated automatic passes must not create a pile of pending rows, because
 * the queue and the public visibility check both read the newest row.
 */
export async function upsertPendingReview(
  tx: Tx,
  input: {
    productId: string;
    contentType: "feedback_post" | "feedback_comment";
    contentId: string;
    reasons: string[];
    checks: ModerationChecks;
  },
): Promise<void> {
  const existing = await tx
    .select({
      id: moderationReviews.id,
      reasons: moderationReviews.reasons,
    })
    .from(moderationReviews)
    .where(
      and(
        eq(moderationReviews.productId, input.productId),
        eq(moderationReviews.contentType, input.contentType),
        eq(moderationReviews.contentId, input.contentId),
        eq(moderationReviews.status, "pending"),
      ),
    )
    .orderBy(desc(moderationReviews.createdAt))
    .limit(1);

  const current = existing[0];
  if (current) {
    const merged = new Set([...current.reasons, ...input.reasons]);
    await tx
      .update(moderationReviews)
      .set({
        reasons: [...merged],
        checks: input.checks,
        updatedAt: new Date(),
      })
      .where(eq(moderationReviews.id, current.id));
    return;
  }

  await tx.insert(moderationReviews).values({
    productId: input.productId,
    contentType: input.contentType,
    contentId: input.contentId,
    status: "pending",
    reasons: [...new Set(input.reasons)],
    checks: input.checks,
  });
}

export type ModerationActionResult =
  | { ok: true; status: "approved" | "rejected" | "deleted" }
  | { ok: false; error: string };

async function reviewById(reviewId: string, productId: string) {
  const rows = await db
    .select()
    .from(moderationReviews)
    .where(
      and(
        eq(moderationReviews.id, reviewId),
        eq(moderationReviews.productId, productId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function attachmentKeysFor(input: {
  productId: string;
  contentType: "feedback_post" | "feedback_comment";
  contentId: string;
}): Promise<string[]> {
  const rows =
    input.contentType === "feedback_post"
      ? await db
          .select({ key: feedbackAttachments.storageKey })
          .from(feedbackAttachments)
          .where(
            and(
              eq(feedbackAttachments.feedbackPostId, input.contentId),
              eq(feedbackAttachments.productId, input.productId),
            ),
          )
      : await db
          .select({ key: feedbackAttachments.storageKey })
          .from(feedbackAttachments)
          .where(
            and(
              eq(feedbackAttachments.feedbackCommentId, input.contentId),
              eq(feedbackAttachments.productId, input.productId),
            ),
          );

  return rows.map((row) => row.key);
}

export async function applyModerationAction(input: {
  reviewId: string;
  productId: string;
  userId: string;
  action: ModerationAction;
}): Promise<ModerationActionResult> {
  const review = await reviewById(input.reviewId, input.productId);
  if (!review) return { ok: false, error: "That review no longer exists." };

  if (input.action === "delete") {
    const keys = await attachmentKeysFor({
      productId: input.productId,
      contentType: review.contentType,
      contentId: review.contentId,
    });

    await db.transaction(async (tx) => {
      if (review.contentType === "feedback_post") {
        await tx
          .delete(feedbackPosts)
          .where(
            and(
              eq(feedbackPosts.id, review.contentId),
              eq(feedbackPosts.productId, input.productId),
            ),
          );
      } else {
        await tx
          .delete(feedbackComments)
          .where(
            and(
              eq(feedbackComments.id, review.contentId),
              eq(feedbackComments.productId, input.productId),
            ),
          );
      }

      await tx
        .delete(moderationReviews)
        .where(
          and(
            eq(moderationReviews.productId, input.productId),
            eq(moderationReviews.contentType, review.contentType),
            eq(moderationReviews.contentId, review.contentId),
          ),
        );
    });

    const storage = getStorage();
    for (const key of keys) {
      await storage.delete(key).catch(() => {});
    }

    return { ok: true, status: "deleted" };
  }

  const status = input.action === "keep_hidden" ? "rejected" : "approved";
  const now = new Date();

  const updated = await db
    .update(moderationReviews)
    .set({
      status,
      reviewedBy: input.userId,
      reviewedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(moderationReviews.id, review.id),
        eq(moderationReviews.productId, input.productId),
      ),
    )
    .returning({ id: moderationReviews.id });

  if (!updated[0]) return { ok: false, error: "That review no longer exists." };

  // A comment held for review only notifies followers once it is approved.
  // The comment id is the dedupe key, so approving it again adds nothing.
  if (status === "approved" && review.contentType === "feedback_comment") {
    const comments = await db
      .select({
        id: feedbackComments.id,
        productId: feedbackComments.productId,
        feedbackPostId: feedbackComments.feedbackPostId,
        body: feedbackComments.body,
        authorName: feedbackComments.authorName,
        authorCustomerId: feedbackComments.authorCustomerId,
        internal: feedbackComments.internal,
      })
      .from(feedbackComments)
      .where(
        and(
          eq(feedbackComments.id, review.contentId),
          eq(feedbackComments.productId, input.productId),
        ),
      )
      .limit(1);

    const comment = comments[0];
    if (comment && !comment.internal) {
      await db.transaction((tx) =>
        queueFeedbackReplyNotifications(tx, {
          productId: comment.productId,
          postId: comment.feedbackPostId,
          commentId: comment.id,
          authorName: comment.authorName,
          body: comment.body,
          eventAt: now,
          authorCustomerId: comment.authorCustomerId,
        }),
      );
    }
  }

  return { ok: true, status };
}

export type BanResult =
  | { ok: true; banned: boolean }
  | { ok: false; error: string };

/**
 * Ban or unban one customer in a workspace.
 *
 * Banning marks the customer and revokes every outstanding session, so an
 * already-signed-in browser loses access immediately. The public projections
 * already hide content whose author is banned. Unbanning restores the account
 * but does not republish anything that was separately rejected.
 */
export async function setCustomerBan(input: {
  workspaceId: string;
  customerId: string;
  banned: boolean;
}): Promise<BanResult> {
  const rows = await db
    .select({ id: customers.id })
    .from(customers)
    .where(
      and(
        eq(customers.id, input.customerId),
        eq(customers.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);
  if (!rows[0]) return { ok: false, error: "That customer no longer exists." };

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(customers)
      .set({ bannedAt: input.banned ? now : null, updatedAt: now })
      .where(
        and(
          eq(customers.id, input.customerId),
          eq(customers.workspaceId, input.workspaceId),
        ),
      );

    if (input.banned) {
      await tx
        .delete(customerSessions)
        .where(eq(customerSessions.customerId, input.customerId));
    }
  });

  return { ok: true, banned: input.banned };
}

export type RetryResult =
  | { ok: true; reasons: string[]; checks: ModerationChecks }
  | { ok: false; error: string };

/** Re-run automated checks on an open review, including stored attachments. */
export async function retryReviewChecks(input: {
  reviewId: string;
  productId: string;
}): Promise<RetryResult> {
  const review = await reviewById(input.reviewId, input.productId);
  if (!review) return { ok: false, error: "That review no longer exists." };
  if (review.status !== "pending") {
    return { ok: false, error: "Only a pending review can be checked again." };
  }

  const content = await loadReviewContent({
    productId: input.productId,
    contentType: review.contentType,
    contentId: review.contentId,
  });
  if (!content) return { ok: false, error: "The reviewed content no longer exists." };

  const screening = await screenContent({
    title: content.title,
    body: content.body,
    images: content.images,
    storageFailures: content.storageFailures,
  });

  const manualReasons = review.reasons.filter((reason) => !AUTO_REASONS.has(reason));
  const reasons = [...new Set([...manualReasons, ...screening.reasons])];

  await db
    .update(moderationReviews)
    .set({ reasons, checks: screening.checks, updatedAt: new Date() })
    .where(
      and(
        eq(moderationReviews.id, review.id),
        eq(moderationReviews.productId, input.productId),
      ),
    );

  return { ok: true, reasons, checks: screening.checks };
}
