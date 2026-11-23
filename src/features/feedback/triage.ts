import "server-only";

import { and, count, eq, inArray, isNull, ne } from "drizzle-orm";

import { db } from "@/db";
import { boardTags, boards } from "@/db/schema/boards";
import { feedbackPosts } from "@/db/schema/feedback";
import {
  feedbackTagLinks,
  type BulkUndoEntry,
} from "@/db/schema/feedback-extensions";
import { workspaceMembers } from "@/db/schema/workspaces";
import { pushFeedbackStatusToIssueTracker } from "@/features/integrations/issue-service";
import { queueFeedbackStatusNotifications } from "@/features/notifications/service";
import { queueSlackStatusUpdate } from "@/features/slack/notify";

import { recordBulkAction } from "./bulk-undo";

/**
 * Bulk triage.
 *
 * Every query is scoped by `productId`; a caller cannot act on a post from
 * another product by guessing its id. Merged duplicates are intentionally
 * skipped by status changes because the canonical request owns their status.
 *
 * When an actor is supplied, the previous value of each changed request is
 * written to `feedback_bulk_actions` in the same transaction, so the operation
 * can be undone with the same fidelity as a merge.
 */

export type BulkStatusResult = {
  updated: number;
  skipped: number;
  undoId?: string;
};

export async function bulkUpdateFeedbackStatuses(input: {
  productId: string;
  postIds: string[];
  status: "open" | "under_review" | "planned" | "in_progress" | "shipped" | "closed";
  actorId?: string | null;
  now?: Date;
}): Promise<BulkStatusResult> {
  const postIds = [...new Set(input.postIds)];
  const now = input.now ?? new Date();

  let changedIds: string[] = [];
  const changedForSync: { id: string; fromStatus: string }[] = [];
  const outcome = await db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: feedbackPosts.id,
        mergedIntoId: feedbackPosts.mergedIntoId,
        status: feedbackPosts.status,
      })
      .from(feedbackPosts)
      .where(
        and(
          eq(feedbackPosts.productId, input.productId),
          inArray(feedbackPosts.id, postIds),
        ),
      );

    const eligible = rows
      .filter((row) => row.mergedIntoId === null)
      .map((row) => row.id);
    const previousStatus = new Map(rows.map((row) => [row.id, row.status]));

    let undoId: string | undefined;
    if (eligible.length > 0) {
      const changed = await tx
        .update(feedbackPosts)
        .set({ status: input.status, updatedAt: now })
        .where(
          and(
            eq(feedbackPosts.productId, input.productId),
            inArray(feedbackPosts.id, eligible),
            ne(feedbackPosts.status, input.status),
          ),
        )
        .returning({ id: feedbackPosts.id });

      for (const row of changed) {
        await queueFeedbackStatusNotifications(tx, {
          productId: input.productId,
          postId: row.id,
          toStatus: input.status,
          eventAt: now,
        });
      }
      changedIds = changed.map((row) => row.id);
      for (const row of changed) {
        const fromStatus = previousStatus.get(row.id);
        if (fromStatus) changedForSync.push({ id: row.id, fromStatus });
      }

      const entries: BulkUndoEntry[] = changed.flatMap((row) => {
        const status = previousStatus.get(row.id);
        return status ? [{ postId: row.id, previousStatus: status }] : [];
      });
      const recorded = await recordBulkAction(tx, {
        productId: input.productId,
        actorId: input.actorId,
        kind: "status",
        entries,
      });
      if (recorded) undoId = recorded;
    }

    return {
      updated: eligible.length,
      skipped: postIds.length - eligible.length,
      ...(undoId ? { undoId } : {}),
    };
  });

  for (const requestId of changedIds) {
    await queueSlackStatusUpdate({ requestId, status: input.status });
  }
  for (const request of changedForSync.slice(0, 50)) {
    await pushFeedbackStatusToIssueTracker({
      productId: input.productId,
      feedbackPostId: request.id,
      fromStatus: request.fromStatus,
      toStatus: input.status,
    });
  }

  return outcome;
}

/** Tags are board-scoped, and a request carries at most ten. */
const MAX_TAGS_PER_REQUEST = 10;

/**
 * Assign or unassign several requests.
 *
 * The assignee must be a member of the product's workspace, so a client cannot
 * put a request on somebody who cannot read it. Merged duplicates are skipped:
 * their owner is the canonical request.
 */
