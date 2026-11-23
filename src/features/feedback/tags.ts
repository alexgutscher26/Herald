import "server-only";

import { and, eq, max } from "drizzle-orm";

import { db } from "@/db";
import { boardTags, boards } from "@/db/schema/boards";
import { feedbackPosts } from "@/db/schema/feedback";
import { feedbackTagLinks } from "@/db/schema/feedback-extensions";

/**
 * Tag writes.
 *
 * Every function takes an already-authorized `productId` and proves the board,
 * post or tag belongs to it. Tag links additionally require the tag and the
 * post to share a board, which the composite keys alone cannot express.
 */

export type TagResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Drizzle wraps the driver error, so inspect the cause chain for 23505. */
function isUniqueViolation(error: unknown): boolean {
  let current = error as
    | { code?: string; message?: string; cause?: unknown }
    | null
    | undefined;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (current.code === "23505") return true;
    if (typeof current.message === "string" && /unique|duplicate/i.test(current.message)) {
      return true;
    }
    current = current.cause as typeof current;
  }
  return false;
}

export async function createTag(input: {
  productId: string;
  boardId: string;
  name: string;
  color: string | null;
}): Promise<TagResult<{ tagId: string }>> {
  const board = await db
    .select({ id: boards.id })
    .from(boards)
    .where(and(eq(boards.id, input.boardId), eq(boards.productId, input.productId)))
    .limit(1);
  if (!board[0]) return { ok: false, error: "That board no longer exists." };

  const existing = await db
    .select({ id: boardTags.id })
    .from(boardTags)
    .where(and(eq(boardTags.boardId, input.boardId), eq(boardTags.name, input.name)))
    .limit(1);
  if (existing[0]) {
    return { ok: false, error: "That board already has a tag with this name." };
  }

  const positionRows = await db
    .select({ value: max(boardTags.position) })
    .from(boardTags)
    .where(eq(boardTags.boardId, input.boardId));

  try {
    const inserted = await db
      .insert(boardTags)
      .values({
        boardId: input.boardId,
        productId: input.productId,
        name: input.name,
        color: input.color,
        position: (positionRows[0]?.value ?? 0) + 1,
      })
      .returning({ id: boardTags.id });

    const tagId = inserted[0]?.id;
    if (!tagId) return { ok: false, error: "Could not create that tag." };
    return { ok: true, data: { tagId } };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: "That board already has a tag with this name." };
    }
    throw error;
  }
}

export async function deleteTag(input: {
  productId: string;
  tagId: string;
}): Promise<TagResult<{ deleted: true }>> {
  const deleted = await db
    .delete(boardTags)
    .where(and(eq(boardTags.id, input.tagId), eq(boardTags.productId, input.productId)))
    .returning({ id: boardTags.id });
  if (!deleted[0]) return { ok: false, error: "That tag no longer exists." };
  return { ok: true, data: { deleted: true } };
}

export async function replacePostTags(input: {
  productId: string;
  postId: string;
  tagIds: string[];
}): Promise<TagResult<{ tagIds: string[] }>> {
  const post = await db
    .select({ id: feedbackPosts.id, boardId: feedbackPosts.boardId })
    .from(feedbackPosts)
    .where(
      and(eq(feedbackPosts.id, input.postId), eq(feedbackPosts.productId, input.productId)),
    )
    .limit(1);
  const boardId = post[0]?.boardId;
  if (!post[0] || !boardId) {
    return { ok: false, error: "That request is not on a board yet." };
  }

  const tagIds = [...new Set(input.tagIds)];
  if (tagIds.length > 0) {
    const valid = await db
      .select({ id: boardTags.id })
      .from(boardTags)
      .where(
        and(eq(boardTags.boardId, boardId), eq(boardTags.productId, input.productId)),
      );
    const validIds = new Set(valid.map((tag) => tag.id));
    if (tagIds.some((tagId) => !validIds.has(tagId))) {
      return { ok: false, error: "Choose tags from this request's board." };
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(feedbackTagLinks)
      .where(eq(feedbackTagLinks.feedbackPostId, input.postId));
    if (tagIds.length > 0) {
      await tx.insert(feedbackTagLinks).values(
        tagIds.map((tagId) => ({
          feedbackPostId: input.postId,
          tagId,
          productId: input.productId,
        })),
      );
    }
  });

  return { ok: true, data: { tagIds } };
}
