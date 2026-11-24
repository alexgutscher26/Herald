"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db, type Database } from "@/db";
import { feedbackComments, feedbackPosts, feedbackVotes } from "@/db/schema/feedback";
import { releaseFeedbackLinks } from "@/db/schema/roadmap";
import { pushFeedbackStatusToIssueTracker } from "@/features/integrations/issue-service";
import { releases } from "@/db/schema/releases";
import { workspaceMembers } from "@/db/schema/workspaces";
import { authorizeProductAction } from "@/features/live/action-auth";
import { queueSlackStatusUpdate } from "@/features/slack/notify";
import type { ActionResult } from "@/features/live/action-result";
import {
  queueFeedbackReplyNotifications,
  queueFeedbackStatusNotifications,
} from "@/features/notifications/service";
import { toDbFeedbackStatus } from "@/db/queries/feedback";
import { hasPermission } from "@/lib/permissions";
import type { FeedbackStatus } from "@/types";

import { undoFeedbackBulkAction } from "./bulk-undo";
import { mergeFeedbackRequests, unmergeFeedbackRequest } from "./merge";
import { normalizePlannedFor } from "./planned-for";
import {
  bulkAddFeedbackTag,
  bulkMoveFeedbackToBoard,
  bulkSetFeedbackAssignee,
  bulkSetFeedbackHidden,
  bulkUpdateFeedbackStatuses,
} from "./triage";

import type {
  AddFeedbackCommentInput,
  BulkFeedbackAssigneeInput,
  BulkFeedbackBoardInput,
  BulkFeedbackHiddenInput,
  BulkFeedbackStatusInput,
  BulkFeedbackTagInput,
  FeedbackTargetInput,
  FeedbackVoteResult,
  LinkFeedbackInput,
  MergeFeedbackInput,
  SetFeedbackAssigneeInput,
  SetFeedbackStatusInput,
} from "./action-types";

/**
 * Feedback server actions.
 *
 * Reads stay in `src/db/queries/feedback.ts`; these are the write paths. Each
 * action authenticates, checks the permission, verifies the post belongs to
 * the authorized product, and only then mutates.
 */

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const statusSchema = z.enum([
  "new",
  "under_review",
  "planned",
  "in_progress",
  "shipped",
  "closed",
] satisfies FeedbackStatus[]);

const targetSchema = z.object({
  workspaceSlug: z.string().min(1),
  productSlug: z.string().min(1),
  postId: z.uuid("That feedback request id is not valid."),
});

const bulkTargetSchema = z.object({
  workspaceSlug: z.string().min(1),
  productSlug: z.string().min(1),
  postIds: z
    .array(z.uuid("That feedback request id is not valid."))
    .min(1, "Select at least one request.")
    .max(100, "Select at most 100 requests at a time."),
});

/**
 * A workspace member's user id.
 *
 * Better Auth issues opaque string ids by default; `user.id` is text, not a
 * uuid. The membership lookup after parsing is what proves the id is real, so
 * this only bounds the value to the column width.
 */
const assigneeIdSchema = z.string().trim().min(1).max(120).nullable();

function revalidate(workspaceSlug: string, productSlug: string) {
  revalidatePath(`/app/${workspaceSlug}/${productSlug}`, "layout");
}

