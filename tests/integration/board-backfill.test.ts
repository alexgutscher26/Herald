import { afterAll, beforeAll, describe, expect } from "bun:test";

import { db } from "@/db";
import { boards, feedbackPosts } from "@/db/schema";
import {
  applyBoardBackfill,
  inspectBoardBackfill,
} from "../../scripts/reconcile-board-backfill";

import {
  createBoard,
  createFeedbackPost,
  createProduct,
  createWorkspace,
} from "./factories";
import {
  SETUP_TIMEOUT_MS,
  isolatedTest,
  setupTestDatabase,
  teardownTestDatabase,
  testDatabaseClient,
} from "./harness";

/**
 * The reconciliation script is the post-migration safety net for the board
 * backfill, so its two modes run against the real schema: detect the gaps, fix
 * the recoverable ones, and refuse an unfixable cross-product reference.
 */

beforeAll(async () => {
  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

describe("board backfill reconciliation", () => {
  isolatedTest("assigns every existing post and leaves status counts unchanged", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const secondProduct = await createProduct(workspace.id);

    await createFeedbackPost({ productId: product.id, title: "Open request" });
    await createFeedbackPost({
      productId: product.id,
      title: "Planned request",
      status: "planned",
    });
    await createFeedbackPost({
      productId: product.id,
      title: "Closed request",
      status: "closed",
    });
    await createFeedbackPost({
      productId: secondProduct.id,
      title: "Shipped request",
      status: "shipped",
    });

    const client = testDatabaseClient();
    const before = await inspectBoardBackfill(client);
    expect(before.productsWithoutDefaultBoard).toBe(2);
    expect(before.postsWithoutBoard).toBe(4);
    expect(before.crossProductPosts).toBe(0);
    expect(before.needsBackfill).toBe(true);
    expect(before.statusCounts).toEqual({
      closed: 1,
      open: 1,
      planned: 1,
      shipped: 1,
    });

    expect(await applyBoardBackfill(client)).toEqual({
      createdBoards: 2,
      assignedPosts: 4,
    });

    const after = await inspectBoardBackfill(client);
    expect(after.needsBackfill).toBe(false);
    expect(after.productsWithoutDefaultBoard).toBe(0);
    expect(after.postsWithoutBoard).toBe(0);
    expect(after.crossProductPosts).toBe(0);
    // The backfill moves references; it must not rewrite any status.
    expect(after.statusCounts).toEqual(before.statusCounts);

    const boardRows = await db.select().from(boards);
    expect(boardRows).toHaveLength(2);
    const boardByProduct = new Map(boardRows.map((row) => [row.productId, row]));
    for (const productId of [product.id, secondProduct.id]) {
      const board = boardByProduct.get(productId);
      expect(board?.slug).toBe("feedback");
      expect(board?.visibility).toBe("public");
    }

    const postRows = await db.select().from(feedbackPosts);
    expect(postRows).toHaveLength(4);
    for (const post of postRows) {
      const board = boardRows.find((row) => row.id === post.boardId);
      expect(board?.productId).toBe(post.productId);
    }

    // Idempotent: the runner can be re-applied without creating duplicates.
    expect(await applyBoardBackfill(client)).toEqual({
      createdBoards: 0,
      assignedPosts: 0,
    });
  });

  isolatedTest("refuses to repair while a post points at another product's board", async () => {
    const workspace = await createWorkspace();
    const first = await createProduct(workspace.id);
    const second = await createProduct(workspace.id);

    const foreignBoard = await createBoard(first.id, { slug: "feedback" });
    await createBoard(second.id, { slug: "feedback" });
    await createFeedbackPost({
      productId: second.id,
      boardId: foreignBoard.id,
      title: "Cross-product reference",
    });

    const client = testDatabaseClient();
    expect((await inspectBoardBackfill(client)).crossProductPosts).toBe(1);

    await expect(applyBoardBackfill(client)).rejects.toThrow(/another product/);

    // The refusal must not have created or reassigned anything.
    const after = await inspectBoardBackfill(client);
    expect(after.crossProductPosts).toBe(1);
    expect(after.needsBackfill).toBe(false);
  });
});
