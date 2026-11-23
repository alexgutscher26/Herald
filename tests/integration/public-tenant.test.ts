import { afterAll, beforeAll, describe, expect } from "bun:test";

import { getPublicBoardPage, getPublicRequestPage } from "@/features/public/queries";
import { resolvePublicBoard, resolvePublicWorkspace } from "@/features/public/resolver";

import {
  createBoard,
  createCustomer,
  createFeedbackComment,
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
 * The public surface is the only unauthenticated read path, so it gets the
 * strongest database-level tests: unknown, private and archived records must
 * be indistinguishable from each other and from another tenant's records.
 */

let previousFlag: string | undefined;

beforeAll(async () => {
  previousFlag = process.env.FLAG_PUBLIC_FEEDBACK;
  process.env.FLAG_PUBLIC_FEEDBACK = "on";
  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  if (previousFlag === undefined) delete process.env.FLAG_PUBLIC_FEEDBACK;
  else process.env.FLAG_PUBLIC_FEEDBACK = previousFlag;
  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

describe("public tenant resolution", () => {
  isolatedTest("serves only public, unarchived boards", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const board = await createBoard(product.id, { slug: "feedback" });
    await createBoard(product.id, { slug: "private", visibility: "private" });
    await createBoard(product.id, { slug: "retired", archivedAt: new Date() });

    const resolved = await resolvePublicBoard({
      workspaceSlug: workspace.slug,
      productSlug: product.slug,
      boardSlug: board.slug,
    });
    expect(resolved?.board.id).toBe(board.id);
    expect(resolved?.workspace.plan).toBe("free");

    for (const boardSlug of ["private", "retired", "missing"]) {
      expect(
        await resolvePublicBoard({
          workspaceSlug: workspace.slug,
          productSlug: product.slug,
          boardSlug,
        }),
      ).toBeNull();
    }

    expect(
      await resolvePublicBoard({
        workspaceSlug: "another-workspace",
        productSlug: product.slug,
        boardSlug: board.slug,
      }),
    ).toBeNull();
  });

  isolatedTest("resolves a workspace only when it has a public board", async () => {
    const privateWorkspace = await createWorkspace();
    const privateProduct = await createProduct(privateWorkspace.id);
    await createBoard(privateProduct.id, { visibility: "private" });
    expect(await resolvePublicWorkspace(privateWorkspace.slug)).toBeNull();

    const publicWorkspace = await createWorkspace();
    const publicProduct = await createProduct(publicWorkspace.id);
    await createBoard(publicProduct.id, { slug: "feedback" });
    const resolved = await resolvePublicWorkspace(publicWorkspace.slug);
    expect(resolved?.id).toBe(publicWorkspace.id);
  });
});

describe("public projections", () => {
  isolatedTest("hide internal notes, archived requests and merged requests", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const board = await createBoard(product.id, { slug: "feedback" });
    const otherBoard = await createBoard(product.id, { slug: "other" });

    const visible = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: "Visible request",
    });
    const archived = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: "Archived request",
      archivedAt: new Date(),
    });
    const merged = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: "Merged request",
      mergedIntoId: visible.id,
    });
    const elsewhere = await createFeedbackPost({
      productId: product.id,
      boardId: otherBoard.id,
      title: "Other board",
    });

    await createFeedbackComment({
      productId: product.id,
      feedbackPostId: visible.id,
      body: "Public reply",
      internal: false,
      authorName: "Support",
    });
    await createFeedbackComment({
      productId: product.id,
      feedbackPostId: visible.id,
      body: "Internal note",
      internal: true,
      authorName: "Support",
    });

    const page = await getPublicBoardPage({
      workspaceSlug: workspace.slug,
      productSlug: product.slug,
      boardSlug: board.slug,
    });

    expect(page).not.toBeNull();
    expect(page?.requests.map((request) => request.id)).toEqual([visible.id]);
    expect(page?.requests[0]?.commentCount).toBe(1);

    const detail = await getPublicRequestPage({
      workspaceSlug: workspace.slug,
      productSlug: product.slug,
      boardSlug: board.slug,
      requestId: visible.id,
    });
    expect(detail?.request.comments.map((comment) => comment.body)).toEqual([
      "Public reply",
    ]);

    for (const requestId of [archived.id, merged.id, elsewhere.id]) {
      expect(
        await getPublicRequestPage({
          workspaceSlug: workspace.slug,
          productSlug: product.slug,
          boardSlug: board.slug,
          requestId,
        }),
      ).toBeNull();
    }
  });

  isolatedTest("approves each request and comment before publishing it", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const board = await createBoard(product.id, {
      slug: "feedback",
      settings: {
        moderation: {
          requireApproval: "all",
          comments: "moderated",
          blockSensitiveInfo: false,
        },
      },
    });

    const approved = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: "Approved request",
    });
    const pending = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: "Pending request",
    });
    const rejected = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: "Rejected request",
    });

    await createModerationReview({
      productId: product.id,
      contentType: "feedback_post",
      contentId: approved.id,
      status: "approved",
    });
    await createModerationReview({
      productId: product.id,
      contentType: "feedback_post",
      contentId: rejected.id,
      status: "rejected",
      reasons: ["spam"],
    });

    const approvedComment = await createFeedbackComment({
      productId: product.id,
      feedbackPostId: approved.id,
      body: "Approved reply",
    });
    const pendingComment = await createFeedbackComment({
      productId: product.id,
      feedbackPostId: approved.id,
      body: "Pending reply",
    });
    const rejectedComment = await createFeedbackComment({
      productId: product.id,
      feedbackPostId: approved.id,
      body: "Rejected reply",
    });
    await createModerationReview({
      productId: product.id,
      contentType: "feedback_comment",
      contentId: approvedComment.id,
      status: "approved",
    });
    await createModerationReview({
      productId: product.id,
      contentType: "feedback_comment",
      contentId: rejectedComment.id,
      status: "rejected",
    });

    const page = await getPublicBoardPage({
      workspaceSlug: workspace.slug,
      productSlug: product.slug,
      boardSlug: board.slug,
    });
    expect(page?.requests.map((request) => request.id)).toEqual([approved.id]);
    expect(page?.requests[0]?.commentCount).toBe(1);

    const detail = await getPublicRequestPage({
      workspaceSlug: workspace.slug,
      productSlug: product.slug,
      boardSlug: board.slug,
      requestId: approved.id,
    });
    expect(detail?.request.comments.map((comment) => comment.body)).toEqual([
      "Approved reply",
    ]);
    expect(detail?.request.commentCount).toBe(1);
    const detailPayload = JSON.stringify(detail);
    expect(detailPayload).not.toContain(pendingComment.body);
    expect(detailPayload).not.toContain(rejectedComment.body);

    // Neither a pending nor a rejected request is addressable by id.
    for (const requestId of [pending.id, rejected.id]) {
      expect(
        await getPublicRequestPage({
          workspaceSlug: workspace.slug,
          productSlug: product.slug,
          boardSlug: board.slug,
          requestId,
        }),
      ).toBeNull();
    }
  });

  isolatedTest("hides a rejected request even where approval is not required", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const board = await createBoard(product.id, { slug: "feedback" });
    const hidden = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: "Rejected but unmoderated board",
    });
    const shown = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: "Ordinary request",
    });
    await createModerationReview({
      productId: product.id,
      contentType: "feedback_post",
      contentId: hidden.id,
      status: "rejected",
    });

    const page = await getPublicBoardPage({
      workspaceSlug: workspace.slug,
      productSlug: product.slug,
      boardSlug: board.slug,
    });
    expect(page?.requests.map((request) => request.id)).toEqual([shown.id]);
  });

  isolatedTest("drops banned authors and never answers a foreign tenant's request id", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const board = await createBoard(product.id, { slug: "feedback" });

    const banned = await createCustomer(workspace.id, {
      name: "Banned Person",
      bannedAt: new Date(),
    });
    const allowed = await createCustomer(workspace.id, { name: "Allowed Person" });

    const bannedPost = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: "Banned author's request",
      authorCustomerId: banned.id,
    });
    const allowedPost = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: "Allowed author's request",
      authorCustomerId: allowed.id,
    });

    // A second tenant with the same board slug and a request of its own.
    const otherWorkspace = await createWorkspace();
    const otherProduct = await createProduct(otherWorkspace.id);
    const otherBoard = await createBoard(otherProduct.id, { slug: "feedback" });
    const foreignPost = await createFeedbackPost({
      productId: otherProduct.id,
      boardId: otherBoard.id,
      title: "Another tenant's request",
    });

    const page = await getPublicBoardPage({
      workspaceSlug: workspace.slug,
      productSlug: product.slug,
      boardSlug: board.slug,
    });
    expect(page?.requests.map((request) => request.id)).toEqual([allowedPost.id]);
    expect(page?.requests[0]?.authorName).toBe("Allowed Person");

    for (const requestId of [bannedPost.id, foreignPost.id]) {
      expect(
        await getPublicRequestPage({
          workspaceSlug: workspace.slug,
          productSlug: product.slug,
          boardSlug: board.slug,
          requestId,
        }),
      ).toBeNull();
    }
  });

  isolatedTest("serialises nothing beyond the public field list", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const board = await createBoard(product.id, { slug: "feedback" });
    const post = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: "Narrow payload",
      authorLabel: "Public label",
      authorEmail: "private-author@example.test",
    });
    await createFeedbackComment({
      productId: product.id,
      feedbackPostId: post.id,
      body: "INTERNAL-ONLY-MARKER",
      internal: true,
    });
    await createFeedbackComment({
      productId: product.id,
      feedbackPostId: post.id,
      body: "Visible reply",
      internal: false,
    });
    await createModerationReview({
      productId: product.id,
      contentType: "feedback_post",
      contentId: post.id,
      status: "rejected",
      reasons: ["SENSITIVE-REASON-MARKER"],
    });

    const page = await getPublicBoardPage({
      workspaceSlug: workspace.slug,
      productSlug: product.slug,
      boardSlug: board.slug,
    });
    expect(page).not.toBeNull();
    expect(page?.requests).toHaveLength(0);

    const detail = await getPublicRequestPage({
      workspaceSlug: workspace.slug,
      productSlug: product.slug,
      boardSlug: board.slug,
      requestId: post.id,
    });
    expect(detail).toBeNull();

    // Approve it, then inspect the exact serialised shape.
    await createModerationReview({
      productId: product.id,
      contentType: "feedback_post",
      contentId: post.id,
      status: "approved",
    });
    const approved = await getPublicRequestPage({
      workspaceSlug: workspace.slug,
      productSlug: product.slug,
      boardSlug: board.slug,
      requestId: post.id,
    });

    const payload = JSON.stringify(approved);
    expect(payload).not.toContain("INTERNAL-ONLY-MARKER");
    expect(payload).not.toContain("private-author@example.test");
    expect(payload).not.toContain("SENSITIVE-REASON-MARKER");
    expect(payload).not.toContain("settings");

    expect(Object.keys(approved ?? {}).sort()).toEqual([
      "board",
      "product",
      "request",
      "workspace",
    ]);
    expect(Object.keys(approved?.request ?? {}).sort()).toEqual([
      "attachments",
      "authorName",
      "body",
      "category",
      "commentCount",
      "comments",
      "createdAt",
      "demand",
      "id",
      "linkedReleases",
      "mergedRequests",
      "plannedFor",
      "privacy",
      "reactions",
      "similarRequests",
      "status",
      "tags",
      "title",
      "updatedAt",
      "viewer",
      "visibility",
      "voteCount",
    ]);
    expect(Object.keys(approved?.request.comments[0] ?? {}).sort()).toEqual([
      "authorName",
      "authorType",
      "body",
      "createdAt",
      "id",
      "isAuthor",
      "pending",
      "privacy",
    ]);
  });

  isolatedTest("return null when the deployment flag closes the surface", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const board = await createBoard(product.id, { slug: "feedback" });
    await createFeedbackPost({ productId: product.id, boardId: board.id });

    process.env.FLAG_PUBLIC_FEEDBACK = "off";
    try {
      expect(
        await getPublicBoardPage({
          workspaceSlug: workspace.slug,
          productSlug: product.slug,
          boardSlug: board.slug,
        }),
      ).toBeNull();
    } finally {
      process.env.FLAG_PUBLIC_FEEDBACK = "on";
    }
  });
});