async function loadPost(tx: Transaction, productId: string, postId: string) {
  const rows = await tx
    .select()
    .from(feedbackPosts)
    .where(and(eq(feedbackPosts.id, postId), eq(feedbackPosts.productId, productId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateFeedbackStatusAction(
  input: SetFeedbackStatusInput,
): Promise<ActionResult<{ postId: string }>> {
  const parsed = targetSchema.extend({ status: statusSchema }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a valid feedback status." };

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "feedback:write",
  );
  if ("error" in authorized) return authorized.error;
  const { product } = authorized.context;
  const now = new Date();
  const dbStatus = toDbFeedbackStatus(parsed.data.status);

  try {
    const result = await db.transaction(async (tx) => {
      const post = await loadPost(tx, product.id, parsed.data.postId);
      if (!post) return { ok: false as const, error: "That feedback request no longer exists." };

      await tx
        .update(feedbackPosts)
        .set({ status: dbStatus, updatedAt: now })
        .where(and(eq(feedbackPosts.id, post.id), eq(feedbackPosts.productId, product.id)));

      if (post.status !== dbStatus) {
        await queueFeedbackStatusNotifications(tx, {
          productId: product.id,
          postId: post.id,
          toStatus: dbStatus,
          eventAt: now,
        });
      }

      return {
        ok: true as const,
        data: { postId: post.id },
        changed: post.status !== dbStatus,
        fromStatus: post.status as string,
      };
    });
    if (result.ok) {
      if (result.changed) {
        await pushFeedbackStatusToIssueTracker({
          productId: product.id,
          feedbackPostId: result.data.postId,
          fromStatus: result.fromStatus,
          toStatus: dbStatus,
        });
        await queueSlackStatusUpdate({ requestId: result.data.postId, status: dbStatus });
      }
      revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    }
    return result;
  } catch (error) {
    console.error("[feedback] status update failed", error);
    return { ok: false, error: "Could not change the feedback status. Please try again." };
  }
}

/**
 * Change the status of several requests in one write.
 *
 * Merged duplicates are skipped rather than silently reopened: their status is
 * controlled by the canonical request. The response reports how many were
 * updated and how many were skipped so the UI can be honest about it.
 */
export async function bulkUpdateFeedbackStatusAction(
  input: BulkFeedbackStatusInput,
): Promise<ActionResult<{ updated: number; skipped: number; undoId?: string }>> {
  const parsed = bulkTargetSchema.extend({ status: statusSchema }).safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Select requests and a status.",
    };
  }

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "feedback:write",
  );
  if ("error" in authorized) return authorized.error;
  const { product, user } = authorized.context;

  try {
    const result = await bulkUpdateFeedbackStatuses({
      productId: product.id,
      postIds: parsed.data.postIds,
      status: toDbFeedbackStatus(parsed.data.status),
      actorId: user.id,
    });

    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return { ok: true, data: result };
  } catch (error) {
    console.error("[feedback] bulk status update failed", error);
    return { ok: false, error: "Could not update those requests. Please try again." };
  }
}

/** Hide or restore several requests. Requires the moderation permission. */
export async function bulkSetFeedbackHiddenAction(
  input: BulkFeedbackHiddenInput,
): Promise<ActionResult<{ updated: number; undoId?: string }>> {
  const parsed = bulkTargetSchema.extend({ hidden: z.boolean() }).safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Select requests first.",
    };
  }

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "moderation:manage",
  );
  if ("error" in authorized) return authorized.error;
  const { product, user } = authorized.context;

  try {
    const result = await bulkSetFeedbackHidden({
      productId: product.id,
      postIds: parsed.data.postIds,
      hidden: parsed.data.hidden,
      hiddenBy: user.id,
      actorId: user.id,
    });

    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return { ok: true, data: result };
  } catch (error) {
    console.error("[feedback] bulk visibility change failed", error);
    return { ok: false, error: "Could not change visibility. Please try again." };
  }
}

/**
 * Assign one request to a workspace member, or unassign it.
 *
 * The assignee must belong to the product's workspace: an id from another
 * tenant would otherwise put a request on somebody who cannot read it.
 */
export async function setFeedbackAssigneeAction(
  input: SetFeedbackAssigneeInput,
): Promise<ActionResult<{ assigneeId: string | null }>> {
  const parsed = targetSchema
    .extend({ assigneeId: assigneeIdSchema })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Choose an assignee or leave it unassigned." };
  }

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "feedback:write",
  );
  if ("error" in authorized) return authorized.error;
  const { product, workspace } = authorized.context;

  try {
    if (parsed.data.assigneeId) {
      const member = await db
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, workspace.id),
            eq(workspaceMembers.userId, parsed.data.assigneeId),
          ),
        )
        .limit(1);
      if (!member[0]) {
        return { ok: false, error: "Choose a member of this workspace." };
      }
    }

    const updated = await db
      .update(feedbackPosts)
      .set({ assigneeId: parsed.data.assigneeId, updatedAt: new Date() })
      .where(
        and(
          eq(feedbackPosts.id, parsed.data.postId),
          eq(feedbackPosts.productId, product.id),
        ),
      )
      .returning({ id: feedbackPosts.id });
    if (!updated[0]) return { ok: false, error: "That feedback request no longer exists." };

    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return { ok: true, data: { assigneeId: parsed.data.assigneeId } };
  } catch (error) {
    console.error("[feedback] assignment failed", error);
    return { ok: false, error: "Could not change the assignee. Please try again." };
  }
}

/**
 * Set the team's planned quarter or date.
 *
 * The value is stored whatever the workspace policy says; whether customers
 * see it is decided when the public page is built. An empty value clears it.
 */
