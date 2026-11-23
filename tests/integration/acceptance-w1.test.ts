import { afterAll, beforeAll, describe, expect } from "bun:test";

import { and, eq } from "drizzle-orm";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

import { POST as submitRequest } from "@/app/api/public/boards/[workspaceSlug]/[productSlug]/[boardSlug]/requests/route";
import { GET as suggestRequests } from "@/app/api/public/boards/[workspaceSlug]/[productSlug]/[boardSlug]/requests/suggestions/route";
import { POST as addComment } from "@/app/api/public/boards/[workspaceSlug]/[productSlug]/[boardSlug]/requests/[requestId]/comments/route";
import { POST as followRequest } from "@/app/api/public/boards/[workspaceSlug]/[productSlug]/[boardSlug]/requests/[requestId]/follow/route";
import { POST as voteOnRequest } from "@/app/api/public/boards/[workspaceSlug]/[productSlug]/[boardSlug]/requests/[requestId]/vote/route";

import { db } from "@/db";
import { feedbackPosts, moderationReviews } from "@/db/schema";
import type { Board, BoardSettings } from "@/db/schema/boards";
import type { Product, Workspace } from "@/db/schema/workspaces";
import { mergeFeedbackRequests, unmergeFeedbackRequest } from "@/features/feedback/merge";
import { bulkUpdateFeedbackStatuses } from "@/features/feedback/triage";
import { applyModerationAction, setCustomerBan } from "@/features/moderation/service";
import { CUSTOMER_SESSION_COOKIE } from "@/features/customer-session/config";
import {
  createGuestCustomerSession,
  findActiveCustomerSession,
} from "@/features/customer-session/session";
import { parsePublicBoardQuery } from "@/features/public/query";
import {
  getPublicBoardPage,
  getPublicRequestPage,
  type PublicViewer,
} from "@/features/public/queries";
import { resolvePublicBoard } from "@/features/public/resolver";

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
 * Acceptance walk-throughs for plan.md §9 A, B and C.
 *
 * These tests use the real public write endpoints with real guest cookies and
 * read the result back through the same public projections the pages use. The
 * moderator side uses the same service calls the server actions wrap, so the
 * scenario can fail for a real reason rather than because a fixture wrote a
 * convenient row.
 *
 * Scenario A's per-follower notification, roadmap and changelog steps (4's
 * email, 5, 7 and 8) need W2's notification and public roadmap/changelog work;
 * this suite covers its W1 half: submit, moderate, discuss, vote, follow and
 * see the status change.
 */

const ORIGIN = "http://app.local";

const DEFAULT_SETTINGS: BoardSettings = {
  moderation: {
    requireApproval: "none",
    comments: "open",
    blockSensitiveInfo: false,
  },
};

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
]);

let previous: Record<string, string | undefined> = {};
let storageDir = "";

beforeAll(async () => {
  previous = {
    FLAG_PUBLIC_FEEDBACK: process.env.FLAG_PUBLIC_FEEDBACK,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    STORAGE_DIR: process.env.STORAGE_DIR,
  };

  process.env.FLAG_PUBLIC_FEEDBACK = "on";
  process.env.BETTER_AUTH_URL = ORIGIN;
  process.env.BETTER_AUTH_SECRET = "integration-secret-value-at-least-32-chars";

  storageDir = await mkdtemp(path.join(tmpdir(), "herald-acceptance-"));
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
}, SETUP_TIMEOUT_MS);

type Tenant = {
  workspace: Workspace;
  product: Product;
  board: Board;
};

async function tenant(options?: {
  plan?: "free" | "pro";
  settings?: BoardSettings;
  guestPosting?: boolean;
  visibility?: "public" | "private";
}): Promise<Tenant> {
  const workspace = await createWorkspace({ plan: options?.plan ?? "pro" });
  const product = await createProduct(workspace.id);
  const board = await createBoard(product.id, {
    slug: "feedback",
    name: "Feedback",
    guestPosting: options?.guestPosting ?? true,
    visibility: options?.visibility ?? "public",
    ...(options?.settings ? { settings: options.settings } : {}),
  });
  return { workspace, product, board };
}

function boardParams(t: Tenant) {
  return {
    params: Promise.resolve({
      workspaceSlug: t.workspace.slug,
      productSlug: t.product.slug,
      boardSlug: t.board.slug,
    }),
  };
}

