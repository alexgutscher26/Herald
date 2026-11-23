import { afterAll, beforeAll, describe, expect } from "bun:test";

import { and, desc, eq } from "drizzle-orm";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { db } from "@/db";
import {
  feedbackAttachments,
  feedbackPosts,
  moderationReviews,
} from "@/db/schema";
import type { BoardSettings } from "@/db/schema/boards";
import {
  applyModerationAction,
  retryReviewChecks,
} from "@/features/moderation/service";
import {
  getModerationCounts,
  getModerationQueue,
} from "@/features/moderation/queue";
import {
  addPublicComment,
  createPublicRequest,
} from "@/features/public/engagement";
import { parsePublicBoardQuery } from "@/features/public/query";
import {
  getPublicBoardPage,
  getPublicRequestPage,
  type PublicViewer,
} from "@/features/public/queries";
import { getStorage } from "@/features/storage";

import {
  createBoard,
  createCustomer,
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
 * Moderation is a visibility contract: a decision must change what a visitor
 * can read immediately, and a review from another product must be unusable.
 * The image-text provider is a local HTTP server, so the real adapter and
 * check pipeline run end to end.
 */

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
]);

let ocrServer: ReturnType<typeof Bun.serve> | null = null;
let ocrText = "thanks for the screenshot";
let previous: Record<string, string | undefined> = {};
let storageDir = "";

beforeAll(async () => {
  ocrServer = Bun.serve({
    port: 0,
    async fetch(request) {
      const form = await request.formData();
      if (!form.get("file")) {
        return Response.json({ error: "missing file" }, { status: 400 });
      }
      return Response.json({ text: ocrText });
    },
  });

  previous = {
    FLAG_PUBLIC_FEEDBACK: process.env.FLAG_PUBLIC_FEEDBACK,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    STORAGE_DIR: process.env.STORAGE_DIR,
    OCR_API_URL: process.env.OCR_API_URL,
    OCR_API_KEY: process.env.OCR_API_KEY,
  };

  process.env.FLAG_PUBLIC_FEEDBACK = "on";
  process.env.BETTER_AUTH_URL = "http://app.local";
  process.env.BETTER_AUTH_SECRET ??= "integration-secret-value-at-least-32-chars";
  delete process.env.OCR_API_URL;
  delete process.env.OCR_API_KEY;

  storageDir = await mkdtemp(path.join(tmpdir(), "herald-moderation-"));
  process.env.STORAGE_DIR = storageDir;

  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  await rm(storageDir, { recursive: true, force: true });
  await teardownTestDatabase();
  ocrServer?.stop(true);
  ocrServer = null;
}, SETUP_TIMEOUT_MS);

const DEFAULT_SETTINGS: BoardSettings = {
  moderation: {
    requireApproval: "none",
    comments: "open",
    blockSensitiveInfo: false,
  },
};

async function tenant(settings: BoardSettings = DEFAULT_SETTINGS) {
  const workspace = await createWorkspace();
  const product = await createProduct(workspace.id);
  const board = await createBoard(product.id, {
    slug: "feedback",
    name: "Feedback",
    guestPosting: true,
    settings,
  });
  return { workspace, product, board };
}

function viewerFor(
  t: Awaited<ReturnType<typeof tenant>>,
  customerId: string,
): PublicViewer {
  return { customerId, workspaceId: t.workspace.id, identified: true, hasCompany: false };
}

function boardInput(t: Awaited<ReturnType<typeof tenant>>) {
  return {
    workspaceSlug: t.workspace.slug,
    productSlug: t.product.slug,
    boardSlug: t.board.slug,
  };
}

