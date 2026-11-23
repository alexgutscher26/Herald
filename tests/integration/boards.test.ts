import { afterAll, beforeAll, describe, expect } from "bun:test";

import { findBoardForProduct, listBoardsForProduct } from "@/db/queries/boards";

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
} from "./harness";

/**
 * Board management reads are tenant-scoped by construction: the product id is
 * part of every WHERE clause, so a guessed board id from another product is
 * indistinguishable from a missing one.
 */

beforeAll(async () => {
  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

describe("board reads", () => {
  isolatedTest("lists active boards before archived ones, ordered by position", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);

    const third = await createBoard(product.id, { name: "Third", position: 20 });
    const first = await createBoard(product.id, { name: "First", position: 0 });
    const retired = await createBoard(product.id, {
      name: "Retired",
      position: -5,
      archivedAt: new Date(),
    });

    const boards = await listBoardsForProduct(product.id);
    expect(boards.map((board) => board.id)).toEqual([first.id, third.id, retired.id]);
    expect(boards[2]?.archivedAt).not.toBeNull();
  });

  isolatedTest("counts only live requests on each board", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const board = await createBoard(product.id, { slug: "feedback" });
    const other = await createBoard(product.id, { slug: "other" });

    await createFeedbackPost({ productId: product.id, boardId: board.id });
    await createFeedbackPost({ productId: product.id, boardId: board.id });
    await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      archivedAt: new Date(),
    });
    const canonical = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
    });
    await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      mergedIntoId: canonical.id,
    });
    await createFeedbackPost({ productId: product.id, boardId: other.id });

    const boards = await listBoardsForProduct(product.id);
    const feedback = boards.find((row) => row.id === board.id);
    const otherBoard = boards.find((row) => row.id === other.id);
    // Two ordinary requests plus the merge target; the archived and merged
    // rows are excluded.
    expect(feedback?.postCount).toBe(3);
    expect(otherBoard?.postCount).toBe(1);
  });

  isolatedTest("never resolves another product's board", async () => {
    const workspace = await createWorkspace();
    const first = await createProduct(workspace.id);
    const second = await createProduct(workspace.id);
    const foreign = await createBoard(second.id, { slug: "feedback" });

    expect(await findBoardForProduct(first.id, foreign.id)).toBeNull();
    expect(await findBoardForProduct(second.id, foreign.id)).not.toBeNull();

    const boards = await listBoardsForProduct(first.id);
    expect(boards).toEqual([]);
  });
});