function requestParams(t: Tenant, requestId: string) {
  return {
    params: Promise.resolve({
      workspaceSlug: t.workspace.slug,
      productSlug: t.product.slug,
      boardSlug: t.board.slug,
      requestId,
    }),
  };
}

function boardPath(t: Tenant): string {
  return `${ORIGIN}/api/public/boards/${t.workspace.slug}/${t.product.slug}/${t.board.slug}`;
}

function boardInput(t: Tenant) {
  return {
    workspaceSlug: t.workspace.slug,
    productSlug: t.product.slug,
    boardSlug: t.board.slug,
  };
}

function cookieHeader(cookieValue: string): string {
  return `${CUSTOMER_SESSION_COOKIE}=${cookieValue}`;
}

function readSessionCookie(response: Response): string {
  const header = response.headers.get("set-cookie") ?? "";
  const match = header.match(new RegExp(`${CUSTOMER_SESSION_COOKIE}=([^;]+)`));
  if (!match?.[1]) {
    throw new Error(`Expected a customer session cookie, got "${header}".`);
  }
  return match[1];
}

async function sessionFor(cookieValue: string) {
  const active = await findActiveCustomerSession(cookieValue);
  if (!active) throw new Error("The guest cookie did not resolve to a session.");
  return active;
}

function viewerFor(t: Tenant, customerId: string, identified = false): PublicViewer {
  return { customerId, workspaceId: t.workspace.id, identified, hasCompany: false };
}

async function submitPublicRequest(
  t: Tenant,
  input: {
    title: string;
    body: string;
    category?: string;
    cookie?: string;
    withImage?: boolean;
  },
): Promise<Response> {
  const form = new FormData();
  form.set("title", input.title);
  form.set("body", input.body);
  form.set("category", input.category ?? "feature_request");
  if (input.withImage) {
    form.set(
      "attachments",
      new File([PNG_BYTES], "screenshot.png", { type: "image/png" }),
    );
  }

  return submitRequest(
    new NextRequest(`${boardPath(t)}/requests`, {
      method: "POST",
      headers: {
        origin: ORIGIN,
        ...(input.cookie ? { cookie: cookieHeader(input.cookie) } : {}),
      },
      body: form,
    }),
    boardParams(t),
  );
}

async function latestPendingReview(productId: string, contentId: string) {
  const rows = await db
    .select({ id: moderationReviews.id })
    .from(moderationReviews)
    .where(
      and(
        eq(moderationReviews.productId, productId),
        eq(moderationReviews.contentType, "feedback_post"),
        eq(moderationReviews.contentId, contentId),
        eq(moderationReviews.status, "pending"),
      ),
    )
    .limit(1);

  const review = rows[0];
  if (!review) throw new Error("Expected a pending moderation review.");
  return review;
}

