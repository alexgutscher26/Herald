import { afterAll, beforeAll, describe, expect } from "bun:test";

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { feedbackPosts } from "@/db/schema/feedback";
import { feedbackTagLinks } from "@/db/schema/feedback-extensions";
import { createTag } from "@/features/feedback/tags";
import { undoFeedbackBulkAction } from "@/features/feedback/bulk-undo";
import {
  bulkAddFeedbackTag,
  bulkMoveFeedbackToBoard,
  bulkSetFeedbackAssignee,
  bulkSetFeedbackHidden,
  bulkUpdateFeedbackStatuses,
} from "@/features/feedback/triage";

import {
  createBoard,
  createFeedbackPost,
  createMember,
  createProduct,
  createUser,
  createWorkspace,
} from "./factories";
import {
  SETUP_TIMEOUT_MS,
  isolatedTest,
  setupTestDatabase,
  teardownTestDatabase,
} from "./harness";

/**
 * Bulk workflow against real Postgres.
 *
 * The rules worth proving are the ones a client cannot enforce: an assignee has
 * to belong to the workspace, a tag only fits requests on its board, and a
 * board move must not leave the old board's tags behind.
 */

beforeAll(async () => {
  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

async function tenant() {
  const workspace = await createWorkspace();
  const product = await createProduct(workspace.id);
  const board = await createBoard(product.id, { slug: "feedback", name: "Feedback" });
  return { workspace, product, board };
}

async function assigneeOf(postId: string): Promise<string | null> {
  const rows = await db
    .select({ assigneeId: feedbackPosts.assigneeId })
    .from(feedbackPosts)
    .where(eq(feedbackPosts.id, postId))
    .limit(1);
  return rows[0]?.assigneeId ?? null;
}

describe("bulk assignment", () => {
  isolatedTest("assigns live requests, skips merged duplicates and can unassign", async () => {
    const t = await tenant();
    const { user } = await createMember(t.workspace.id, {
      role: "editor",
      user: await createUser({ name: "Ada Owner" }),
    });
    const target = await createFeedbackPost({
      productId: t.product.id,
      boardId: t.board.id,
    });
    const merged = await createFeedbackPost({
      productId: t.product.id,
      boardId: t.board.id,
      mergedIntoId: target.id,
    });
    const live = await createFeedbackPost({
      productId: t.product.id,
      boardId: t.board.id,
    });

    const assigned = await bulkSetFeedbackAssignee({
      productId: t.product.id,
      workspaceId: t.workspace.id,
      postIds: [live.id, merged.id],
      assigneeId: user.id,
    });

    expect(assigned).toEqual({ updated: 1, skipped: 1 });
    expect(await assigneeOf(live.id)).toBe(user.id);
    expect(await assigneeOf(merged.id)).toBeNull();

    const cleared = await bulkSetFeedbackAssignee({
      productId: t.product.id,
      workspaceId: t.workspace.id,
      postIds: [live.id],
      assigneeId: null,
    });
    expect(cleared).toEqual({ updated: 1, skipped: 0 });
    expect(await assigneeOf(live.id)).toBeNull();
  });

  isolatedTest("refuses an assignee outside the workspace and rows outside the product", async () => {
    const mine = await tenant();
    const theirs = await tenant();
    const outsider = await createUser({ email: "outsider@example.test" });
    const post = await createFeedbackPost({
      productId: mine.product.id,
      boardId: mine.board.id,
    });
    const foreign = await createFeedbackPost({
      productId: theirs.product.id,
      boardId: theirs.board.id,
    });

    const refused = await bulkSetFeedbackAssignee({
      productId: mine.product.id,
      workspaceId: mine.workspace.id,
      postIds: [post.id],
      assigneeId: outsider.id,
    });
    expect(refused).toEqual({ updated: 0, skipped: 1 });
    expect(await assigneeOf(post.id)).toBeNull();

    const crossTenant = await bulkSetFeedbackAssignee({
      productId: mine.product.id,
      workspaceId: mine.workspace.id,
      postIds: [foreign.id],
      assigneeId: null,
    });
    expect(crossTenant).toEqual({ updated: 0, skipped: 1 });
  });
});

describe("bulk tagging", () => {
  isolatedTest("tags only requests on the tag's board and is idempotent", async () => {
    const t = await tenant();
    const otherBoard = await createBoard(t.product.id, {
      slug: "bugs",
      name: "Bugs",
    });
    const onBoard = await createFeedbackPost({
      productId: t.product.id,
      boardId: t.board.id,
    });
    const offBoard = await createFeedbackPost({
      productId: t.product.id,
      boardId: otherBoard.id,
    });
    const unboarded = await createFeedbackPost({ productId: t.product.id });

    const tag = await createTag({
      productId: t.product.id,
      boardId: t.board.id,
      name: "sso",
      color: null,
    });
    if (!tag.ok) throw new Error(tag.error);

    const first = await bulkAddFeedbackTag({
      productId: t.product.id,
      postIds: [onBoard.id, offBoard.id, unboarded.id],
      tagId: tag.data.tagId,
    });
    expect(first).toEqual({ updated: 1, skipped: 2 });

    const links = await db
      .select({ postId: feedbackTagLinks.feedbackPostId })
      .from(feedbackTagLinks)
      .where(eq(feedbackTagLinks.tagId, tag.data.tagId));
    expect(links.map((link) => link.postId)).toEqual([onBoard.id]);

    const again = await bulkAddFeedbackTag({
      productId: t.product.id,
      postIds: [onBoard.id],
      tagId: tag.data.tagId,
    });
    expect(again.updated).toBe(0);
  });

  isolatedTest("refuses a tag from another product", async () => {
    const mine = await tenant();
    const theirs = await tenant();
    const post = await createFeedbackPost({
      productId: mine.product.id,
      boardId: mine.board.id,
    });
    const foreignTag = await createTag({
      productId: theirs.product.id,
      boardId: theirs.board.id,
      name: "foreign",
      color: null,
    });
    if (!foreignTag.ok) throw new Error(foreignTag.error);

    const result = await bulkAddFeedbackTag({
      productId: mine.product.id,
      postIds: [post.id],
      tagId: foreignTag.data.tagId,
    });
    expect(result).toEqual({ updated: 0, skipped: 1 });

    const rows = await db
      .select({ tagId: feedbackTagLinks.tagId })
      .from(feedbackTagLinks)
      .where(eq(feedbackTagLinks.feedbackPostId, post.id));
    expect(rows).toHaveLength(0);
  });
});

describe("bulk board move", () => {
  isolatedTest("moves requests, clears old-board tags and skips merged duplicates", async () => {
    const t = await tenant();
    const target = await createBoard(t.product.id, { slug: "product", name: "Product" });
    const moved = await createFeedbackPost({
      productId: t.product.id,
      boardId: t.board.id,
    });
    const canonical = await createFeedbackPost({
      productId: t.product.id,
      boardId: t.board.id,
    });
    const merged = await createFeedbackPost({
      productId: t.product.id,
      boardId: t.board.id,
      mergedIntoId: canonical.id,
    });

    const tag = await createTag({
      productId: t.product.id,
      boardId: t.board.id,
      name: "migrate",
      color: null,
    });
    if (!tag.ok) throw new Error(tag.error);
    await bulkAddFeedbackTag({
      productId: t.product.id,
      postIds: [moved.id],
      tagId: tag.data.tagId,
    });

    const result = await bulkMoveFeedbackToBoard({
      productId: t.product.id,
      postIds: [moved.id, merged.id],
      boardId: target.id,
    });
    expect(result).toEqual({ updated: 1, skipped: 1 });

    const rows = await db
      .select({ id: feedbackPosts.id, boardId: feedbackPosts.boardId })
      .from(feedbackPosts)
      .where(inArray(feedbackPosts.id, [moved.id, merged.id]));
    const byPost = new Map(rows.map((row) => [row.id, row.boardId]));
    expect(rows).toHaveLength(2);
    expect(byPost.get(moved.id)).toBe(target.id);
    expect(byPost.get(merged.id)).toBe(t.board.id);

    const remainingTags = await db
      .select({ tagId: feedbackTagLinks.tagId })
      .from(feedbackTagLinks)
      .where(eq(feedbackTagLinks.feedbackPostId, moved.id));
    expect(remainingTags).toHaveLength(0);
  });

  isolatedTest("refuses an archived or foreign board and leaves the request alone", async () => {
    const mine = await tenant();
    const theirs = await tenant();
    const archived = await createBoard(mine.product.id, {
      slug: "archive",
      name: "Archive",
      archivedAt: new Date(),
    });
    const post = await createFeedbackPost({
      productId: mine.product.id,
      boardId: mine.board.id,
    });

    const archivedResult = await bulkMoveFeedbackToBoard({
      productId: mine.product.id,
      postIds: [post.id],
      boardId: archived.id,
    });
    expect(archivedResult).toEqual({ updated: 0, skipped: 1 });

    const foreignResult = await bulkMoveFeedbackToBoard({
      productId: mine.product.id,
      postIds: [post.id],
      boardId: theirs.board.id,
    });
    expect(foreignResult).toEqual({ updated: 0, skipped: 1 });

    const rows = await db
      .select({ boardId: feedbackPosts.boardId })
      .from(feedbackPosts)
      .where(
        and(
          eq(feedbackPosts.id, post.id),
          eq(feedbackPosts.productId, mine.product.id),
        ),
      );
    expect(rows[0]?.boardId).toBe(mine.board.id);
  });
});

describe("bulk undo", () => {
  isolatedTest("restores a status change once, inside its own product", async () => {
    const t = await tenant();
    const other = await tenant();
    const actor = await createUser();
    const post = await createFeedbackPost({
      productId: t.product.id,
      boardId: t.board.id,
      status: "open",
    });

    const result = await bulkUpdateFeedbackStatuses({
      productId: t.product.id,
      postIds: [post.id],
      status: "planned",
      actorId: actor.id,
    });
    expect(result.updated).toBe(1);
    expect(result.undoId).toBeTruthy();
    if (!result.undoId) return;

    // Another product cannot claim this batch.
    const foreign = await undoFeedbackBulkAction({
      productId: other.product.id,
      undoId: result.undoId,
    });
    expect(foreign.ok).toBe(false);

    const undone = await undoFeedbackBulkAction({
      productId: t.product.id,
      undoId: result.undoId,
    });
    expect(undone).toEqual({ ok: true, restored: 1 });

    const rows = await db
      .select({ status: feedbackPosts.status })
      .from(feedbackPosts)
      .where(eq(feedbackPosts.id, post.id));
    expect(rows[0]?.status).toBe("open");

    const again = await undoFeedbackBulkAction({
      productId: t.product.id,
      undoId: result.undoId,
    });
    expect(again.ok).toBe(false);
  });

  isolatedTest("restores the previous visibility", async () => {
    const t = await tenant();
    const actor = await createUser();
    const post = await createFeedbackPost({
      productId: t.product.id,
      boardId: t.board.id,
    });

    const hidden = await bulkSetFeedbackHidden({
      productId: t.product.id,
      postIds: [post.id],
      hidden: true,
      hiddenBy: actor.id,
      actorId: actor.id,
    });
    expect(hidden.undoId).toBeTruthy();
    if (!hidden.undoId) return;

    const undone = await undoFeedbackBulkAction({
      productId: t.product.id,
      undoId: hidden.undoId,
    });
    expect(undone.ok).toBe(true);

    const rows = await db
      .select({ hiddenAt: feedbackPosts.hiddenAt, hiddenBy: feedbackPosts.hiddenBy })
      .from(feedbackPosts)
      .where(eq(feedbackPosts.id, post.id));
    expect(rows[0]?.hiddenAt).toBeNull();
    expect(rows[0]?.hiddenBy).toBeNull();
  });

  isolatedTest("removes an added tag", async () => {
    const t = await tenant();
    const actor = await createUser();
    const post = await createFeedbackPost({
      productId: t.product.id,
      boardId: t.board.id,
    });
    const tag = await createTag({
      productId: t.product.id,
      boardId: t.board.id,
      name: "undo-me",
      color: null,
    });
    if (!tag.ok) throw new Error(tag.error);

    const tagged = await bulkAddFeedbackTag({
      productId: t.product.id,
      postIds: [post.id],
      tagId: tag.data.tagId,
      actorId: actor.id,
    });
    expect(tagged.undoId).toBeTruthy();
    if (!tagged.undoId) return;

    const undone = await undoFeedbackBulkAction({
      productId: t.product.id,
      undoId: tagged.undoId,
    });
    expect(undone).toEqual({ ok: true, restored: 1 });

    const links = await db
      .select({ tagId: feedbackTagLinks.tagId })
      .from(feedbackTagLinks)
      .where(eq(feedbackTagLinks.feedbackPostId, post.id));
    expect(links).toHaveLength(0);
  });

  isolatedTest("restores the old board and its tags", async () => {
    const t = await tenant();
    const target = await createBoard(t.product.id, { slug: "target", name: "Target" });
    const actor = await createUser();
    const post = await createFeedbackPost({
      productId: t.product.id,
      boardId: t.board.id,
    });
    const tag = await createTag({
      productId: t.product.id,
      boardId: t.board.id,
      name: "keep-me",
      color: null,
    });
    if (!tag.ok) throw new Error(tag.error);
    await bulkAddFeedbackTag({
      productId: t.product.id,
      postIds: [post.id],
      tagId: tag.data.tagId,
      actorId: actor.id,
    });

    const moved = await bulkMoveFeedbackToBoard({
      productId: t.product.id,
      postIds: [post.id],
      boardId: target.id,
      actorId: actor.id,
    });
    expect(moved.undoId).toBeTruthy();
    if (!moved.undoId) return;

    const undone = await undoFeedbackBulkAction({
      productId: t.product.id,
      undoId: moved.undoId,
    });
    expect(undone).toEqual({ ok: true, restored: 1 });

    const rows = await db
      .select({ boardId: feedbackPosts.boardId })
      .from(feedbackPosts)
      .where(eq(feedbackPosts.id, post.id));
    expect(rows[0]?.boardId).toBe(t.board.id);

    const links = await db
      .select({ tagId: feedbackTagLinks.tagId })
      .from(feedbackTagLinks)
      .where(eq(feedbackTagLinks.feedbackPostId, post.id));
    expect(links.map((link) => link.tagId)).toEqual([tag.data.tagId]);
  });
});