export async function setPlannedForAction(input: {
  workspaceSlug: string;
  productSlug: string;
  postId: string;
  plannedFor: string | null;
}): Promise<ActionResult<{ plannedFor: string | null }>> {
  const parsed = targetSchema
    .extend({ plannedFor: z.string().max(32).nullable() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "That planned-for value is not valid." };

  const normalized = normalizePlannedFor(parsed.data.plannedFor);
  if (!normalized.ok) return { ok: false, error: normalized.error };

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "feedback:write",
  );
  if ("error" in authorized) return authorized.error;
  const { product } = authorized.context;

  try {
    const updated = await db
      .update(feedbackPosts)
      .set({ plannedFor: normalized.value, updatedAt: new Date() })
      .where(
        and(
          eq(feedbackPosts.id, parsed.data.postId),
          eq(feedbackPosts.productId, product.id),
        ),
      )
      .returning({ id: feedbackPosts.id });
    if (!updated[0]) return { ok: false, error: "That feedback request no longer exists." };

    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    revalidatePath(
      `/p/${parsed.data.workspaceSlug}/${parsed.data.productSlug}`,
      "layout",
    );
    return { ok: true, data: { plannedFor: normalized.value } };
  } catch (error) {
    console.error("[feedback] planned-for update failed", error);
    return { ok: false, error: "Could not save that target. Please try again." };
  }
}

export async function bulkAssignFeedbackAction(
  input: BulkFeedbackAssigneeInput,
): Promise<ActionResult<{ updated: number; skipped: number; undoId?: string }>> {
  const parsed = bulkTargetSchema
    .extend({ assigneeId: assigneeIdSchema })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Select requests and an assignee." };
  }

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "feedback:write",
  );
  if ("error" in authorized) return authorized.error;
  const { product, workspace, user } = authorized.context;

  try {
    const result = await bulkSetFeedbackAssignee({
      productId: product.id,
      workspaceId: workspace.id,
      postIds: parsed.data.postIds,
      assigneeId: parsed.data.assigneeId,
      actorId: user.id,
    });

    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return { ok: true, data: result };
  } catch (error) {
    console.error("[feedback] bulk assignment failed", error);
    return { ok: false, error: "Could not assign those requests. Please try again." };
  }
}

/** Add one board tag to several requests; requests on another board are skipped. */
export async function bulkTagFeedbackAction(
  input: BulkFeedbackTagInput,
): Promise<ActionResult<{ updated: number; skipped: number; undoId?: string }>> {
  const parsed = bulkTargetSchema
    .extend({ tagId: z.uuid("Choose a tag.") })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Select requests and a tag." };
  }

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "feedback:write",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const result = await bulkAddFeedbackTag({
      productId: authorized.context.product.id,
      postIds: parsed.data.postIds,
      tagId: parsed.data.tagId,
      actorId: authorized.context.user.id,
    });

    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return { ok: true, data: result };
  } catch (error) {
    console.error("[feedback] bulk tag failed", error);
    return { ok: false, error: "Could not tag those requests. Please try again." };
  }
}

/** Move several requests to another board; tags from the old board are cleared. */
export async function bulkMoveFeedbackBoardAction(
  input: BulkFeedbackBoardInput,
): Promise<ActionResult<{ updated: number; skipped: number; undoId?: string }>> {
  const parsed = bulkTargetSchema
    .extend({ boardId: z.uuid("Choose a board.") })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Select requests and a board." };
  }

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "feedback:write",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const result = await bulkMoveFeedbackToBoard({
      productId: authorized.context.product.id,
      postIds: parsed.data.postIds,
      boardId: parsed.data.boardId,
      actorId: authorized.context.user.id,
    });

    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    revalidatePath(
      `/p/${parsed.data.workspaceSlug}/${parsed.data.productSlug}`,
      "layout",
    );
    return { ok: true, data: result };
  } catch (error) {
    console.error("[feedback] bulk board move failed", error);
    return { ok: false, error: "Could not move those requests. Please try again." };
  }
}

/**
 * Undo one bulk operation.
 *
 * Restores exactly what the batch recorded (status, visibility, assignee,
 * board plus its tags, or an added tag) and is single-use. Silent, like merge
 * undo: undoing a status is not a second customer-visible change.
 */
export async function undoFeedbackBulkActionAction(input: {
  workspaceSlug: string;
  productSlug: string;
  undoId: string;
}): Promise<ActionResult<{ restored: number }>> {
  const parsed = z
    .object({
      workspaceSlug: z.string().min(1),
      productSlug: z.string().min(1),
      undoId: z.uuid("That undo id is not valid."),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "That undo id is not valid." };

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "feedback:write",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const result = await undoFeedbackBulkAction({
      productId: authorized.context.product.id,
      undoId: parsed.data.undoId,
    });
    if (!result.ok) return result;

    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    revalidatePath(
      `/p/${parsed.data.workspaceSlug}/${parsed.data.productSlug}`,
      "layout",
    );
    return { ok: true, data: { restored: result.restored } };
  } catch (error) {
    console.error("[feedback] bulk undo failed", error);
    return { ok: false, error: "Could not undo that action. Please try again." };
  }
}