describe("plan.md §9 A (W1 half) — anonymous submission, moderation and status", () => {
  isolatedTest(
    "a guest submits, a moderator publishes, a visitor votes/comments/follows, and the author sees the status change",
    async () => {
      const t = await tenant({
        settings: {
          moderation: {
            requireApproval: "all",
            comments: "open",
            blockSensitiveInfo: false,
          },
        },
      });

      const submitted = await submitPublicRequest(t, {
        title: "Export votes to CSV",
        body: "I need the voter list as a spreadsheet so I can follow up with customers.",
        category: "feature_request",
        withImage: true,
      });

      expect(submitted.status).toBe(201);
      const receipt = (await submitted.json()) as { id: string; status: string };
      expect(receipt.status).toBe("awaiting_review");
      expect(receipt.id).toMatch(/^[0-9a-f-]{36}$/);

      const authorCookie = readSessionCookie(submitted);
      const authorSession = await sessionFor(authorCookie);

      // The author's receipt exists, but nobody else can see the request.
      const authorReceipt = await getPublicRequestPage(
        { ...boardInput(t), requestId: receipt.id },
        viewerFor(t, authorSession.customer.id),
      );
      expect(authorReceipt?.request.visibility).toBe("awaiting_review");
      expect(authorReceipt?.request.attachments).toHaveLength(1);
      expect(
        (
          await getPublicBoardPage(boardInput(t), parsePublicBoardQuery({}))
        )?.requests.map((request) => request.id),
      ).not.toContain(receipt.id);

      const review = await latestPendingReview(t.product.id, receipt.id);
      const moderator = await createUser();
      expect(
        await applyModerationAction({
          reviewId: review.id,
          productId: t.product.id,
          userId: moderator.id,
          action: "approve",
        }),
      ).toEqual({ ok: true, status: "approved" });

      expect(
        (
          await getPublicBoardPage(boardInput(t), parsePublicBoardQuery({}))
        )?.requests.map((request) => request.id),
      ).toContain(receipt.id);

      // A second visitor arrives without a session, votes, comments and follows.
      const vote = await voteOnRequest(
        new NextRequest(`${boardPath(t)}/requests/${receipt.id}/vote`, {
          method: "POST",
          headers: { origin: ORIGIN },
        }),
        requestParams(t, receipt.id),
      );
      expect(vote.status).toBe(200);
      expect(await vote.json()).toEqual({ voted: true, voteCount: 1 });
      const visitorCookie = readSessionCookie(vote);
      const visitorSession = await sessionFor(visitorCookie);

      const comment = await addComment(
        new NextRequest(`${boardPath(t)}/requests/${receipt.id}/comments`, {
          method: "POST",
          headers: {
            origin: ORIGIN,
            cookie: cookieHeader(visitorCookie),
            "content-type": "application/json",
          },
          body: JSON.stringify({ body: "This would save me a lot of copy-paste." }),
        }),
        requestParams(t, receipt.id),
      );
      expect(comment.status).toBe(201);
      expect(await comment.json()).toMatchObject({ status: "published" });

      const follow = await followRequest(
        new NextRequest(`${boardPath(t)}/requests/${receipt.id}/follow`, {
          method: "POST",
          headers: { origin: ORIGIN, cookie: cookieHeader(visitorCookie) },
        }),
        requestParams(t, receipt.id),
      );
      expect(follow.status).toBe(200);
      expect(await follow.json()).toEqual({ follows: true });

      // The author sees the published request, the visitor's comment, and
      // remains followed after voting and commenting.
      const authorView = await getPublicRequestPage(
        { ...boardInput(t), requestId: receipt.id },
        viewerFor(t, authorSession.customer.id),
      );
      expect(authorView?.request.visibility).toBe("public");
      expect(authorView?.request.status).toBe("open");
      expect(authorView?.request.viewer.isAuthor).toBe(true);
      expect(authorView?.request.viewer.follows).toBe(true);
      expect(authorView?.request.voteCount).toBe(1);
      expect(authorView?.request.comments.map((entry) => entry.body)).toContain(
        "This would save me a lot of copy-paste.",
      );

      const visitorView = await getPublicRequestPage(
        { ...boardInput(t), requestId: receipt.id },
        viewerFor(t, visitorSession.customer.id),
      );
      expect(visitorView?.request.viewer.hasVoted).toBe(true);
      expect(visitorView?.request.viewer.follows).toBe(true);

      // The moderator plans it; both the author and the visitor see the new
      // status on their next page load.
      expect(
        await bulkUpdateFeedbackStatuses({
          productId: t.product.id,
          postIds: [receipt.id],
          status: "planned",
        }),
      ).toEqual({ updated: 1, skipped: 0 });

      const plannedForAuthor = await getPublicRequestPage(
        { ...boardInput(t), requestId: receipt.id },
        viewerFor(t, authorSession.customer.id),
      );
      expect(plannedForAuthor?.request.status).toBe("planned");

      const plannedForVisitor = await getPublicRequestPage(
        { ...boardInput(t), requestId: receipt.id },
        viewerFor(t, visitorSession.customer.id),
      );
      expect(plannedForVisitor?.request.status).toBe("planned");
    },
  );
});

