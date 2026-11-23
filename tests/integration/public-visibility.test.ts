import { afterAll, beforeAll, describe, expect } from "bun:test";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { feedbackPosts } from "@/db/schema";
import {
  getPublicBoardPage,
  getPublicRequestPage,
  listPublicSitemapEntries,
  suggestPublicRequests,
} from "@/features/public/queries";
import { parsePublicBoardQuery } from "@/features/public/query";
import { resolvePublicBoard } from "@/features/public/resolver";

import {
  createBoard,
  createCustomer,
  createFeedbackPost,
  createModerationReview,
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
 * The public visibility contract.
 *
 * One token marks every request that must not be readable: hidden, merged,
 * archived, pending, rejected, written by a banned customer, or living on a
 * private board. The board, its search, duplicate suggestions and the sitemap
 * must all exclude the same set, while the two genuinely public requests
 * remain readable. This is the W1 gate that unapproved, hidden and private
 * content never reaches a public projection.
 */

const TOKEN = "visibilitycheck";

beforeAll(async () => {
  process.env.FLAG_PUBLIC_FEEDBACK = "on";
  process.env.BETTER_AUTH_URL = "http://app.local";
  process.env.BETTER_AUTH_SECRET ??= "integration-secret-value-at-least-32-chars";
  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

describe("public visibility", () => {
  isolatedTest("search, suggestions and the sitemap exclude the same non-public rows", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const board = await createBoard(product.id, {
      name: "Feedback",
      slug: "feedback",
    });
    const moderated = await createBoard(product.id, {
      name: "Moderated",
      slug: "moderated",
      settings: {
        moderation: { requireApproval: "all", comments: "moderated", blockSensitiveInfo: false },
      },
    });
    const privateBoard = await createBoard(product.id, {
      name: "Private",
      slug: "private",
      visibility: "private",
    });

    const input = {
      workspaceSlug: workspace.slug,
      productSlug: product.slug,
      boardSlug: board.slug,
    };

    const visible = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: `${TOKEN} visible request`,
      body: "This one is public.",
    });
    const approved = await createFeedbackPost({
      productId: product.id,
      boardId: moderated.id,
      title: `${TOKEN} approved request`,
      body: "This one passed moderation.",
    });
    await createModerationReview({
      productId: product.id,
      contentType: "feedback_post",
      contentId: approved.id,
      status: "approved",
    });

    const hidden = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: `${TOKEN} hidden request`,
    });
    await db
      .update(feedbackPosts)
      .set({ hiddenAt: new Date() })
      .where(eq(feedbackPosts.id, hidden.id));

    const merged = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: `${TOKEN} merged request`,
      mergedIntoId: visible.id,
    });
    const archived = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: `${TOKEN} archived request`,
    });
    await db
      .update(feedbackPosts)
      .set({ archivedAt: new Date() })
      .where(eq(feedbackPosts.id, archived.id));

    const pending = await createFeedbackPost({
      productId: product.id,
      boardId: moderated.id,
      title: `${TOKEN} pending request`,
    });
    await createModerationReview({
      productId: product.id,
      contentType: "feedback_post",
      contentId: pending.id,
      status: "pending",
    });

    const rejected = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: `${TOKEN} rejected request`,
    });
    await createModerationReview({
      productId: product.id,
      contentType: "feedback_post",
      contentId: rejected.id,
      status: "rejected",
    });

    const bannedCustomer = await createCustomer(workspace.id, { bannedAt: new Date() });
    const banned = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: `${TOKEN} banned request`,
      authorCustomerId: bannedCustomer.id,
    });

    const privateRequest = await createFeedbackPost({
      productId: product.id,
      boardId: privateBoard.id,
      title: `${TOKEN} private request`,
    });

    const excluded = [
      hidden.id,
      merged.id,
      archived.id,
      pending.id,
      rejected.id,
      banned.id,
      privateRequest.id,
    ];

    const page = await getPublicBoardPage(input, parsePublicBoardQuery({ q: TOKEN }));
    expect(page).not.toBeNull();
    expect(page?.requests.map((request) => request.id)).toEqual([visible.id]);

    // Approval is a publication decision, not a permanent hide: the approved
    // request appears on its own board and its direct URL resolves.
    const moderatedPage = await getPublicBoardPage(
      { ...input, boardSlug: moderated.slug },
      parsePublicBoardQuery({}),
    );
    expect(moderatedPage?.requests.map((request) => request.id)).toEqual([approved.id]);
    expect(
      await getPublicRequestPage({ ...input, requestId: visible.id }),
    ).not.toBeNull();
    expect(
      await getPublicRequestPage({
        ...input,
        boardSlug: moderated.slug,
        requestId: approved.id,
      }),
    ).not.toBeNull();

    const suggestions = await suggestPublicRequests(input, `${TOKEN} request`);
    expect(suggestions).not.toBeNull();
    const suggestedIds = (suggestions ?? []).map((suggestion) => suggestion.id).sort();
    expect(suggestedIds).toEqual([visible.id, approved.id].sort());

    const sitemap = await listPublicSitemapEntries();
    const requestIds = sitemap.flatMap((entry) =>
      entry.kind === "request" &&
      entry.workspaceSlug === workspace.slug &&
      entry.productSlug === product.slug
        ? [entry.requestId]
        : [],
    );
    expect(requestIds).toEqual(expect.arrayContaining([visible.id, approved.id]));
    for (const id of excluded) expect(requestIds).not.toContain(id);

    const boardSlugs = sitemap.flatMap((entry) =>
      entry.kind === "board" &&
      entry.workspaceSlug === workspace.slug &&
      entry.productSlug === product.slug
        ? [entry.boardSlug]
        : [],
    );
    expect(boardSlugs.sort()).toEqual(["feedback", "moderated"]);
    expect(boardSlugs).not.toContain(privateBoard.slug);

    expect(
      await resolvePublicBoard({ ...input, boardSlug: privateBoard.slug }),
    ).toBeNull();

    for (const id of excluded) {
      expect(
        await getPublicRequestPage({ ...input, requestId: id }),
      ).toBeNull();
    }
  });
});