export async function toggleFeedbackVoteAction(
  input: FeedbackTargetInput,
): Promise<ActionResult<FeedbackVoteResult>> {
  const parsed = targetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That feedback request id is not valid." };

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "feedback:read",
  );
  if ("error" in authorized) return authorized.error;
  const { product, user } = authorized.context;

  try {
    const result = await db.transaction(async (tx) => {
      const post = await loadPost(tx, product.id, parsed.data.postId);
      if (!post) return { ok: false as const, error: "That feedback request no longer exists." };

      const existing = await tx
        .select({ id: feedbackVotes.id })
        .from(feedbackVotes)
        .where(
          and(
            eq(feedbackVotes.feedbackPostId, post.id),
            eq(feedbackVotes.voterId, user.id),
          ),
        )
        .limit(1);

      let voted: boolean;
      if (existing[0]) {
        await tx.delete(feedbackVotes).where(eq(feedbackVotes.id, existing[0].id));
        voted = false;
      } else {
        await tx
          .insert(feedbackVotes)
          .values({ feedbackPostId: post.id, voterId: user.id })
          .onConflictDoNothing();
        voted = true;
      }

      const count = await tx
        .select({ value: feedbackVotes.id })
        .from(feedbackVotes)
        .where(eq(feedbackVotes.feedbackPostId, post.id));

      return {
        ok: true as const,
        data: { postId: post.id, voted, votes: count.length },
      };
    });
    if (result.ok) revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return result;
  } catch (error) {
    console.error("[feedback] vote failed", error);
    return { ok: false, error: "Could not save that vote. Please try again." };
  }
}