describe("plan.md §9 B — duplicate and merge", () => {
  isolatedTest(
    "suggests the first request before submission, merges, hides the duplicate and restores it on unmerge",
    async () => {
      const t = await tenant({ settings: DEFAULT_SETTINGS });

      const first = await submitPublicRequest(t, {
        title: "Export votes to CSV",
        body: "A spreadsheet export of voters would let me reconcile the list.",
      });
      expect(first.status).toBe(201);
      const firstBody = (await first.json()) as { id: string; status: string };
      expect(firstBody.status).toBe("published");
      const firstCookie = readSessionCookie(first);
      const firstSession = await sessionFor(firstCookie);

      const suggestions = await suggestRequests(
        new NextRequest(`${boardPath(t)}/requests/suggestions?q=export%20votes`, {
          headers: { origin: ORIGIN },
        }),
        boardParams(t),
      );
      expect(suggestions.status).toBe(200);
      const suggestionBody = (await suggestions.json()) as {
        suggestions: { id: string; title: string }[];
      };
      expect(suggestionBody.suggestions[0]?.id).toBe(firstBody.id);

      const second = await submitPublicRequest(t, {
        title: "Export votes as CSV",
        body: "I want to download the people who voted so I can email them.",
      });
      expect(second.status).toBe(201);
      const secondBody = (await second.json()) as { id: string; status: string };
      expect(secondBody.status).toBe("published");
      const secondCookie = readSessionCookie(second);
      const secondSession = await sessionFor(secondCookie);

      const voteTarget = await voteOnRequest(
        new NextRequest(`${boardPath(t)}/requests/${firstBody.id}/vote`, {
          method: "POST",
          headers: { origin: ORIGIN, cookie: cookieHeader(firstCookie) },
        }),
        requestParams(t, firstBody.id),
      );
      expect(voteTarget.status).toBe(200);

      const voteSource = await voteOnRequest(
        new NextRequest(`${boardPath(t)}/requests/${secondBody.id}/vote`, {
          method: "POST",
          headers: { origin: ORIGIN, cookie: cookieHeader(secondCookie) },
        }),
        requestParams(t, secondBody.id),
      );
      expect(voteSource.status).toBe(200);

      const sourceComment = await addComment(
        new NextRequest(`${boardPath(t)}/requests/${secondBody.id}/comments`, {
          method: "POST",
          headers: {
            origin: ORIGIN,
            cookie: cookieHeader(secondCookie),
            "content-type": "application/json",
          },
          body: JSON.stringify({ body: "The duplicate's comment must move." }),
        }),
        requestParams(t, secondBody.id),
      );
      expect(sourceComment.status).toBe(201);

      const moderator = await createUser();
      const merged = await mergeFeedbackRequests({
        productId: t.product.id,
        sourceId: secondBody.id,
        targetId: firstBody.id,
        userId: moderator.id,
      });
      expect(merged.ok).toBe(true);

      const boardAfterMerge = await getPublicBoardPage(
        boardInput(t),
        parsePublicBoardQuery({}),
      );
      expect(boardAfterMerge?.requests.map((request) => request.id)).toContain(
        firstBody.id,
      );
      expect(boardAfterMerge?.requests.map((request) => request.id)).not.toContain(
        secondBody.id,
      );
      expect(
        await getPublicRequestPage({ ...boardInput(t), requestId: secondBody.id }),
      ).toBeNull();

      const canonical = await getPublicRequestPage(
        { ...boardInput(t), requestId: firstBody.id },
        viewerFor(t, firstSession.customer.id),
      );
      expect(canonical?.request.voteCount).toBe(2);
      expect(canonical?.request.comments.map((entry) => entry.body)).toContain(
        "The duplicate's comment must move.",
      );
      expect(canonical?.request.mergedRequests.map((request) => request.id)).toContain(
        secondBody.id,
      );

      const undone = await unmergeFeedbackRequest({
        productId: t.product.id,
        sourceId: secondBody.id,
      });
      expect(undone.ok).toBe(true);

      const restored = await getPublicRequestPage(
        { ...boardInput(t), requestId: secondBody.id },
        viewerFor(t, secondSession.customer.id),
      );
      expect(restored?.request.status).toBe("open");
      expect(restored?.request.voteCount).toBe(1);
      expect(restored?.request.comments.map((entry) => entry.body)).toContain(
        "The duplicate's comment must move.",
      );

      const targetAfterUnmerge = await getPublicRequestPage(
        { ...boardInput(t), requestId: firstBody.id },
        viewerFor(t, firstSession.customer.id),
      );
      expect(targetAfterUnmerge?.request.voteCount).toBe(1);
      expect(targetAfterUnmerge?.request.comments.map((entry) => entry.body)).not.toContain(
        "The duplicate's comment must move.",
      );
    },
  );
});

