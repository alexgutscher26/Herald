import { afterAll, beforeAll, describe, expect } from "bun:test";

import { eq } from "drizzle-orm";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { db } from "@/db";
import { feedbackAttachments, feedbackPosts } from "@/db/schema";
import type { BoardSettings } from "@/db/schema/boards";
import {
  addPublicComment,
  createPublicRequest,
  setCustomerFollow,
  setCustomerReaction,
  setCustomerVote,
} from "@/features/public/engagement";
import {
  getPublicBoardPage,
  getPublicRequestPage,
  suggestPublicRequests,
} from "@/features/public/queries";
import { parsePublicBoardQuery } from "@/features/public/query";
import type { PublicViewer } from "@/features/public/queries";

import {
  createBoard,
  createCustomer,
  createFeedbackComment,
  createFeedbackPost,
  createFeedbackVote,
  createModerationReview,
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
 * The public loop is a data-visibility contract as much as a feature set:
 * internal notes must never reach a visitor, a pending submission is a receipt
 * for its author only, and every write is scoped to the resolved board.
 */

let previousFlag: string | undefined;
let previousStorage: string | undefined;
let previousUrl: string | undefined;
let previousSecret: string | undefined;
let storageDir: string;

beforeAll(async () => {
  previousFlag = process.env.FLAG_PUBLIC_FEEDBACK;
  previousStorage = process.env.STORAGE_DIR;
  previousUrl = process.env.BETTER_AUTH_URL;
  previousSecret = process.env.BETTER_AUTH_SECRET;

  process.env.FLAG_PUBLIC_FEEDBACK = "on";
  process.env.BETTER_AUTH_URL ??= "http://app.local";
  process.env.BETTER_AUTH_SECRET ??= "integration-secret-value-at-least-32-chars";

  storageDir = await mkdtemp(path.join(tmpdir(), "herald-public-"));
  process.env.STORAGE_DIR = storageDir;

  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  if (previousFlag === undefined) delete process.env.FLAG_PUBLIC_FEEDBACK;
  else process.env.FLAG_PUBLIC_FEEDBACK = previousFlag;
  if (previousStorage === undefined) delete process.env.STORAGE_DIR;
  else process.env.STORAGE_DIR = previousStorage;
  if (previousUrl === undefined) delete process.env.BETTER_AUTH_URL;
  else process.env.BETTER_AUTH_URL = previousUrl;
  if (previousSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
  else process.env.BETTER_AUTH_SECRET = previousSecret;

  await rm(storageDir, { recursive: true, force: true });
  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

async function tenant(options?: { boardSettings?: BoardSettings; boardSlug?: string }) {
  const workspace = await createWorkspace();
  const product = await createProduct(workspace.id);
  const board = await createBoard(product.id, {
    slug: options?.boardSlug ?? "feedback",
    name: "Feedback",
    guestPosting: true,
    ...(options?.boardSettings ? { settings: options.boardSettings } : {}),
  });

  return { workspace, product, board };
}

function viewerFor(
  tenantValue: Awaited<ReturnType<typeof tenant>>,
  customerId: string,
): PublicViewer {
  return {
    customerId,
    workspaceId: tenantValue.workspace.id,
    identified: true,
    hasCompany: false,
  };
}

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
]);

describe("public request detail", () => {
  isolatedTest("excludes internal notes and foreign requests", async () => {
    const t = await tenant();
    const author = await createCustomer(t.workspace.id, { name: "Ada" });
    const other = await createCustomer(t.workspace.id, { name: "Grace" });

    const post = await createFeedbackPost({
      productId: t.product.id,
      boardId: t.board.id,
      title: "Dark mode",
      body: "Please add a dark theme.",
      authorCustomerId: author.id,
    });
    await createFeedbackComment({
      productId: t.product.id,
      feedbackPostId: post.id,
      body: "Internal note: check the theme tokens",
      internal: true,
    });
    await createFeedbackComment({
      productId: t.product.id,
      feedbackPostId: post.id,
      body: "We are looking into it.",
      authorType: "team",
    });

    const page = await getPublicRequestPage(
      {
        workspaceSlug: t.workspace.slug,
        productSlug: t.product.slug,
        boardSlug: t.board.slug,
        requestId: post.id,
      },
      viewerFor(t, other.id),
    );

    expect(page).not.toBeNull();
    expect(page?.request.title).toBe("Dark mode");
    expect(page?.request.comments).toHaveLength(1);
    expect(page?.request.comments[0]?.body).toBe("We are looking into it.");
    expect(JSON.stringify(page)).not.toContain("Internal note");
    expect(page?.request.viewer.isAuthor).toBe(false);

    const foreignProduct = await createProduct(t.workspace.id);
    const foreignBoard = await createBoard(foreignProduct.id);

    expect(
      await getPublicRequestPage({
        workspaceSlug: t.workspace.slug,
        productSlug: foreignProduct.slug,
        boardSlug: foreignBoard.slug,
        requestId: post.id,
      }),
    ).toBeNull();
  });

  isolatedTest("shows a pending request to its author only", async () => {
    const t = await tenant({
      boardSettings: {
        moderation: { requireApproval: "all", comments: "open", blockSensitiveInfo: false },
      },
    });
    const author = await createCustomer(t.workspace.id, { name: "Ada" });
    const other = await createCustomer(t.workspace.id, { name: "Grace" });

    const post = await createFeedbackPost({
      productId: t.product.id,
      boardId: t.board.id,
      title: "Pending idea",
      authorCustomerId: author.id,
    });
    await createModerationReview({
      productId: t.product.id,
      contentType: "feedback_post",
      contentId: post.id,
      status: "pending",
    });

    const input = {
      workspaceSlug: t.workspace.slug,
      productSlug: t.product.slug,
      boardSlug: t.board.slug,
      requestId: post.id,
    };

    const authorView = await getPublicRequestPage(input, viewerFor(t, author.id));
    expect(authorView?.request.visibility).toBe("awaiting_review");
    expect(authorView?.request.viewer.isAuthor).toBe(true);

    expect(await getPublicRequestPage(input, viewerFor(t, other.id))).toBeNull();
    expect(await getPublicRequestPage(input)).toBeNull();

    const board = await getPublicBoardPage(
      {
        workspaceSlug: t.workspace.slug,
        productSlug: t.product.slug,
        boardSlug: t.board.slug,
      },
      parsePublicBoardQuery({}),
    );
    expect(board?.pagination.total).toBe(0);
    expect(board?.requests).toHaveLength(0);
  });

  isolatedTest("reflects votes, follows and reactions for the viewer", async () => {
    const t = await tenant();
    const customer = await createCustomer(t.workspace.id, { name: "Ada" });
    const teamUser = await createUser();

    const post = await createFeedbackPost({
      productId: t.product.id,
      boardId: t.board.id,
      title: "Dark mode",
      authorCustomerId: customer.id,
    });
    await createFeedbackVote({ feedbackPostId: post.id, voterId: teamUser.id });

    const input = {
      workspaceSlug: t.workspace.slug,
      productSlug: t.product.slug,
      boardSlug: t.board.slug,
      requestId: post.id,
    };
    const viewer = viewerFor(t, customer.id);

    await setCustomerVote({
      tenant: t,
      requestId: post.id,
      customerId: customer.id,
      voted: true,
    });
    const duplicate = await setCustomerVote({
      tenant: t,
      requestId: post.id,
      customerId: customer.id,
      voted: true,
    });
    expect(duplicate.ok && duplicate.voteCount).toBe(2);

    await setCustomerFollow({
      tenant: t,
      requestId: post.id,
      customerId: customer.id,
      follows: true,
    });
    await setCustomerReaction({
      tenant: t,
      requestId: post.id,
      customerId: customer.id,
      kind: "love",
      reacted: true,
    });

    const page = await getPublicRequestPage(input, viewer);
    expect(page?.request.voteCount).toBe(2);
    expect(page?.request.viewer.hasVoted).toBe(true);
    expect(page?.request.viewer.follows).toBe(true);
    expect(
      page?.request.reactions.find((reaction) => reaction.kind === "love"),
    ).toEqual({ kind: "love", count: 1, reacted: true });

    await setCustomerVote({
      tenant: t,
      requestId: post.id,
      customerId: customer.id,
      voted: false,
    });
    await setCustomerFollow({
      tenant: t,
      requestId: post.id,
      customerId: customer.id,
      follows: false,
    });
    await setCustomerReaction({
      tenant: t,
      requestId: post.id,
      customerId: customer.id,
      kind: "love",
      reacted: false,
    });

    const after = await getPublicRequestPage(input, viewer);
    expect(after?.request.voteCount).toBe(1);
    expect(after?.request.viewer.hasVoted).toBe(false);
    expect(after?.request.viewer.follows).toBe(false);
    expect(
      after?.request.reactions.find((reaction) => reaction.kind === "love"),
    ).toEqual({ kind: "love", count: 0, reacted: false });

    // A foreign request id is a 404, not another product's data.
    const foreignProduct = await createProduct(t.workspace.id);
    const foreignBoard = await createBoard(foreignProduct.id);
    expect(
      await setCustomerVote({
        tenant: { ...t, product: foreignProduct, board: foreignBoard },
        requestId: post.id,
        customerId: customer.id,
        voted: true,
      }),
    ).toEqual({ ok: false, status: 404, error: "Request not found." });
  });

  isolatedTest("holds moderated comments until approval", async () => {
    const t = await tenant({
      boardSettings: {
        moderation: {
          requireApproval: "none",
          comments: "moderated",
          blockSensitiveInfo: false,
        },
      },
    });
    const author = await createCustomer(t.workspace.id, { name: "Ada" });
    const other = await createCustomer(t.workspace.id, { name: "Grace" });
    const post = await createFeedbackPost({
      productId: t.product.id,
      boardId: t.board.id,
      title: "Dark mode",
      authorCustomerId: author.id,
    });

    const added = await addPublicComment({
      tenant: t,
      requestId: post.id,
      customerId: other.id,
      customerName: other.name,
      body: "Same here.",
    });
    expect(added.ok && added.status).toBe("awaiting_review");
    const commentId = added.ok ? added.commentId : "";

    const input = {
      workspaceSlug: t.workspace.slug,
      productSlug: t.product.slug,
      boardSlug: t.board.slug,
      requestId: post.id,
    };

    const authorView = await getPublicRequestPage(input, viewerFor(t, author.id));
    expect(authorView?.request.comments).toHaveLength(0);

    const commenterView = await getPublicRequestPage(input, viewerFor(t, other.id));
    expect(commenterView?.request.comments).toHaveLength(1);
    expect(commenterView?.request.comments[0]?.pending).toBe(true);
    expect(commenterView?.request.comments[0]?.isAuthor).toBe(true);

    await createModerationReview({
      productId: t.product.id,
      contentType: "feedback_comment",
      contentId: commentId,
      status: "approved",
    });

    const approved = await getPublicRequestPage(input, viewerFor(t, author.id));
    expect(approved?.request.comments).toHaveLength(1);
    expect(approved?.request.comments[0]?.pending).toBe(false);
  });

  isolatedTest("refuses to comment on a closed board", async () => {
    const t = await tenant({
      boardSettings: {
        moderation: { requireApproval: "none", comments: "closed", blockSensitiveInfo: false },
      },
    });
    const customer = await createCustomer(t.workspace.id);
    const post = await createFeedbackPost({
      productId: t.product.id,
      boardId: t.board.id,
      authorCustomerId: customer.id,
    });

    const result = await addPublicComment({
      tenant: t,
      requestId: post.id,
      customerId: customer.id,
      customerName: null,
      body: "Hello",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });
});

describe("public submission", () => {
  isolatedTest("creates a pending request with an attachment and receipt", async () => {
    const t = await tenant({
      boardSettings: {
        moderation: { requireApproval: "all", comments: "open", blockSensitiveInfo: false },
      },
    });
    const author = await createCustomer(t.workspace.id, { name: "Ada" });

    const created = await createPublicRequest({
      tenant: t,
      customerId: author.id,
      customerName: "Ada",
      title: "Dark mode",
      body: "Please add a dark theme to the editor.",
      category: "feature_request",
      files: [
        { fileName: "screenshot.png", mimeType: "image/png", body: PNG_BYTES },
      ],
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.status).toBe("awaiting_review");

    const attachments = await db
      .select()
      .from(feedbackAttachments)
      .where(eq(feedbackAttachments.feedbackPostId, created.id));
    expect(attachments).toHaveLength(1);
    expect(attachments[0]?.mimeType).toBe("image/png");

    const input = {
      workspaceSlug: t.workspace.slug,
      productSlug: t.product.slug,
      boardSlug: t.board.slug,
      requestId: created.id,
    };

    const authorView = await getPublicRequestPage(input, viewerFor(t, author.id));
    expect(authorView?.request.visibility).toBe("awaiting_review");
    expect(authorView?.request.attachments).toHaveLength(1);
    expect(authorView?.request.attachments[0]?.url).toStartWith("/api/storage/");

    expect(await getPublicRequestPage(input)).toBeNull();
  });

  isolatedTest("rejects sensitive content when the board asks", async () => {
    const t = await tenant({
      boardSettings: {
        moderation: { requireApproval: "none", comments: "open", blockSensitiveInfo: true },
      },
    });
    const author = await createCustomer(t.workspace.id);

    const created = await createPublicRequest({
      tenant: t,
      customerId: author.id,
      customerName: null,
      title: "Billing issue",
      body: "My card is 4111 1111 1111 1111 and it is charged twice.",
      category: "bug",
      files: [],
    });

    expect(created.ok).toBe(false);
    if (!created.ok) {
      expect(created.status).toBe(400);
      expect(created.field).toBe("body");
      expect(created.error).toContain("payment card");
    }

    const rows = await db
      .select({ id: feedbackPosts.id })
      .from(feedbackPosts)
      .where(eq(feedbackPosts.productId, t.product.id));
    expect(rows).toHaveLength(0);
  });

  isolatedTest("suggests duplicates across boards in the same product only", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const boardA = await createBoard(product.id, { slug: "feedback", name: "Feedback" });
    const boardB = await createBoard(product.id, { slug: "ideas", name: "Ideas" });
    const privateBoard = await createBoard(product.id, {
      slug: "private",
      visibility: "private",
      name: "Private",
    });
    const moderatedBoard = await createBoard(product.id, {
      slug: "moderated",
      name: "Moderated",
      settings: {
        moderation: { requireApproval: "all", comments: "open", blockSensitiveInfo: false },
      },
    });

    const onA = await createFeedbackPost({
      productId: product.id,
      boardId: boardA.id,
      title: "Dark mode for the editor",
      body: "A dark theme would help at night.",
    });
    const onB = await createFeedbackPost({
      productId: product.id,
      boardId: boardB.id,
      title: "Dark mode shortcuts",
      body: "Keyboard shortcut to toggle dark mode.",
    });
    await createFeedbackPost({
      productId: product.id,
      boardId: privateBoard.id,
      title: "Dark mode secrets",
      body: "Should never be suggested.",
    });
    const pending = await createFeedbackPost({
      productId: product.id,
      boardId: moderatedBoard.id,
      title: "Dark mode beta",
      body: "Pending idea.",
    });
    await createModerationReview({
      productId: product.id,
      contentType: "feedback_post",
      contentId: pending.id,
      status: "pending",
    });

    const otherWorkspace = await createWorkspace();
    const otherProduct = await createProduct(otherWorkspace.id);
    const otherBoard = await createBoard(otherProduct.id);
    await createFeedbackPost({
      productId: otherProduct.id,
      boardId: otherBoard.id,
      title: "Dark mode elsewhere",
      body: "Another tenant.",
    });

    const suggestions = await suggestPublicRequests(
      {
        workspaceSlug: workspace.slug,
        productSlug: product.slug,
        boardSlug: boardA.slug,
      },
      "dark mode",
    );

    const ids = (suggestions ?? []).map((suggestion) => suggestion.id);
    expect(ids).toContain(onA.id);
    expect(ids).toContain(onB.id);
    expect(ids).toHaveLength(2);
    expect(suggestions?.find((suggestion) => suggestion.id === onB.id)?.boardName).toBe(
      "Ideas",
    );

    expect(
      await suggestPublicRequests(
        {
          workspaceSlug: workspace.slug,
          productSlug: product.slug,
          boardSlug: boardA.slug,
        },
        "d",
      ),
    ).toEqual([]);
  });
});