export async function addFeedbackCommentAction(
  input: AddFeedbackCommentInput,
): Promise<ActionResult<{ postId: string }>> {
  const parsed = targetSchema
    .extend({
      body: z.string().trim().min(2, "Write at least two characters.").max(5_000),
      internal: z.boolean(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Write a comment before saving." };

  // Commenting is narrower than authoring: a free viewer may reply to an
  // existing request, but only content roles may write internal notes.
  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "feedback:comment",
  );
  if ("error" in authorized) return authorized.error;
  const { product, user } = authorized.context;
  if (parsed.data.internal && !hasPermission(authorized.context.role, "feedback:write")) {
    return { ok: false, error: "Viewers can add public comments, not internal notes." };
  }
  const now = new Date();

  try {
    const result = await db.transaction(async (tx) => {
      const post = await loadPost(tx, product.id, parsed.data.postId);
      if (!post) return { ok: false as const, error: "That feedback request no longer exists." };

      const inserted = await tx
        .insert(feedbackComments)
        .values({
          productId: product.id,
          feedbackPostId: post.id,
          authorId: user.id,
          authorName: user.name,
          authorType: "team",
          body: parsed.data.body,
          internal: parsed.data.internal,
        })
        .returning({ id: feedbackComments.id });
      await tx
        .update(feedbackPosts)
        .set({ updatedAt: now })
        .where(and(eq(feedbackPosts.id, post.id), eq(feedbackPosts.productId, product.id)));

      const commentId = inserted[0]?.id;
      if (commentId && !parsed.data.internal) {
        await queueFeedbackReplyNotifications(tx, {
          productId: product.id,
          postId: post.id,
          commentId,
          authorName: user.name,
          body: parsed.data.body,
          eventAt: now,
        });
      }

      return { ok: true as const, data: { postId: post.id } };
    });
    if (result.ok) revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return result;
  } catch (error) {
    console.error("[feedback] comment failed", error);
    return { ok: false, error: "Could not add the comment. Please try again." };
  }
}

export async function linkFeedbackToReleaseAction(
  input: LinkFeedbackInput,
): Promise<ActionResult<{ postId: string }>> {
  const parsed = targetSchema
    .extend({ targetId: z.uuid().nullable() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "That release id is not valid." };

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "feedback:write",
  );
  if ("error" in authorized) return authorized.error;
  const { product } = authorized.context;
  const now = new Date();

  try {
    const result = await db.transaction(async (tx) => {
      const post = await loadPost(tx, product.id, parsed.data.postId);
      if (!post) return { ok: false as const, error: "That feedback request no longer exists." };

      let linkedRelease: { id: string; status: string } | null = null;
      if (parsed.data.targetId) {
        const rows = await tx
          .select({ id: releases.id, status: releases.status })
          .from(releases)
          .where(
            and(eq(releases.id, parsed.data.targetId), eq(releases.productId, product.id)),
          )
          .limit(1);
        if (!rows[0]) {
          return { ok: false as const, error: "That release is not available in this product." };
        }
        linkedRelease = rows[0];
      }

      await tx
        .delete(releaseFeedbackLinks)
        .where(eq(releaseFeedbackLinks.feedbackPostId, post.id));
      if (parsed.data.targetId) {
        await tx
          .insert(releaseFeedbackLinks)
          .values({
            productId: product.id,
            releaseId: parsed.data.targetId,
            feedbackPostId: post.id,
          })
          .onConflictDoNothing();
      }

      const status =
        linkedRelease?.status === "published" ? "shipped" : post.status;
      await tx
        .update(feedbackPosts)
        .set({ status, updatedAt: now })
        .where(and(eq(feedbackPosts.id, post.id), eq(feedbackPosts.productId, product.id)));

      if (post.status !== status) {
        await queueFeedbackStatusNotifications(tx, {
          productId: product.id,
          postId: post.id,
          toStatus: status,
          eventAt: now,
        });
      }

      return { ok: true as const, data: { postId: post.id } };
    });
    if (result.ok) revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return result;
  } catch (error) {
    console.error("[feedback] release link failed", error);
    return { ok: false, error: "Could not update the release link. Please try again." };
  }
}

export async function mergeFeedbackAction(
  input: MergeFeedbackInput,
): Promise<ActionResult<{ postId: string }>> {
  const parsed = targetSchema.extend({ targetId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a request to merge into." };
  if (parsed.data.postId === parsed.data.targetId) {
    return { ok: false, error: "Choose a different request to merge into." };
  }

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "feedback:write",
  );
  if ("error" in authorized) return authorized.error;
  const { product, user } = authorized.context;

  try {
    const result = await mergeFeedbackRequests({
      productId: product.id,
      sourceId: parsed.data.postId,
      targetId: parsed.data.targetId,
      userId: user.id,
    });
    if (!result.ok) return result;

    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return { ok: true, data: { postId: result.targetId } };
  } catch (error) {
    console.error("[feedback] merge failed", error);
    return { ok: false, error: "Could not merge the requests. Please try again." };
  }
}

export async function unmergeFeedbackAction(
  input: FeedbackTargetInput,
): Promise<ActionResult<{ postId: string }>> {
  const parsed = targetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That feedback request id is not valid." };

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "feedback:write",
  );
  if ("error" in authorized) return authorized.error;
  const { product } = authorized.context;

  try {
    const result = await unmergeFeedbackRequest({
      productId: product.id,
      sourceId: parsed.data.postId,
    });
    if (!result.ok) return result;

    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return { ok: true, data: { postId: result.postId } };
  } catch (error) {
    console.error("[feedback] unmerge failed", error);
    return { ok: false, error: "Could not undo the merge. Please try again." };
  }
}

/**
 * Hide or unhide one request.
 *
 * Hiding is a moderation control, independent of the request's status and of
 * the approval queue: a published request can be taken down without rejecting
 * its author, and restored later.
 */
export async function setFeedbackHiddenAction(input: {
  workspaceSlug: string;
  productSlug: string;
  postId: string;
  hidden: boolean;
}): Promise<ActionResult<{ hidden: boolean }>> {
  const parsed = targetSchema.extend({ hidden: z.boolean() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "That feedback request id is not valid." };

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "moderation:manage",
  );
  if ("error" in authorized) return authorized.error;
  const { product, user } = authorized.context;

  try {
    const now = new Date();
    const updated = await db
      .update(feedbackPosts)
      .set({
        hiddenAt: parsed.data.hidden ? now : null,
        hiddenBy: parsed.data.hidden ? user.id : null,
        updatedAt: now,
      })
      .where(
        and(
          eq(feedbackPosts.id, parsed.data.postId),
          eq(feedbackPosts.productId, product.id),
        ),
      )
      .returning({ id: feedbackPosts.id });

    if (!updated[0]) return { ok: false, error: "That feedback request no longer exists." };

    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return { ok: true, data: { hidden: parsed.data.hidden } };
  } catch (error) {
    console.error("[feedback] visibility change failed", error);
    return { ok: false, error: "Could not change visibility. Please try again." };
  }
}