export async function bulkSetFeedbackAssignee(input: {
  productId: string;
  workspaceId: string;
  postIds: string[];
  assigneeId: string | null;
  actorId?: string | null;
  now?: Date;
}): Promise<BulkStatusResult> {
  const postIds = [...new Set(input.postIds)];
  const now = input.now ?? new Date();

  if (input.assigneeId !== null) {
    const member = await db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, input.workspaceId),
          eq(workspaceMembers.userId, input.assigneeId),
        ),
      )
      .limit(1);
    if (!member[0]) return { updated: 0, skipped: postIds.length };
  }

  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: feedbackPosts.id,
        mergedIntoId: feedbackPosts.mergedIntoId,
        assigneeId: feedbackPosts.assigneeId,
      })
      .from(feedbackPosts)
      .where(
        and(
          eq(feedbackPosts.productId, input.productId),
          inArray(feedbackPosts.id, postIds),
        ),
      );

    const eligible = rows
      .filter((row) => row.mergedIntoId === null)
      .map((row) => row.id);

    if (eligible.length === 0) {
      return { updated: 0, skipped: postIds.length };
    }

    const previousAssignee = new Map(rows.map((row) => [row.id, row.assigneeId]));
    const updated = await tx
      .update(feedbackPosts)
      .set({ assigneeId: input.assigneeId, updatedAt: now })
      .where(
        and(
          eq(feedbackPosts.productId, input.productId),
          inArray(feedbackPosts.id, eligible),
        ),
      )
      .returning({ id: feedbackPosts.id });

    const entries: BulkUndoEntry[] = updated.map((row) => ({
      postId: row.id,
      previousAssigneeId: previousAssignee.get(row.id) ?? null,
    }));
    const undoId = await recordBulkAction(tx, {
      productId: input.productId,
      actorId: input.actorId,
      kind: "assignee",
      entries,
    });

    return {
      updated: updated.length,
      skipped: postIds.length - updated.length,
      ...(undoId ? { undoId } : {}),
    };
  });
}

/**
 * Add one tag to several requests.
 *
 * A tag belongs to a board, so only requests already on that board can take
 * it; everything else is reported as skipped rather than silently linked. The
 * ten-tag ceiling is checked per request for the same reason.
 */
export async function bulkAddFeedbackTag(input: {
  productId: string;
  postIds: string[];
  tagId: string;
  actorId?: string | null;
}): Promise<BulkStatusResult> {
  const postIds = [...new Set(input.postIds)];

  const tagRows = await db
    .select({ id: boardTags.id, boardId: boardTags.boardId })
    .from(boardTags)
    .where(
      and(eq(boardTags.id, input.tagId), eq(boardTags.productId, input.productId)),
    )
    .limit(1);
  const tag = tagRows[0];
  if (!tag) return { updated: 0, skipped: postIds.length };

  return db.transaction(async (tx) => {
    const candidates = await tx
      .select({ id: feedbackPosts.id })
      .from(feedbackPosts)
      .where(
        and(
          eq(feedbackPosts.productId, input.productId),
          inArray(feedbackPosts.id, postIds),
          eq(feedbackPosts.boardId, tag.boardId),
          isNull(feedbackPosts.mergedIntoId),
        ),
      );
    const candidateIds = candidates.map((row) => row.id);
    if (candidateIds.length === 0) {
      return { updated: 0, skipped: postIds.length };
    }

    const existing = await tx
      .select({ postId: feedbackTagLinks.feedbackPostId, value: count() })
      .from(feedbackTagLinks)
      .where(inArray(feedbackTagLinks.feedbackPostId, candidateIds))
      .groupBy(feedbackTagLinks.feedbackPostId);
    const full = new Set(
      existing
        .filter((row) => Number(row.value) >= MAX_TAGS_PER_REQUEST)
        .map((row) => row.postId),
    );

    const insertable = candidateIds.filter((id) => !full.has(id));
    if (insertable.length === 0) {
      return { updated: 0, skipped: postIds.length };
    }

    const inserted = await tx
      .insert(feedbackTagLinks)
      .values(
        insertable.map((postId) => ({
          productId: input.productId,
          feedbackPostId: postId,
          tagId: tag.id,
        })),
      )
      .onConflictDoNothing()
      .returning({ postId: feedbackTagLinks.feedbackPostId });

    const undoId = await recordBulkAction(tx, {
      productId: input.productId,
      actorId: input.actorId,
      kind: "tag",
      entries: inserted.map((row) => ({
        postId: row.postId,
        addedTagId: tag.id,
      })),
    });

    return {
      updated: inserted.length,
      skipped: postIds.length - inserted.length,
      ...(undoId ? { undoId } : {}),
    };
  });
}

/**
 * Move several requests to another board of the same product.
 *
 * Tags belong to the old board, so the move clears them in the same
 * transaction: leaving them behind would show a request wearing tags its new
 * board does not have. The removed links are captured so undo can restore
 * them.
 */
