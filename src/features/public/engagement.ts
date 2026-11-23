import "server-only";

import { and, count, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { getStorage } from "@/features/storage";
import { validateUpload } from "@/features/storage/limits";
import type { StoredObject } from "@/features/storage/types";
import { storeUpload } from "@/features/storage/upload";
import {
  feedbackAttachments,
  feedbackComments,
  feedbackCustomFieldValues,
  feedbackCustomerVotes,
  feedbackFollowers,
  feedbackPosts,
  feedbackReactions,
  feedbackVotes,
} from "@/db/schema";
import {
  canPublishWithPrivacy,
  type FeedbackPrivacy,
} from "@/lib/feedback-privacy";
import { hasCompanyMembership, postPrivacySql } from "./privacy";
import type { ResolvedPublicBoard } from "./types";

import { screenContent } from "@/features/moderation/screening";
import { upsertPendingReview } from "@/features/moderation/service";
import { queueFeedbackReplyNotifications } from "@/features/notifications/service";
import { ensureSubscriberForCustomer } from "@/features/subscribers/service";
import { logEvent, serializeError } from "@/lib/logger";

import { findSensitiveInfo, sensitiveInfoMessage } from "./sensitive";

/**
 * Public write services.
 *
 * Every function starts by proving the request belongs to the resolved board
 * *and* product, so an id guessed from another tenant is indistinguishable
 * from a missing one. Rate limiting, same-origin checks and session creation
 * live in the HTTP layer; these functions assume an authorized customer.
 */

export type PublicWriteFailure = {
  ok: false;
  status: 400 | 403 | 404 | 409;
  error: string;
  field?: "title" | "body" | "privacy";
};

export type PublicRequestRow = {
  id: string;
  boardId: string | null;
  productId: string;
  archivedAt: Date | null;
  mergedIntoId: string | null;
};

export const MAX_ATTACHMENTS = 3;

/**
 * Keep the subscriber list in step with people who follow a request.
 *
 * This is deliberately best-effort: a failure to maintain the marketing list
 * must never fail the follow, vote or comment the customer just made. The
 * dashboard also has an explicit backfill action for followers that could not
 * be linked while email was unavailable.
 */
async function linkFollower(input: { productId: string; customerId: string }): Promise<void> {
  try {
    await ensureSubscriberForCustomer(input);
  } catch (error) {
    logEvent("warn", "subscriber.follower_link_failed", {
      productId: input.productId,
      customerId: input.customerId,
      error: serializeError(error),
    });
  }
}

async function findRequest(
  tenant: ResolvedPublicBoard,
  requestId: string,
  viewerCustomerId: string,
): Promise<PublicRequestRow | null> {
  const rows = await db
    .select({
      id: feedbackPosts.id,
      boardId: feedbackPosts.boardId,
      productId: feedbackPosts.productId,
      archivedAt: feedbackPosts.archivedAt,
      mergedIntoId: feedbackPosts.mergedIntoId,
    })
    .from(feedbackPosts)
    .where(
      and(
        eq(feedbackPosts.id, requestId),
        eq(feedbackPosts.boardId, tenant.board.id),
        eq(feedbackPosts.productId, tenant.product.id),
        isNull(feedbackPosts.archivedAt),
        isNull(feedbackPosts.mergedIntoId),
        postPrivacySql(viewerCustomerId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/**
 * The public total: customer votes plus team votes. A write response reports
 * the same number the page does, so the button never jumps on refresh.
 */
async function totalVotes(requestId: string): Promise<number> {
  const [customerVotes, teamVotes, imported] = await Promise.all([
    db
      .select({ value: count() })
      .from(feedbackCustomerVotes)
      .where(eq(feedbackCustomerVotes.feedbackPostId, requestId)),
    db
      .select({ value: count() })
      .from(feedbackVotes)
      .where(eq(feedbackVotes.feedbackPostId, requestId)),
    db
      .select({ value: feedbackPosts.importedVoteCount })
      .from(feedbackPosts)
      .where(eq(feedbackPosts.id, requestId))
      .limit(1),
  ]);

  return (
    (customerVotes[0]?.value ?? 0) +
    (teamVotes[0]?.value ?? 0) +
    (imported[0]?.value ?? 0)
  );
}

export async function setCustomerVote(input: {
  tenant: ResolvedPublicBoard;
  requestId: string;
  customerId: string;
  voted: boolean;
}): Promise<{ ok: true; voted: boolean; voteCount: number } | PublicWriteFailure> {
  const request = await findRequest(input.tenant, input.requestId, input.customerId);
  if (!request) return { ok: false, status: 404, error: "Request not found." };

  if (input.voted) {
    await db
      .insert(feedbackCustomerVotes)
      .values({ feedbackPostId: request.id, customerId: input.customerId })
      .onConflictDoNothing();

    await linkFollower({
      productId: input.tenant.product.id,
      customerId: input.customerId,
    });

    // Voting signals interest in the outcome; an explicit unfollow still wins.
    await db
      .insert(feedbackFollowers)
      .values({
        feedbackPostId: request.id,
        customerId: input.customerId,
        source: "board",
      })
      .onConflictDoNothing();
  } else {
    await db
      .delete(feedbackCustomerVotes)
      .where(
        and(
          eq(feedbackCustomerVotes.feedbackPostId, request.id),
          eq(feedbackCustomerVotes.customerId, input.customerId),
        ),
      );
  }

  return {
    ok: true,
    voted: input.voted,
    voteCount: await totalVotes(request.id),
  };
}

export async function setCustomerFollow(input: {
  tenant: ResolvedPublicBoard;
  requestId: string;
  customerId: string;
  follows: boolean;
}): Promise<{ ok: true; follows: boolean } | PublicWriteFailure> {
  const request = await findRequest(input.tenant, input.requestId, input.customerId);
  if (!request) return { ok: false, status: 404, error: "Request not found." };

  if (input.follows) {
    await db
      .insert(feedbackFollowers)
      .values({
        feedbackPostId: request.id,
        customerId: input.customerId,
        source: "board",
      })
      .onConflictDoNothing();

    await linkFollower({
      productId: input.tenant.product.id,
      customerId: input.customerId,
    });
  } else {
    await db
      .delete(feedbackFollowers)
      .where(
        and(
          eq(feedbackFollowers.feedbackPostId, request.id),
          eq(feedbackFollowers.customerId, input.customerId),
        ),
      );
  }

  return { ok: true, follows: input.follows };
}

export async function setCustomerReaction(input: {
  tenant: ResolvedPublicBoard;
  requestId: string;
  customerId: string;
  kind: "like" | "love" | "celebrate";
  reacted: boolean;
}): Promise<{ ok: true; reacted: boolean; count: number } | PublicWriteFailure> {
  const request = await findRequest(input.tenant, input.requestId, input.customerId);
  if (!request) return { ok: false, status: 404, error: "Request not found." };

  if (input.reacted) {
    await db
      .insert(feedbackReactions)
      .values({
        feedbackPostId: request.id,
        customerId: input.customerId,
        kind: input.kind,
      })
      .onConflictDoNothing();
  } else {
    await db
      .delete(feedbackReactions)
      .where(
        and(
          eq(feedbackReactions.feedbackPostId, request.id),
          eq(feedbackReactions.customerId, input.customerId),
          eq(feedbackReactions.kind, input.kind),
        ),
      );
  }

  const rows = await db
    .select({ value: count() })
    .from(feedbackReactions)
    .where(
      and(
        eq(feedbackReactions.feedbackPostId, request.id),
        eq(feedbackReactions.kind, input.kind),
      ),
    );

  return {
    ok: true,
    reacted: input.reacted,
    count: rows[0]?.value ?? 0,
  };
}

export async function addPublicComment(input: {
  tenant: ResolvedPublicBoard;
  requestId: string;
  customerId: string;
  customerName: string | null;
  body: string;
  privacy?: FeedbackPrivacy;
}): Promise<
  | { ok: true; status: "published" | "awaiting_review"; commentId: string }
  | PublicWriteFailure
> {
  const request = await findRequest(input.tenant, input.requestId, input.customerId);
  if (!request) return { ok: false, status: 404, error: "Request not found." };

  if (input.tenant.board.settings.moderation.comments === "closed") {
    return { ok: false, status: 403, error: "Comments are closed on this board." };
  }

  const privacy = input.privacy ?? "public";
  if (
    privacy === "company" &&
    !(await hasCompanyMembership(input.customerId))
  ) {
    return {
      ok: false,
      status: 400,
      error: "Join a company before posting a company-only comment.",
      field: "privacy",
    };
  }
  if (!canPublishWithPrivacy(privacy, true)) {
    return { ok: false, status: 400, error: "Choose a valid audience.", field: "privacy" };
  }

  const screening = await screenContent({ body: input.body, images: [] });

  if (input.tenant.board.settings.moderation.blockSensitiveInfo) {
    const findings = findSensitiveInfo(input.body);
    if (findings.length > 0) {
      return {
        ok: false,
        status: 400,
        error: sensitiveInfoMessage(findings),
        field: "body",
      };
    }
  }

  const awaitingReview = input.tenant.board.settings.moderation.comments === "moderated";

  const comment = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(feedbackComments)
      .values({
        productId: input.tenant.product.id,
        feedbackPostId: request.id,
        authorCustomerId: input.customerId,
        authorName: input.customerName?.trim() || "Anonymous",
        authorType: "customer",
        body: input.body,
        internal: false,
        privacy,
      })
      .returning({ id: feedbackComments.id });

    const row = inserted[0];
    if (!row) throw new Error("Comment insert returned no row.");

    if (awaitingReview || screening.reasons.length > 0) {
      await upsertPendingReview(tx, {
        productId: input.tenant.product.id,
        contentType: "feedback_comment",
        contentId: row.id,
        reasons: screening.reasons,
        checks: screening.checks,
      });
    }

    // Commenting implies interest in the outcome; a later unfollow still wins.
    await tx
      .insert(feedbackFollowers)
      .values({
        feedbackPostId: request.id,
        customerId: input.customerId,
        source: "board",
      })
      .onConflictDoNothing();

    // A comment held for review stays quiet until a moderator approves it.
    if (!awaitingReview && screening.reasons.length === 0) {
      await queueFeedbackReplyNotifications(tx, {
        productId: input.tenant.product.id,
        postId: request.id,
        commentId: row.id,
        authorName: input.customerName?.trim() || "A customer",
        body: input.body,
        eventAt: new Date(),
        authorCustomerId: input.customerId,
      });
    }

    return row;
  });

  await linkFollower({
    productId: input.tenant.product.id,
    customerId: input.customerId,
  });

  return {
    ok: true,
    status: awaitingReview ? "awaiting_review" : "published",
    commentId: comment.id,
  };
}

export type PublicSubmissionFile = {
  fileName: string;
  mimeType: string;
  body: Uint8Array;
};

/** A typed custom-field value, already validated against its definition. */
export type PublicCustomFieldValue = {
  fieldId: string;
  textValue: string | null;
  numberValue: number | null;
  dateValue: string | null;
};

export async function createPublicRequest(input: {
  tenant: ResolvedPublicBoard;
  customerId: string;
  customerName: string | null;
  title: string;
  body: string;
  category: "feature_request" | "bug" | "improvement" | "question";
  privacy?: FeedbackPrivacy;
  files: PublicSubmissionFile[];
  customFieldValues?: PublicCustomFieldValue[];
  /** Pre-rewrite title/body, stored only when the customer accepted a rewrite. */
  originalTitle?: string | null;
  originalBody?: string | null;
  /** The request this one was confirmed as a split from. */
  splitFromId?: string | null;
}): Promise<
  | { ok: true; id: string; status: "published" | "awaiting_review" }
  | PublicWriteFailure
> {
  const privacy = input.privacy ?? "public";
  const originalTitle = input.originalTitle?.trim() || null;
  const originalBody = input.originalBody?.trim() || null;
  if ((originalTitle === null) !== (originalBody === null)) {
    return { ok: false, status: 400, error: "The original wording is incomplete." };
  }
  if (
    privacy === "company" &&
    !(await hasCompanyMembership(input.customerId))
  ) {
    return {
      ok: false,
      status: 400,
      error: "Join a company before posting a company-only request.",
      field: "privacy",
    };
  }
  if (!canPublishWithPrivacy(privacy, true)) {
    return { ok: false, status: 400, error: "Choose a valid audience.", field: "privacy" };
  }

  if (input.splitFromId) {
    const parent = await db
      .select({ id: feedbackPosts.id })
      .from(feedbackPosts)
      .where(
        and(
          eq(feedbackPosts.id, input.splitFromId),
          eq(feedbackPosts.productId, input.tenant.product.id),
        ),
      )
      .limit(1);
    if (!parent[0]) {
      return { ok: false, status: 400, error: "That parent request does not exist." };
    }
  }

  if (input.files.length > MAX_ATTACHMENTS) {
    return {
      ok: false,
      status: 400,
      error: `Attach at most ${MAX_ATTACHMENTS} files.`,
    };
  }

  for (const file of input.files) {
    const validation = validateUpload({
      kind: "attachment",
      mimeType: file.mimeType,
      byteSize: file.body.byteLength,
      body: file.body,
    });
    if (!validation.ok) {
      return { ok: false, status: 400, error: validation.error };
    }
  }

  const screening = await screenContent({
    title: input.title,
    body: input.body,
    images: input.files
      .filter((file) => file.mimeType.startsWith("image/"))
      .map((file) => ({
        fileName: file.fileName,
        mimeType: file.mimeType,
        body: file.body,
      })),
  });

  if (input.tenant.board.settings.moderation.blockSensitiveInfo) {
    const findings = findSensitiveInfo(`${input.title}\n${input.body}`);
    if (findings.length > 0) {
      return {
        ok: false,
        status: 400,
        error: sensitiveInfoMessage(findings),
        field: "body",
      };
    }
    if (screening.imageSensitive) {
      return {
        ok: false,
        status: 400,
        error:
          "An attached image appears to contain a payment card, private key or credential. Remove it before submitting.",
      };
    }
    if (screening.imagesUnscanned) {
      return {
        ok: false,
        status: 400,
        error:
          "Image attachments on this board are checked for sensitive information, but image scanning is not available. Remove the image or ask the team to enable scanning.",
      };
    }
  }

  // Store first so a storage failure cannot leave a request with missing
  // attachments; objects are removed again if the database write fails.
  const stored: StoredObject[] = [];
  for (const file of input.files) {
    const result = await storeUpload({
      workspaceId: input.tenant.workspace.id,
      productId: input.tenant.product.id,
      kind: "attachment",
      fileName: file.fileName,
      mimeType: file.mimeType,
      body: file.body,
    });
    if (!result.ok) {
      for (const object of stored) {
        await getStorage().delete(object.key).catch(() => {});
      }
      return { ok: false, status: 400, error: result.error };
    }
    stored.push(result.object);
  }

  const awaitingReview = input.tenant.board.settings.moderation.requireApproval !== "none";

  try {
    const created = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(feedbackPosts)
        .values({
          productId: input.tenant.product.id,
          boardId: input.tenant.board.id,
          authorCustomerId: input.customerId,
          authorLabel: input.customerName?.trim() || null,
          title: input.title,
          body: input.body,
          category: input.category,
          status: "open",
          source: "in_app",
          privacy,
          originalTitle,
          originalBody,
          splitFromId: input.splitFromId ?? null,
        })
        .returning({ id: feedbackPosts.id });

      const post = inserted[0];
      if (!post) throw new Error("Feedback insert returned no row.");

      if (input.customFieldValues && input.customFieldValues.length > 0) {
        await tx.insert(feedbackCustomFieldValues).values(
          input.customFieldValues.map((value) => ({
            productId: input.tenant.product.id,
            feedbackPostId: post.id,
            fieldId: value.fieldId,
            textValue: value.textValue,
            numberValue: value.numberValue,
            dateValue: value.dateValue,
          })),
        );
      }

      if (stored.length > 0) {
        await tx.insert(feedbackAttachments).values(
          stored.map((object, index) => ({
            productId: input.tenant.product.id,
            feedbackPostId: post.id,
            uploadedByCustomerId: input.customerId,
            storageKey: object.key,
            fileName: input.files[index]?.fileName ?? object.fileName,
            mimeType: object.contentType,
            byteSize: object.byteSize,
            checksum: object.checksum,
          })),
        );
      }

      if (awaitingReview || screening.reasons.length > 0) {
        await upsertPendingReview(tx, {
          productId: input.tenant.product.id,
          contentType: "feedback_post",
          contentId: post.id,
          reasons: screening.reasons,
          checks: screening.checks,
        });
      }

      await tx
        .insert(feedbackFollowers)
        .values({
          feedbackPostId: post.id,
          customerId: input.customerId,
          source: "board",
        })
        .onConflictDoNothing();

      return post;
    });

    await linkFollower({
      productId: input.tenant.product.id,
      customerId: input.customerId,
    });

    return {
      ok: true,
      id: created.id,
      status: awaitingReview ? "awaiting_review" : "published",
    };
  } catch (error) {
    for (const object of stored) {
      await getStorage().delete(object.key).catch(() => {});
    }
    throw error;
  }
}
