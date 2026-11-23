import { afterAll, beforeAll, describe, expect } from "bun:test";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { feedbackPosts } from "@/db/schema";
import { listFeedbackSavedViews } from "@/db/queries/feedback";
import { deleteFeedbackView, saveFeedbackView } from "@/features/feedback/saved-views";
import {
  bulkSetFeedbackHidden,
  bulkUpdateFeedbackStatuses,
} from "@/features/feedback/triage";

import {
  createBoard,
  createFeedbackPost,
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
 * Saved views are private to one member and one product; bulk triage is scoped
 * by the product id the action already authorized. Both are asserted here at
 * the service layer with real transactions.
 */

beforeAll(async () => {
  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

describe("saved feedback views", () => {
  isolatedTest("saves, updates and deletes a private view", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const owner = await createUser();
    const other = await createUser();

    const created = await saveFeedbackView({
      productId: product.id,
      userId: owner.id,
      name: "Planned bugs",
      filters: {
        search: "crash",
        status: "planned",
        category: "bug",
        sort: "votes",
      },
    });

    expect(created.productId).toBe(product.id);
    expect(created.filters).toEqual({
      search: "crash",
      status: "planned",
      category: "bug",
      sort: "votes",
      customFields: {},
    });

    const listed = await listFeedbackSavedViews(product.id, owner.id);
    expect(listed.map((view) => view.id)).toEqual([created.id]);

    // Same name and owner updates instead of creating a duplicate.
    const updated = await saveFeedbackView({
      productId: product.id,
      userId: owner.id,
      name: "Planned bugs",
      filters: {
        search: "",
        status: "in_progress",
        category: "all",
        sort: "newest",
      },
    });
    expect(updated.id).toBe(created.id);

    const afterUpdate = await listFeedbackSavedViews(product.id, owner.id);
    expect(afterUpdate).toHaveLength(1);
    expect(afterUpdate[0]?.filters).toEqual({
      search: "",
      status: "in_progress",
      category: "all",
      sort: "newest",
      customFields: {},
    });

    // Another member cannot list or delete the owner's view.
    expect(await listFeedbackSavedViews(product.id, other.id)).toEqual([]);
    expect(
      await deleteFeedbackView({
        productId: product.id,
        userId: other.id,
        viewId: created.id,
      }),
    ).toBe(false);

    expect(
      await deleteFeedbackView({
        productId: product.id,
        userId: owner.id,
        viewId: created.id,
      }),
    ).toBe(true);
    expect(await listFeedbackSavedViews(product.id, owner.id)).toEqual([]);
  });

  isolatedTest("a malformed stored filter set falls back to the unfiltered view", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const user = await createUser();

    const view = await saveFeedbackView({
      productId: product.id,
      userId: user.id,
      name: "Broken filters",
      filters: {
        search: "x".repeat(200),
        status: "not-a-status" as never,
        category: "not-a-category" as never,
        sort: "sideways" as never,
      },
    });

    expect(view.filters).toEqual({
      search: "x".repeat(120),
      status: "all",
      category: "all",
      sort: "newest",
      customFields: {},
    });
  });
});

describe("bulk triage", () => {
  isolatedTest("updates only this product's canonical requests", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const foreignProduct = await createProduct(workspace.id);
    const board = await createBoard(product.id);
    const foreignBoard = await createBoard(foreignProduct.id);

    const canonical = await createFeedbackPost({ productId: product.id, boardId: board.id });
    const second = await createFeedbackPost({ productId: product.id, boardId: board.id });
    const merged = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      mergedIntoId: canonical.id,
    });
    const foreign = await createFeedbackPost({
      productId: foreignProduct.id,
      boardId: foreignBoard.id,
    });

    const result = await bulkUpdateFeedbackStatuses({
      productId: product.id,
      postIds: [canonical.id, second.id, merged.id, foreign.id],
      status: "planned",
    });

    expect(result).toEqual({ updated: 2, skipped: 2 });

    const rows = await db
      .select({ id: feedbackPosts.id, status: feedbackPosts.status })
      .from(feedbackPosts);
    const statusById = new Map(rows.map((row) => [row.id, row.status]));

    expect(statusById.get(canonical.id)).toBe("planned");
    expect(statusById.get(second.id)).toBe("planned");
    // A merged duplicate keeps the status owned by its canonical request.
    expect(statusById.get(merged.id)).toBe("open");
    // A post from another product is never touched.
    expect(statusById.get(foreign.id)).toBe("open");

    const shipped = await bulkUpdateFeedbackStatuses({
      productId: product.id,
      postIds: [canonical.id],
      status: "shipped",
    });
    expect(shipped).toEqual({ updated: 1, skipped: 0 });

    const canonicalAfter = await db
      .select({ status: feedbackPosts.status })
      .from(feedbackPosts)
      .where(eq(feedbackPosts.id, canonical.id));
    expect(canonicalAfter[0]?.status).toBe("shipped");
  });

  isolatedTest("hides and restores only requests in the authorized product", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const foreignProduct = await createProduct(workspace.id);
    const board = await createBoard(product.id);
    const foreignBoard = await createBoard(foreignProduct.id);
    const user = await createUser();

    const first = await createFeedbackPost({ productId: product.id, boardId: board.id });
    const second = await createFeedbackPost({ productId: product.id, boardId: board.id });
    const foreign = await createFeedbackPost({
      productId: foreignProduct.id,
      boardId: foreignBoard.id,
    });

    const hidden = await bulkSetFeedbackHidden({
      productId: product.id,
      postIds: [first.id, second.id, foreign.id],
      hidden: true,
      hiddenBy: user.id,
    });
    expect(hidden).toEqual({ updated: 2 });

    const afterHide = await db
      .select({
        id: feedbackPosts.id,
        hiddenAt: feedbackPosts.hiddenAt,
        hiddenBy: feedbackPosts.hiddenBy,
      })
      .from(feedbackPosts);
    const byId = new Map(afterHide.map((row) => [row.id, row]));

    expect(byId.get(first.id)?.hiddenAt).not.toBeNull();
    expect(byId.get(first.id)?.hiddenBy).toBe(user.id);
    expect(byId.get(second.id)?.hiddenAt).not.toBeNull();
    expect(byId.get(foreign.id)?.hiddenAt).toBeNull();

    await bulkSetFeedbackHidden({
      productId: product.id,
      postIds: [first.id, second.id],
      hidden: false,
      hiddenBy: user.id,
    });

    const afterRestore = await db
      .select({ id: feedbackPosts.id, hiddenAt: feedbackPosts.hiddenAt })
      .from(feedbackPosts);
    expect(afterRestore.find((row) => row.id === first.id)?.hiddenAt).toBeNull();
    expect(afterRestore.find((row) => row.id === second.id)?.hiddenAt).toBeNull();
  });
});