export async function bulkMoveFeedbackToBoard(input: {
  productId: string;
  postIds: string[];
  boardId: string;
  actorId?: string | null;
  now?: Date;
}): Promise<BulkStatusResult> {
  const postIds = [...new Set(input.postIds)];
  const now = input.now ?? new Date();

  const board = await db
    .select({ id: boards.id })
    .from(boards)
    .where(
      and(
        eq(boards.id, input.boardId),
        eq(boards.productId, input.productId),
        isNull(boards.archivedAt),
      ),
    )
    .limit(1);
  if (!board[0]) return { updated: 0, skipped: postIds.length };

  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: feedbackPosts.id,
        mergedIntoId: feedbackPosts.mergedIntoId,
        boardId: feedbackPosts.boardId,
      })
      .from(feedbackPosts)
      .where(
        and(
          eq(feedbackPosts.productId, input.productId),
          inArray(feedbackPosts.id, postIds),
        ),
      );

    const eligible = rows
      .filter((row) => row.mergedIntoId === null)
      .map((row) => row.id);
    if (eligible.length === 0) {
      return { updated: 0, skipped: postIds.length };
    }

    const previousBoard = new Map(rows.map((row) => [row.id, row.boardId]));
    const priorTags = await tx
      .select({
        postId: feedbackTagLinks.feedbackPostId,
        tagId: feedbackTagLinks.tagId,
      })
      .from(feedbackTagLinks)
      .where(
        and(
          eq(feedbackTagLinks.productId, input.productId),
          inArray(feedbackTagLinks.feedbackPostId, eligible),
        ),
      );
    const tagsByPost = new Map<string, string[]>();
    for (const link of priorTags) {
      const list = tagsByPost.get(link.postId) ?? [];
      list.push(link.tagId);
      tagsByPost.set(link.postId, list);
    }

    await tx
      .update(feedbackPosts)
      .set({ boardId: input.boardId, updatedAt: now })
      .where(
        and(
          eq(feedbackPosts.productId, input.productId),
          inArray(feedbackPosts.id, eligible),
        ),
      );

    await tx
      .delete(feedbackTagLinks)
      .where(
        and(
          eq(feedbackTagLinks.productId, input.productId),
          inArray(feedbackTagLinks.feedbackPostId, eligible),
        ),
      );

    const entries: BulkUndoEntry[] = eligible.map((postId) => ({
      postId,
      previousBoardId: previousBoard.get(postId) ?? null,
      previousTagIds: tagsByPost.get(postId) ?? [],
    }));
    const undoId = await recordBulkAction(tx, {
      productId: input.productId,
      actorId: input.actorId,
      kind: "board",
      entries,
    });

    return {
      updated: eligible.length,
      skipped: postIds.length - eligible.length,
      ...(undoId ? { undoId } : {}),
    };
  });
}

export async function bulkSetFeedbackHidden(input: {
  productId: string;
  postIds: string[];
  hidden: boolean;
  hiddenBy: string;
  actorId?: string | null;
  now?: Date;
}): Promise<{ updated: number; undoId?: string }> {
  const postIds = [...new Set(input.postIds)];
  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: feedbackPosts.id,
        hiddenAt: feedbackPosts.hiddenAt,
        hiddenBy: feedbackPosts.hiddenBy,
      })
      .from(feedbackPosts)
      .where(
        and(
          eq(feedbackPosts.productId, input.productId),
          inArray(feedbackPosts.id, postIds),
        ),
      );
    const previous = new Map(rows.map((row) => [row.id, row]));

    const updated = await tx
      .update(feedbackPosts)
      .set({
        hiddenAt: input.hidden ? now : null,
        hiddenBy: input.hidden ? input.hiddenBy : null,
        updatedAt: now,
      })
      .where(
        and(
          eq(feedbackPosts.productId, input.productId),
          inArray(feedbackPosts.id, postIds),
        ),
      )
      .returning({ id: feedbackPosts.id });

    const entries: BulkUndoEntry[] = updated.flatMap((row) => {
      const before = previous.get(row.id);
      if (!before) return [];
      return [
        {
          postId: row.id,
          previousHiddenAt: before.hiddenAt ? before.hiddenAt.toISOString() : null,
          previousHiddenBy: before.hiddenBy ?? null,
        },
      ];
    });
    const undoId = await recordBulkAction(tx, {
      productId: input.productId,
      actorId: input.actorId,
      kind: "visibility",
      entries,
    });

    return { updated: updated.length, ...(undoId ? { undoId } : {}) };
  });
}