async function latestReview(
  contentType: "feedback_post" | "feedback_comment",
  contentId: string,
) {
  const rows = await db
    .select()
    .from(moderationReviews)
    .where(
      and(
        eq(moderationReviews.contentType, contentType),
        eq(moderationReviews.contentId, contentId),
      ),
    )
    .orderBy(desc(moderationReviews.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

describe("automated flags", () => {
  isolatedTest("flag spam yet leave it visible on an unmoderated board", async () => {
    const t = await tenant();
    const author = await createCustomer(t.workspace.id, { name: "Ada" });

    const created = await createPublicRequest({
      tenant: t,
      customerId: author.id,
      customerName: "Ada",
      title: "Great opportunity",
      body: "Buy now! Limited time offer. https://a.example https://b.example https://c.example https://d.example",
      category: "question",
      files: [],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.status).toBe("published");

    const review = await latestReview("feedback_post", created.id);
    expect(review?.status).toBe("pending");
    expect(review?.reasons).toContain("spam");
    expect(review?.checks.text).toBe("flagged");

    const page = await getPublicBoardPage(
      boardInput(t),
      parsePublicBoardQuery({}),
    );
    expect(page?.requests.map((request) => request.id)).toEqual([created.id]);

    const queue = await getModerationQueue({
      productId: t.product.id,
      workspaceSlug: t.workspace.slug,
      productSlug: t.product.slug,
      status: "pending",
    });
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      contentType: "feedback_post",
      contentId: created.id,
      held: false,
      reasons: expect.arrayContaining(["spam"]),
    });
  });

  isolatedTest("flag sensitive text as advisory when the board does not block it", async () => {
    const t = await tenant();
    const author = await createCustomer(t.workspace.id);

    const created = await createPublicRequest({
      tenant: t,
      customerId: author.id,
      customerName: null,
      title: "Billing",
      body: "My card is 4111 1111 1111 1111 and it failed.",
      category: "bug",
      files: [],
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const review = await latestReview("feedback_post", created.id);
    expect(review?.reasons).toContain("sensitive_info");
    expect(JSON.stringify(review?.reasons)).not.toContain("4111");

    const visitorPage = await getPublicRequestPage({
      ...boardInput(t),
      requestId: created.id,
    });
    expect(visitorPage).not.toBeNull();
  });
});

describe("decisions", () => {
  isolatedTest("publish a held request and make it public", async () => {
    const t = await tenant({
      moderation: {
        requireApproval: "all",
        comments: "open",
        blockSensitiveInfo: false,
      },
    });
    const author = await createCustomer(t.workspace.id, { name: "Ada" });
    const moderator = await createUser();

    const created = await createPublicRequest({
      tenant: t,
      customerId: author.id,
      customerName: "Ada",
      title: "Dark mode",
      body: "Please add a dark theme.",
      category: "feature_request",
      files: [],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.status).toBe("awaiting_review");
    expect(
      await getPublicRequestPage({ ...boardInput(t), requestId: created.id }),
    ).toBeNull();

    const review = await latestReview("feedback_post", created.id);
    if (!review) throw new Error("Expected a pending review.");

    const queue = await getModerationQueue({
      productId: t.product.id,
      workspaceSlug: t.workspace.slug,
      productSlug: t.product.slug,
      status: "pending",
    });
    expect(queue[0]?.held).toBe(true);

    const result = await applyModerationAction({
      reviewId: review.id,
      productId: t.product.id,
      userId: moderator.id,
      action: "publish",
    });
    expect(result).toEqual({ ok: true, status: "approved" });

    const page = await getPublicRequestPage({
      ...boardInput(t),
      requestId: created.id,
    });
    expect(page?.request.id).toBe(created.id);
    expect(page?.request.visibility).toBe("public");
  });

  isolatedTest("keep hidden removes it from the public board, approve restores it", async () => {
    const t = await tenant();
    const author = await createCustomer(t.workspace.id);
    const moderator = await createUser();

    const created = await createPublicRequest({
      tenant: t,
      customerId: author.id,
      customerName: null,
      title: "Spammy",
      body: "Buy now and click this link https://bit.ly/xyz",
      category: "question",
      files: [],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const review = await latestReview("feedback_post", created.id);
    if (!review) throw new Error("Expected a review.");

    expect(
      await applyModerationAction({
        reviewId: review.id,
        productId: t.product.id,
        userId: moderator.id,
        action: "keep_hidden",
      }),
    ).toEqual({ ok: true, status: "rejected" });

    expect(
      await getPublicRequestPage({ ...boardInput(t), requestId: created.id }),
    ).toBeNull();
    const hiddenBoard = await getPublicBoardPage(
      boardInput(t),
      parsePublicBoardQuery({}),
    );
    expect(hiddenBoard?.requests).toEqual([]);

    expect(
      await applyModerationAction({
        reviewId: review.id,
        productId: t.product.id,
        userId: moderator.id,
        action: "approve",
      }),
    ).toEqual({ ok: true, status: "approved" });

    const restored = await getPublicRequestPage({
      ...boardInput(t),
      requestId: created.id,
    });
    expect(restored?.request.id).toBe(created.id);
  });

  isolatedTest("delete removes the row, its history and its stored attachment", async () => {
    const t = await tenant();
    const author = await createCustomer(t.workspace.id);
    const moderator = await createUser();

    const created = await createPublicRequest({
      tenant: t,
      customerId: author.id,
      customerName: null,
      title: "With screenshot",
      body: "A normal request with a screenshot.",
      category: "bug",
      files: [{ fileName: "shot.png", mimeType: "image/png", body: PNG_BYTES }],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const attachments = await db
      .select({ key: feedbackAttachments.storageKey })
      .from(feedbackAttachments)
      .where(eq(feedbackAttachments.feedbackPostId, created.id));
    expect(attachments).toHaveLength(1);
    const storageKey = attachments[0]?.key ?? "";
    expect(await getStorage().get(storageKey)).not.toBeNull();

    const review = await latestReview("feedback_post", created.id);
    if (!review) throw new Error("Expected a review.");

    const result = await applyModerationAction({
      reviewId: review.id,
      productId: t.product.id,
      userId: moderator.id,
      action: "delete",
    });
    expect(result).toEqual({ ok: true, status: "deleted" });

    const posts = await db
      .select({ id: feedbackPosts.id })
      .from(feedbackPosts)
      .where(eq(feedbackPosts.id, created.id));
    expect(posts).toHaveLength(0);

    const reviews = await db
      .select({ id: moderationReviews.id })
      .from(moderationReviews)
      .where(eq(moderationReviews.contentId, created.id));
    expect(reviews).toHaveLength(0);

    expect(await getStorage().get(storageKey)).toBeNull();
  });

  isolatedTest("cannot decide a review that belongs to another product", async () => {
    const t = await tenant();
    const other = await tenant();
    const author = await createCustomer(t.workspace.id);
    const moderator = await createUser();

    const created = await createPublicRequest({
      tenant: t,
      customerId: author.id,
      customerName: null,
      title: "Other tenant",
      body: "Buy now https://bit.ly/a",
      category: "question",
      files: [],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const review = await latestReview("feedback_post", created.id);
    if (!review) throw new Error("Expected a review.");

    const result = await applyModerationAction({
      reviewId: review.id,
      productId: other.product.id,
      userId: moderator.id,
      action: "approve",
    });
    expect(result.ok).toBe(false);

    expect(
      await getModerationQueue({
        productId: other.product.id,
        workspaceSlug: other.workspace.slug,
        productSlug: other.product.slug,
        status: "all",
      }),
    ).toEqual([]);
  });
});

describe("comments", () => {
  isolatedTest("approving a moderated comment publishes it", async () => {
    const t = await tenant({
      moderation: {
        requireApproval: "none",
        comments: "moderated",
        blockSensitiveInfo: false,
      },
    });
    const author = await createCustomer(t.workspace.id, { name: "Ada" });
    const commenter = await createCustomer(t.workspace.id, { name: "Grace" });
    const moderator = await createUser();

    const created = await createPublicRequest({
      tenant: t,
      customerId: author.id,
      customerName: "Ada",
      title: "A request",
      body: "Please add this.",
      category: "feature_request",
      files: [],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const comment = await addPublicComment({
      tenant: t,
      requestId: created.id,
      customerId: commenter.id,
      customerName: "Grace",
      body: "I would use this too.",
    });
    expect(comment.ok).toBe(true);
    if (!comment.ok) return;
    expect(comment.status).toBe("awaiting_review");

    const authorView = await getPublicRequestPage(
      { ...boardInput(t), requestId: created.id },
      viewerFor(t, commenter.id),
    );
    expect(authorView?.request.comments).toHaveLength(1);
    expect(authorView?.request.comments[0]?.pending).toBe(true);

    const visitorView = await getPublicRequestPage({
      ...boardInput(t),
      requestId: created.id,
    });
    expect(visitorView?.request.comments).toEqual([]);

    const review = await latestReview("feedback_comment", comment.commentId);
    if (!review) throw new Error("Expected a pending comment review.");

    await applyModerationAction({
      reviewId: review.id,
      productId: t.product.id,
      userId: moderator.id,
      action: "approve",
    });

    const publicView = await getPublicRequestPage({
      ...boardInput(t),
      requestId: created.id,
    });
    expect(publicView?.request.comments).toHaveLength(1);
    expect(publicView?.request.comments[0]?.pending).toBe(false);
  });
});

describe("retry", () => {
  isolatedTest("re-running checks clears stale automated reasons", async () => {
    const t = await tenant();
    const author = await createCustomer(t.workspace.id);

    const created = await createPublicRequest({
      tenant: t,
      customerId: author.id,
      customerName: null,
      title: "Spam now clean",
      body: "Buy now https://bit.ly/abc",
      category: "question",
      files: [],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await db
      .update(feedbackPosts)
      .set({ title: "A calmer title", body: "The page does not load on Safari 18." })
      .where(eq(feedbackPosts.id, created.id));

    const review = await latestReview("feedback_post", created.id);
    if (!review) throw new Error("Expected a review.");

    const result = await retryReviewChecks({
      reviewId: review.id,
      productId: t.product.id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reasons).toEqual([]);
    expect(result.checks.text).toBe("ok");

    const updated = await latestReview("feedback_post", created.id);
    expect(updated?.reasons).toEqual([]);
  });
});

describe("image checks", () => {
  isolatedTest("a configured provider scans an image for sensitive information", async () => {
    const t = await tenant();
    const author = await createCustomer(t.workspace.id);

    ocrText = "receipt card 4111 1111 1111 1111 total 20";
    process.env.OCR_API_URL = `http://127.0.0.1:${ocrServer?.port}/ocr`;

    try {
      const created = await createPublicRequest({
        tenant: t,
        customerId: author.id,
        customerName: null,
        title: "Screenshot",
        body: "See the attached receipt.",
        category: "bug",
        files: [{ fileName: "receipt.png", mimeType: "image/png", body: PNG_BYTES }],
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const review = await latestReview("feedback_post", created.id);
      expect(review?.reasons).toContain("sensitive_info_image");
      expect(review?.checks.images).toEqual({
        scanned: 1,
        flagged: 1,
        unavailable: 0,
        errors: 0,
      });
    } finally {
      delete process.env.OCR_API_URL;
    }
  });

  isolatedTest("a board that blocks sensitive information refuses an unscanned image", async () => {
    const t = await tenant({
      moderation: {
        requireApproval: "none",
        comments: "open",
        blockSensitiveInfo: true,
      },
    });
    const author = await createCustomer(t.workspace.id);
    delete process.env.OCR_API_URL;

    const created = await createPublicRequest({
      tenant: t,
      customerId: author.id,
      customerName: null,
      title: "Screenshot",
      body: "Here is a screenshot.",
      category: "bug",
      files: [{ fileName: "shot.png", mimeType: "image/png", body: PNG_BYTES }],
    });

    expect(created.ok).toBe(false);
    if (created.ok) return;
    expect(created.status).toBe(400);
    expect(created.error).toContain("image scanning is not available");

    const rows = await db
      .select({ id: feedbackPosts.id })
      .from(feedbackPosts)
      .where(eq(feedbackPosts.productId, t.product.id));
    expect(rows).toHaveLength(0);
  });

  isolatedTest("a clean image passes a blocking board", async () => {
    const t = await tenant({
      moderation: {
        requireApproval: "none",
        comments: "open",
        blockSensitiveInfo: true,
      },
    });
    const author = await createCustomer(t.workspace.id);

    ocrText = "a normal screenshot of a dashboard";
    process.env.OCR_API_URL = `http://127.0.0.1:${ocrServer?.port}/ocr`;

    try {
      const created = await createPublicRequest({
        tenant: t,
        customerId: author.id,
        customerName: null,
        title: "Dashboard",
        body: "Here is the dashboard.",
        category: "bug",
        files: [{ fileName: "shot.png", mimeType: "image/png", body: PNG_BYTES }],
      });
      expect(created.ok).toBe(true);
    } finally {
      delete process.env.OCR_API_URL;
    }
  });
});

describe("queue counts", () => {
  isolatedTest("counts the newest review for each item", async () => {
    const t = await tenant();
    const author = await createCustomer(t.workspace.id);

    const post = await createFeedbackPost({
      productId: t.product.id,
      boardId: t.board.id,
      authorCustomerId: author.id,
      title: "One",
    });

    await db.insert(moderationReviews).values([
      {
        productId: t.product.id,
        contentType: "feedback_post",
        contentId: post.id,
        status: "pending",
        reasons: ["spam"],
        createdAt: new Date(Date.now() - 1_000),
        updatedAt: new Date(Date.now() - 1_000),
      },
      {
        productId: t.product.id,
        contentType: "feedback_post",
        contentId: post.id,
        status: "approved",
        reasons: [],
      },
    ]);

    expect(await getModerationCounts(t.product.id)).toEqual({
      pending: 0,
      approved: 1,
      rejected: 0,
    });
  });
});