describe("plan.md §9 C — private board and moderation", () => {
  isolatedTest("a private board is invisible to every public projection", async () => {
    const t = await tenant({ visibility: "private" });
    const author = await createCustomer(t.workspace.id);
    const other = await createCustomer(t.workspace.id);
    const post = await createFeedbackPost({
      productId: t.product.id,
      boardId: t.board.id,
      title: "Private roadmap idea",
      authorCustomerId: author.id,
    });

    expect(
      await resolvePublicBoard({
        workspaceSlug: t.workspace.slug,
        productSlug: t.product.slug,
        boardSlug: t.board.slug,
      }),
    ).toBeNull();
    expect(
      await getPublicBoardPage(boardInput(t), parsePublicBoardQuery({})),
    ).toBeNull();
    expect(
      await getPublicRequestPage(
        { ...boardInput(t), requestId: post.id },
        viewerFor(t, other.id),
      ),
    ).toBeNull();
  });

  isolatedTest(
    "sensitive text is refused before storage, and a held submission stays out of public view until a moderator publishes it",
    async () => {
      const blocking = await tenant({
        settings: {
          moderation: {
            requireApproval: "none",
            comments: "open",
            blockSensitiveInfo: true,
          },
        },
      });

      const sensitive = await submitPublicRequest(blocking, {
        title: "Charged twice",
        body: "My card is 4111 1111 1111 1111 and it was charged twice.",
      });
      expect(sensitive.status).toBe(400);
      const sensitiveBody = (await sensitive.json()) as { field?: string };
      expect(sensitiveBody.field).toBe("body");
      expect(
        await db
          .select({ id: feedbackPosts.id })
          .from(feedbackPosts)
          .where(eq(feedbackPosts.productId, blocking.product.id)),
      ).toHaveLength(0);

      const moderated = await tenant({
        settings: {
          moderation: {
            requireApproval: "all",
            comments: "moderated",
            blockSensitiveInfo: false,
          },
        },
      });
      const held = await submitPublicRequest(moderated, {
        title: "A request for the queue",
        body: "This should wait for a moderator before anyone can read it.",
      });
      expect(held.status).toBe(201);
      const heldBody = (await held.json()) as { id: string; status: string };
      expect(heldBody.status).toBe("awaiting_review");

      expect(
        (
          await getPublicBoardPage(boardInput(moderated), parsePublicBoardQuery({}))
        )?.requests.map((request) => request.id),
      ).not.toContain(heldBody.id);

      const review = await latestPendingReview(moderated.product.id, heldBody.id);
      const moderator = await createUser();
      expect(
        await applyModerationAction({
          reviewId: review.id,
          productId: moderated.product.id,
          userId: moderator.id,
          action: "publish",
        }),
      ).toEqual({ ok: true, status: "approved" });

      expect(
        (
          await getPublicBoardPage(boardInput(moderated), parsePublicBoardQuery({}))
        )?.requests.map((request) => request.id),
      ).toContain(heldBody.id);
    },
  );

  isolatedTest("a banned customer loses their session and cannot participate", async () => {
    const t = await tenant({ guestPosting: false });
    const created = await createGuestCustomerSession(t.workspace.id);
    const customerId = created.active.customer.id;

    const post = await createFeedbackPost({
      productId: t.product.id,
      boardId: t.board.id,
      title: "A request before the ban",
      authorCustomerId: customerId,
    });

    expect(
      await setCustomerBan({
        workspaceId: t.workspace.id,
        customerId,
        banned: true,
      }),
    ).toEqual({ ok: true, banned: true });

    // The ban revokes the session, so the old cookie is as good as anonymous.
    // This board requires an email, which a banned address can never supply.
    expect(await findActiveCustomerSession(created.cookieValue)).toBeNull();
    const afterBan = await voteOnRequest(
      new NextRequest(`${boardPath(t)}/requests/${post.id}/vote`, {
        method: "POST",
        headers: {
          origin: ORIGIN,
          cookie: cookieHeader(created.cookieValue),
        },
      }),
      requestParams(t, post.id),
    );
    expect(afterBan.status).toBe(401);

    expect(
      (
        await getPublicBoardPage(boardInput(t), parsePublicBoardQuery({}))
      )?.requests.map((request) => request.id),
    ).not.toContain(post.id);
    expect(
      await getPublicRequestPage({ ...boardInput(t), requestId: post.id }),
    ).toBeNull();
  });
});
