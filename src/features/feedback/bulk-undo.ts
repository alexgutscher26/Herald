import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";

import { db, type Database } from "@/db";
import { feedbackPosts } from "@/db/schema/feedback";
import {
  feedbackBulkActions,
  feedbackTagLinks,
  type BulkUndoEntry,
} from "@/db/schema/feedback-extensions";

/**
 * Undo for bulk feedback writes.
 *
 * Every bulk operation that changes data captures the previous value of each
 * request in the same transaction as the write, so an undo can never exist for
 * a change that did not happen. Undo is single-use (`undone_at`), scoped by
 * product, and silent: like merge undo, it restores state without sending a
 * second round of customer notifications.
 */

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

type FeedbackStatusValue =
  | "open"
  | "under_review"
  | "planned"
  | "in_progress"
  | "shipped"
  | "closed";

export async function recordBulkAction(
  tx: Transaction,
  input: {
    productId: string;
    actorId: string | null | undefined;
    kind: "status" | "visibility" | "assignee" | "board" | "tag";
    entries: BulkUndoEntry[];
  },
): Promise<string | null> {
  if (!input.actorId || input.entries.length === 0) return null;

  const rows = await tx
    .insert(feedbackBulkActions)
    .values({
      productId: input.productId,
      actorId: input.actorId,
      kind: input.kind,
      entries: input.entries,
    })
    .returning({ id: feedbackBulkActions.id });

  return rows[0]?.id ?? null;
}

export type UndoBulkResult =
  | { ok: true; restored: number }
  | { ok: false; error: string };

export async function undoFeedbackBulkAction(input: {
  productId: string;
  undoId: string;
}): Promise<UndoBulkResult> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(feedbackBulkActions)
      .where(
        and(
          eq(feedbackBulkActions.id, input.undoId),
          eq(feedbackBulkActions.productId, input.productId),
        ),
      )
      .limit(1);

    const batch = rows[0];
    if (!batch) return { ok: false, error: "That bulk action no longer exists." };
    if (batch.undoneAt) {
      return { ok: false, error: "That bulk action was already undone." };
    }

    // Claim the batch first: two concurrent undo clicks cannot both restore.
    const claimed = await tx
      .update(feedbackBulkActions)
      .set({ undoneAt: new Date() })
      .where(
        and(
          eq(feedbackBulkActions.id, input.undoId),
          eq(feedbackBulkActions.productId, input.productId),
          isNull(feedbackBulkActions.undoneAt),
        ),
      )
      .returning({ id: feedbackBulkActions.id });
    if (!claimed[0]) {
      return { ok: false, error: "That bulk action was already undone." };
    }

    let restored = 0;
    const now = new Date();

    for (const entry of batch.entries) {
      const scope = and(
        eq(feedbackPosts.id, entry.postId),
        eq(feedbackPosts.productId, input.productId),
      );

      switch (batch.kind) {
        case "status": {
          if (entry.previousStatus === undefined) break;
          const updated = await tx
            .update(feedbackPosts)
            .set({
              status: entry.previousStatus as FeedbackStatusValue,
              updatedAt: now,
            })
            .where(scope)
            .returning({ id: feedbackPosts.id });
          if (updated[0]) restored += 1;
          break;
        }
        case "visibility": {
          const updated = await tx
            .update(feedbackPosts)
            .set({
              hiddenAt: entry.previousHiddenAt ? new Date(entry.previousHiddenAt) : null,
              hiddenBy: entry.previousHiddenBy ?? null,
              updatedAt: now,
            })
            .where(scope)
            .returning({ id: feedbackPosts.id });
          if (updated[0]) restored += 1;
          break;
        }
        case "assignee": {
          const updated = await tx
            .update(feedbackPosts)
            .set({
              assigneeId: entry.previousAssigneeId ?? null,
              updatedAt: now,
            })
            .where(scope)
            .returning({ id: feedbackPosts.id });
          if (updated[0]) restored += 1;
          break;
        }
        case "board": {
          const updated = await tx
            .update(feedbackPosts)
            .set({
              boardId: entry.previousBoardId ?? null,
              updatedAt: now,
            })
            .where(scope)
            .returning({ id: feedbackPosts.id });
          if (!updated[0]) break;

          await tx
            .delete(feedbackTagLinks)
            .where(
              and(
                eq(feedbackTagLinks.productId, input.productId),
                eq(feedbackTagLinks.feedbackPostId, entry.postId),
              ),
            );
          if (entry.previousTagIds && entry.previousTagIds.length > 0) {
            await tx
              .insert(feedbackTagLinks)
              .values(
                entry.previousTagIds.map((tagId) => ({
                  productId: input.productId,
                  feedbackPostId: entry.postId,
                  tagId,
                })),
              )
              .onConflictDoNothing();
          }
          restored += 1;
          break;
        }
        case "tag": {
          if (!entry.addedTagId) break;
          const removed = await tx
            .delete(feedbackTagLinks)
            .where(
              and(
                eq(feedbackTagLinks.productId, input.productId),
                eq(feedbackTagLinks.feedbackPostId, entry.postId),
                eq(feedbackTagLinks.tagId, entry.addedTagId),
              ),
            )
            .returning({ postId: feedbackTagLinks.feedbackPostId });
          if (removed[0]) restored += 1;
          break;
        }
      }
    }

    return { ok: true, restored };
  });
}

/** Newest first, for a future history panel; not exposed to customers. */
export async function listRecentBulkActions(input: {
  productId: string;
  limit?: number;
}): Promise<
  {
    id: string;
    kind: string;
    createdAt: string;
    undoneAt: string | null;
    count: number;
  }[]
> {
  const rows = await db
    .select()
    .from(feedbackBulkActions)
    .where(eq(feedbackBulkActions.productId, input.productId))
    .orderBy(desc(feedbackBulkActions.createdAt))
    .limit(Math.min(Math.max(input.limit ?? 10, 1), 50));

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    createdAt: row.createdAt.toISOString(),
    undoneAt: row.undoneAt ? row.undoneAt.toISOString() : null,
    count: row.entries.length,
  }));
}
