import { afterAll, beforeAll, describe, expect } from "bun:test";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { feedbackPosts } from "@/db/schema";
import { loadPortalHome, searchPortal } from "@/features/portal/service";

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
 * The unified portal search and home counts may only include requests a
 * visitor could actually open: public privacy, visible moderation state, not
 * hidden, archived or merged, and not written by a banned customer.
 */

const TOKEN = "portalprivacycheck";

const previous = process.env.FLAG_PUBLIC_FEEDBACK;

beforeAll(async () => {
  process.env.FLAG_PUBLIC_FEEDBACK = "on";
  process.env.BETTER_AUTH_URL ??= "http://app.local";
  process.env.BETTER_AUTH_SECRET ??= "integration-secret-value-at-least-32-chars";
  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  if (previous === undefined) delete process.env.FLAG_PUBLIC_FEEDBACK;
  else process.env.FLAG_PUBLIC_FEEDBACK = previous;
  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

describe("portal search and home", () => {
  isolatedTest("never expose a non-public request", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const board = await createBoard(product.id, { name: "Feedback", slug: "feedback" });
    const moderated = await createBoard(product.id, {
      name: "Moderated",
      slug: "moderated",
      settings: {
        moderation: {
          requireApproval: "all",
          comments: "open",
          blockSensitiveInfo: false,
        },
      },
    });
    const privateBoard = await createBoard(product.id, {
      name: "Private",
      slug: "private-board",
      visibility: "private",
    });

    const visible = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: `${TOKEN} visible request`,
      body: "This one may appear in the portal.",
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

    const pending = await createFeedbackPost({
      productId: product.id,
      boardId: moderated.id,
      title: `${TOKEN} pending request`,
      body: "Waiting for review.",
    });
    await createModerationReview({
      productId: product.id,
      contentType: "feedback_post",
      contentId: pending.id,
      status: "pending",
    });

    const hidden = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: `${TOKEN} hidden request`,
      hiddenAt: new Date(),
    });
    const archived = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: `${TOKEN} archived request`,
      archivedAt: new Date(),
    });
    const merged = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: `${TOKEN} merged request`,
      mergedIntoId: visible.id,
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

    const authorOnly = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: `${TOKEN} author-only request`,
    });
    await db
      .update(feedbackPosts)
      .set({ privacy: "author" })
      .where(eq(feedbackPosts.id, authorOnly.id));

    const companyOnly = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: `${TOKEN} company-only request`,
    });
    await db
      .update(feedbackPosts)
      .set({ privacy: "company" })
      .where(eq(feedbackPosts.id, companyOnly.id));

    const bannedCustomer = await createCustomer(workspace.id, { bannedAt: new Date() });
    const banned = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: `${TOKEN} banned author request`,
      authorCustomerId: bannedCustomer.id,
    });

    const onPrivateBoard = await createFeedbackPost({
      productId: product.id,
      boardId: privateBoard.id,
      title: `${TOKEN} private board request`,
    });

    const search = await searchPortal({
      workspaceSlug: workspace.slug,
      productSlug: product.slug,
      query: TOKEN,
    });
    expect(search).not.toBeNull();
    const returned = (search?.results ?? [])
      .filter((result) => result.kind === "feedback")
      .map((result) => result.id)
      .sort();
    expect(returned).toEqual([visible.id, approved.id].sort());

    for (const excluded of [
      pending.id,
      hidden.id,
      archived.id,
      merged.id,
      rejected.id,
      authorOnly.id,
      companyOnly.id,
      banned.id,
      onPrivateBoard.id,
    ]) {
      expect(returned).not.toContain(excluded);
    }

    const home = await loadPortalHome({
      workspaceSlug: workspace.slug,
      productSlug: product.slug,
      viewer: null,
    });
    expect(home).not.toBeNull();
    const counts = new Map(home?.boards.map((entry) => [entry.slug, entry.requestCount]));
    expect(counts.get("feedback")).toBe(1);
    expect(counts.get("moderated")).toBe(1);
    expect(counts.has("private-board")).toBe(false);
  });
});
