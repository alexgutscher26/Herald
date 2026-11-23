import { afterAll, beforeAll, describe, expect } from "bun:test";

import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

import { handleApiRequest } from "@/features/api-v1/router";
import { API_ROUTE_DEFINITIONS } from "@/features/api-v1/routes";
import { createApiTokenMaterial } from "@/features/api-v1/token";

import { GET as readBoardRoute } from "@/app/api/public/boards/[workspaceSlug]/[productSlug]/[boardSlug]/route";
import { POST as submitRequest } from "@/app/api/public/boards/[workspaceSlug]/[productSlug]/[boardSlug]/requests/route";
import { POST as addComment } from "@/app/api/public/boards/[workspaceSlug]/[productSlug]/[boardSlug]/requests/[requestId]/comments/route";
import { POST as followRequest } from "@/app/api/public/boards/[workspaceSlug]/[productSlug]/[boardSlug]/requests/[requestId]/follow/route";
import { POST as reactToRequest } from "@/app/api/public/boards/[workspaceSlug]/[productSlug]/[boardSlug]/requests/[requestId]/reactions/route";
import { POST as voteOnRequest } from "@/app/api/public/boards/[workspaceSlug]/[productSlug]/[boardSlug]/requests/[requestId]/vote/route";

import { db } from "@/db";
import {
  apiTokens,
  boardTags,
  customers,
  feedbackComments,
  feedbackCustomerVotes,
  feedbackFollowers,
  feedbackPosts,
  feedbackReactions,
  feedbackSavedViews,
  feedbackTagLinks,
  moderationReviews,
} from "@/db/schema";
import type { Board } from "@/db/schema/boards";
import type { Product, Workspace } from "@/db/schema/workspaces";
import { findBoardForProduct, listBoardsForProduct } from "@/db/queries/boards";
import {
  findMembershipBySlug,
  findProductInWorkspace,
  listWorkspacesForUser,
} from "@/db/queries/workspaces";
import { CUSTOMER_SESSION_COOKIE } from "@/features/customer-session/config";
import {
  createGuestCustomerSession,
  findActiveCustomerSession,
  identifyCustomer,
} from "@/features/customer-session/session";
import { mergeFeedbackRequests, unmergeFeedbackRequest } from "@/features/feedback/merge";
import {
  deleteFeedbackView,
  saveFeedbackView,
} from "@/features/feedback/saved-views";
import { createTag, deleteTag, replacePostTags } from "@/features/feedback/tags";
import { bulkSetFeedbackHidden, bulkUpdateFeedbackStatuses } from "@/features/feedback/triage";
import { applyModerationAction, setCustomerBan } from "@/features/moderation/service";
import {
  addPublicComment,
  setCustomerFollow,
  setCustomerReaction,
  setCustomerVote,
} from "@/features/public/engagement";
import { parsePublicBoardQuery } from "@/features/public/query";
import {
  getPublicBoardPage,
  getPublicRequestPage,
  suggestPublicRequests,
  type PublicViewer,
} from "@/features/public/queries";
import { resolvePublicBoard } from "@/features/public/resolver";

import {
  createBoard,
  createBoardTag,
  createConversation,
  createCustomer,
  createFeedbackPost,
  createMember,
  createModerationReview,
  createProduct,
  createUser,
  createWorkspace,
  uniqueLabel,
} from "./factories";
import {
  SETUP_TIMEOUT_MS,
  isolatedTest,
  setupTestDatabase,
  teardownTestDatabase,
} from "./harness";

/**
 * Cross-tenant contracts for guessed ids.
 *
 * Public pages address content by slug plus a request id; dashboard services
 * take a product or workspace id that was already authorized. These tests pass
 * a real id from a second tenant into every one of those paths and assert that
 * it behaves like a missing row — no read, no mutation, no existence signal.
 */

const ORIGIN = "http://app.local";

let previous: Record<string, string | undefined> = {};

beforeAll(async () => {
  previous = {
    FLAG_PUBLIC_FEEDBACK: process.env.FLAG_PUBLIC_FEEDBACK,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
  };

  process.env.FLAG_PUBLIC_FEEDBACK = "on";
  process.env.BETTER_AUTH_URL = ORIGIN;
  process.env.BETTER_AUTH_SECRET = "integration-secret-value-at-least-32-chars";

  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

type Tenant = {
  workspace: Workspace;
  product: Product;
  board: Board;
};

async function tenant(options?: {
  guestPosting?: boolean;
  plan?: "free" | "pro";
  requireApproval?: "none" | "all";
}): Promise<Tenant> {
  const workspace = await createWorkspace({ plan: options?.plan ?? "pro" });
  const product = await createProduct(workspace.id);
  const board = await createBoard(product.id, {
    slug: uniqueLabel("board"),
    name: "Feedback",
    guestPosting: options?.guestPosting ?? true,
    ...(options?.requireApproval
      ? {
          settings: {
            moderation: {
              requireApproval: options.requireApproval,
              comments: "open" as const,
              blockSensitiveInfo: false,
            },
          },
        }
      : {}),
  });
  return { workspace, product, board };
}

function boardInput(t: Tenant) {
  return {
    workspaceSlug: t.workspace.slug,
    productSlug: t.product.slug,
    boardSlug: t.board.slug,
  };
}

function boardPath(t: Tenant): string {
  return `${ORIGIN}/api/public/boards/${t.workspace.slug}/${t.product.slug}/${t.board.slug}`;
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

function viewerFor(t: Tenant, customerId: string, identified = true): PublicViewer {
  return { customerId, workspaceId: t.workspace.id, identified, hasCompany: false };
}

function cookieHeader(cookieValue: string): string {
  return `${CUSTOMER_SESSION_COOKIE}=${cookieValue}`;
}

function readSessionCookie(response: Response): string {
  const header = response.headers.get("set-cookie") ?? "";
  const match = header.match(new RegExp(`${CUSTOMER_SESSION_COOKIE}=([^;]+)`));
  if (!match?.[1]) throw new Error(`Expected a session cookie, got "${header}".`);
  return match[1];
}

async function submitPublicRequest(t: Tenant, cookie?: string): Promise<Response> {
  const form = new FormData();
  form.set("title", "A cross-tenant submission attempt");
  form.set("body", "This request is sent with another workspace's cookie.");
  form.set("category", "feature_request");

  return submitRequest(
    new NextRequest(`${boardPath(t)}/requests`, {
      method: "POST",
      headers: {
        origin: ORIGIN,
        ...(cookie ? { cookie: cookieHeader(cookie) } : {}),
      },
      body: form,
    }),
    boardParams(t),
  );
}

async function publicWrite(
  handler: (
    request: NextRequest,
    context: ReturnType<typeof requestParams>,
  ) => Promise<Response>,
  t: Tenant,
  requestId: string,
  suffix: string,
  options: { method?: "POST" | "DELETE"; cookie?: string; body?: unknown } = {},
): Promise<Response> {
  const method = options.method ?? "POST";
  return handler(
    new NextRequest(`${boardPath(t)}/requests/${requestId}/${suffix}`, {
      method,
      headers: {
        origin: ORIGIN,
        ...(options.cookie ? { cookie: cookieHeader(options.cookie) } : {}),
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    }),
    requestParams(t, requestId),
  );
}

describe("cross-tenant reads", () => {
  isolatedTest("a guessed request id never resolves through another tenant's board", async () => {
    const a = await tenant();
    const b = await tenant({ requireApproval: "all" });
    const aCustomer = await createCustomer(a.workspace.id);
    const bPost = await createFeedbackPost({
      productId: b.product.id,
      boardId: b.board.id,
      title: "Tenant B secret rollout",
      body: "This request belongs to workspace B.",
    });
    await createModerationReview({
      productId: b.product.id,
      contentType: "feedback_post",
      contentId: bPost.id,
      status: "approved",
    });
    const pending = await createFeedbackPost({
      productId: b.product.id,
      boardId: b.board.id,
      title: "Tenant B pending request",
    });
    await createModerationReview({
      productId: b.product.id,
      contentType: "feedback_post",
      contentId: pending.id,
      status: "pending",
    });

    expect(
      await getPublicRequestPage(
        { ...boardInput(a), requestId: bPost.id },
        viewerFor(a, aCustomer.id),
      ),
    ).toBeNull();

    const aBoard = await getPublicBoardPage(
      boardInput(a),
      parsePublicBoardQuery({}),
    );
    expect(aBoard?.requests).toHaveLength(0);
    expect(JSON.stringify(aBoard)).not.toContain("Tenant B secret rollout");
    expect(await suggestPublicRequests(boardInput(a), "Tenant B secret rollout")).toEqual(
      [],
    );

    // A session from A is not a session in B: pending content stays invisible
    // and a public B request is shown to that visitor as anonymous.
    expect(
      await getPublicRequestPage(
        { ...boardInput(b), requestId: pending.id },
        viewerFor(a, aCustomer.id),
      ),
    ).toBeNull();

    const publicB = await getPublicRequestPage(
      { ...boardInput(b), requestId: bPost.id },
      viewerFor(a, aCustomer.id),
    );
    expect(publicB?.request.viewer).toEqual({
      hasSession: false,
      identified: false,
      isAuthor: false,
      hasVoted: false,
      follows: false,
      hasCompany: false,
    });

    const wrongBoard = await readBoardRoute(
      new NextRequest(`${ORIGIN}/api/public/boards/${a.workspace.slug}/${a.product.slug}/${b.board.slug}`),
      {
        params: Promise.resolve({
          workspaceSlug: a.workspace.slug,
          productSlug: a.product.slug,
          boardSlug: b.board.slug,
        }),
      },
    );
    expect(wrongBoard.status).toBe(404);
    expect(await wrongBoard.json()).toEqual({ error: "Board not found." });
  });

  isolatedTest("workspace and product lookups stay inside their authorized scope", async () => {
    const a = await tenant();
    const b = await tenant();
    const { user } = await createMember(a.workspace.id, { role: "owner" });
    const outsider = await createUser();

    expect(await findMembershipBySlug(b.workspace.slug, user.id)).toBeNull();
    expect(await findMembershipBySlug(a.workspace.slug, outsider.id)).toBeNull();
    expect(await findProductInWorkspace(a.workspace.id, b.product.slug)).toBeNull();
    expect(await findBoardForProduct(a.product.id, b.board.id)).toBeNull();

    expect((await listBoardsForProduct(a.product.id)).map((board) => board.id)).toEqual([
      a.board.id,
    ]);
    expect((await listWorkspacesForUser(user.id)).map((entry) => entry.workspace.id)).toEqual([
      a.workspace.id,
    ]);
  });
});

describe("cross-tenant public writes", () => {
  isolatedTest(
    "public engagement services treat a foreign request id as missing",
    async () => {
      const a = await tenant();
      const b = await tenant();
      const aBoard = await resolvePublicBoard(boardInput(a));
      if (!aBoard) throw new Error("The workspace A board did not resolve.");
      const aCustomer = await createCustomer(a.workspace.id);
      const bPost = await createFeedbackPost({
        productId: b.product.id,
        boardId: b.board.id,
        title: "Workspace B request",
      });

      expect(
        await setCustomerVote({
          tenant: aBoard,
          requestId: bPost.id,
          customerId: aCustomer.id,
          voted: true,
        }),
      ).toEqual({ ok: false, status: 404, error: "Request not found." });
      expect(
        await setCustomerFollow({
          tenant: aBoard,
          requestId: bPost.id,
          customerId: aCustomer.id,
          follows: true,
        }),
      ).toMatchObject({ ok: false, status: 404 });
      expect(
        await setCustomerReaction({
          tenant: aBoard,
          requestId: bPost.id,
          customerId: aCustomer.id,
          kind: "like",
          reacted: true,
        }),
      ).toMatchObject({ ok: false, status: 404 });
      expect(
        await addPublicComment({
          tenant: aBoard,
          requestId: bPost.id,
          customerId: aCustomer.id,
          customerName: null,
          body: "A comment from another workspace.",
        }),
      ).toMatchObject({ ok: false, status: 404 });

      expect(
        await db
          .select({ id: feedbackComments.id })
          .from(feedbackComments)
          .where(eq(feedbackComments.feedbackPostId, bPost.id)),
      ).toHaveLength(0);
      expect(
        await db
          .select({ id: feedbackCustomerVotes.id })
          .from(feedbackCustomerVotes)
          .where(eq(feedbackCustomerVotes.feedbackPostId, bPost.id)),
      ).toHaveLength(0);
    },
  );

  isolatedTest(
    "a cookie from one workspace cannot submit, vote, comment, follow or react on a board that requires an email",
    async () => {
      const a = await tenant();
      const b = await tenant({ guestPosting: false });
      const bAuthor = await createCustomer(b.workspace.id);
      const bPost = await createFeedbackPost({
        productId: b.product.id,
        boardId: b.board.id,
        title: "Workspace B request",
        authorCustomerId: bAuthor.id,
      });

      const guest = await createGuestCustomerSession(a.workspace.id);
      const identified = await identifyCustomer(guest.active, {
        email: `${uniqueLabel("a-member")}@example.test`,
        name: "Workspace A member",
      });
      if (!identified.ok) throw new Error("Could not identify the workspace A session.");
      const aCookie = identified.cookieValue;

      expect((await submitPublicRequest(b, aCookie)).status).toBe(401);
      expect(
        (
          await publicWrite(voteOnRequest, b, bPost.id, "vote", {
            cookie: aCookie,
          })
        ).status,
      ).toBe(401);
      expect(
        (
          await publicWrite(addComment, b, bPost.id, "comments", {
            cookie: aCookie,
            body: { body: "A comment from the wrong workspace." },
          })
        ).status,
      ).toBe(401);
      expect(
        (
          await publicWrite(followRequest, b, bPost.id, "follow", {
            cookie: aCookie,
          })
        ).status,
      ).toBe(401);
      expect(
        (
          await publicWrite(reactToRequest, b, bPost.id, "reactions", {
            cookie: aCookie,
            body: { kind: "like", reacted: true },
          })
        ).status,
      ).toBe(401);

      expect(
        await db
          .select({ id: feedbackPosts.id })
          .from(feedbackPosts)
          .where(eq(feedbackPosts.productId, b.product.id)),
      ).toHaveLength(1);
      expect(
        await db
          .select({ id: feedbackComments.id })
          .from(feedbackComments)
          .where(eq(feedbackComments.feedbackPostId, bPost.id)),
      ).toHaveLength(0);
      expect(
        await db
          .select({ id: feedbackCustomerVotes.id })
          .from(feedbackCustomerVotes)
          .where(eq(feedbackCustomerVotes.feedbackPostId, bPost.id)),
      ).toHaveLength(0);
      expect(
        await db
          .select({ id: feedbackFollowers.id })
          .from(feedbackFollowers)
          .where(eq(feedbackFollowers.feedbackPostId, bPost.id)),
      ).toHaveLength(0);
      expect(
        await db
          .select({ id: feedbackReactions.id })
          .from(feedbackReactions)
          .where(eq(feedbackReactions.feedbackPostId, bPost.id)),
      ).toHaveLength(0);

      // A failed attempt elsewhere must not invalidate the visitor's own session.
      expect((await findActiveCustomerSession(aCookie))?.session.workspaceId).toBe(
        a.workspace.id,
      );
    },
  );

  isolatedTest(
    "a guessed customer id in the body is ignored; the route uses the session it just minted",
    async () => {
      const a = await tenant();
      const b = await tenant();
      const bCustomer = await createCustomer(b.workspace.id);
      const bPost = await createFeedbackPost({
        productId: b.product.id,
        boardId: b.board.id,
        title: "Workspace B request",
        authorCustomerId: bCustomer.id,
      });

      const guest = await createGuestCustomerSession(a.workspace.id);
      const identified = await identifyCustomer(guest.active, {
        email: `${uniqueLabel("a-voter")}@example.test`,
        name: "Workspace A voter",
      });
      if (!identified.ok) throw new Error("Could not identify the workspace A session.");
      const aCookie = identified.cookieValue;

      const vote = await publicWrite(voteOnRequest, b, bPost.id, "vote", {
        cookie: aCookie,
        body: { customerId: bCustomer.id },
      });
      expect(vote.status).toBe(200);
      const bGuestCookie = readSessionCookie(vote);
      const bGuest = await findActiveCustomerSession(bGuestCookie);
      if (!bGuest) throw new Error("The B board did not mint a guest session.");
      expect(bGuest.session.workspaceId).toBe(b.workspace.id);
      expect(bGuest.customer.id).not.toBe(identified.active.customer.id);
      expect(bGuest.customer.id).not.toBe(bCustomer.id);

      const votes = await db
        .select({ customerId: feedbackCustomerVotes.customerId })
        .from(feedbackCustomerVotes)
        .where(eq(feedbackCustomerVotes.feedbackPostId, bPost.id));
      expect(votes).toEqual([{ customerId: bGuest.customer.id }]);

      const comment = await publicWrite(addComment, b, bPost.id, "comments", {
        cookie: bGuestCookie,
        body: { body: "A real B-board comment.", customerId: bCustomer.id },
      });
      expect(comment.status).toBe(201);

      const comments = await db
        .select({
          authorCustomerId: feedbackComments.authorCustomerId,
          body: feedbackComments.body,
        })
        .from(feedbackComments)
        .where(eq(feedbackComments.feedbackPostId, bPost.id));
      expect(comments).toEqual([
        { authorCustomerId: bGuest.customer.id, body: "A real B-board comment." },
      ]);

      // The original workspace A session is untouched by the B-board activity.
      expect((await findActiveCustomerSession(aCookie))?.session.workspaceId).toBe(
        a.workspace.id,
      );
    },
  );
});

describe("cross-tenant dashboard services", () => {
  isolatedTest("moderation and merge refuse content and reviews from another workspace", async () => {
    const a = await tenant();
    const b = await tenant();
    const aUser = await createUser();
    const aPost = await createFeedbackPost({
      productId: a.product.id,
      boardId: a.board.id,
      title: "Workspace A request",
    });
    const bPost = await createFeedbackPost({
      productId: b.product.id,
      boardId: b.board.id,
      title: "Workspace B request",
    });
    const bReview = await createModerationReview({
      productId: b.product.id,
      contentType: "feedback_post",
      contentId: bPost.id,
      status: "pending",
    });

    expect(
      await applyModerationAction({
        reviewId: bReview.id,
        productId: a.product.id,
        userId: aUser.id,
        action: "approve",
      }),
    ).toEqual({ ok: false, error: "That review no longer exists." });
    expect(
      (
        await db
          .select({ status: moderationReviews.status })
          .from(moderationReviews)
          .where(eq(moderationReviews.id, bReview.id))
      )[0]?.status,
    ).toBe("pending");

    expect(
      await mergeFeedbackRequests({
        productId: a.product.id,
        sourceId: bPost.id,
        targetId: aPost.id,
        userId: aUser.id,
      }),
    ).toEqual({ ok: false, error: "That feedback request no longer exists." });
    expect(
      await mergeFeedbackRequests({
        productId: a.product.id,
        sourceId: aPost.id,
        targetId: bPost.id,
        userId: aUser.id,
      }),
    ).toEqual({ ok: false, error: "That feedback request no longer exists." });

    const bTarget = await createFeedbackPost({
      productId: b.product.id,
      boardId: b.board.id,
      title: "Workspace B canonical",
    });
    const bSource = await createFeedbackPost({
      productId: b.product.id,
      boardId: b.board.id,
      title: "Workspace B duplicate",
    });
    const bMerge = await mergeFeedbackRequests({
      productId: b.product.id,
      sourceId: bSource.id,
      targetId: bTarget.id,
      userId: aUser.id,
    });
    expect(bMerge.ok).toBe(true);

    expect(
      await unmergeFeedbackRequest({
        productId: a.product.id,
        sourceId: bSource.id,
      }),
    ).toMatchObject({ ok: false });

    const unchanged = await db
      .select({ mergedIntoId: feedbackPosts.mergedIntoId })
      .from(feedbackPosts)
      .where(eq(feedbackPosts.id, bSource.id));
    expect(unchanged[0]?.mergedIntoId).toBe(bTarget.id);
  });

  isolatedTest("tags, bans, bulk triage and saved views are workspace-scoped", async () => {
    const a = await tenant();
    const b = await tenant();
    const aUser = await createUser();
    const bPost = await createFeedbackPost({
      productId: b.product.id,
      boardId: b.board.id,
      title: "Workspace B request",
    });
    const bCustomer = await createCustomer(b.workspace.id);

    await createBoardTag(b.board.id, b.product.id, { name: "b-only" });
    const tagRows = await db
      .select({ id: boardTags.id })
      .from(boardTags)
      .where(eq(boardTags.boardId, b.board.id));
    const bTagId = tagRows[0]?.id;
    if (!bTagId) throw new Error("The workspace B tag was not created.");

    expect(
      await createTag({
        productId: a.product.id,
        boardId: b.board.id,
        name: "cross-tenant",
        color: null,
      }),
    ).toMatchObject({ ok: false });
    expect(
      await deleteTag({ productId: a.product.id, tagId: bTagId }),
    ).toMatchObject({ ok: false });
    expect(
      await replacePostTags({
        productId: a.product.id,
        postId: bPost.id,
        tagIds: [bTagId],
      }),
    ).toMatchObject({ ok: false });
    expect(
      await db
        .select({ tagId: feedbackTagLinks.tagId })
        .from(feedbackTagLinks)
        .where(eq(feedbackTagLinks.feedbackPostId, bPost.id)),
    ).toHaveLength(0);

    expect(
      await setCustomerBan({
        workspaceId: a.workspace.id,
        customerId: bCustomer.id,
        banned: true,
      }),
    ).toMatchObject({ ok: false });
    expect(
      (
        await db
          .select({ bannedAt: customers.bannedAt })
          .from(customers)
          .where(eq(customers.id, bCustomer.id))
      )[0]?.bannedAt,
    ).toBeNull();

    expect(
      await bulkUpdateFeedbackStatuses({
        productId: a.product.id,
        postIds: [bPost.id],
        status: "planned",
      }),
    ).toEqual({ updated: 0, skipped: 1 });
    expect(
      (
        await db
          .select({ status: feedbackPosts.status })
          .from(feedbackPosts)
          .where(eq(feedbackPosts.id, bPost.id))
      )[0]?.status,
    ).toBe("open");

    expect(
      await bulkSetFeedbackHidden({
        productId: a.product.id,
        postIds: [bPost.id],
        hidden: true,
        hiddenBy: aUser.id,
      }),
    ).toEqual({ updated: 0 });
    expect(
      (
        await db
          .select({ hiddenAt: feedbackPosts.hiddenAt })
          .from(feedbackPosts)
          .where(eq(feedbackPosts.id, bPost.id))
      )[0]?.hiddenAt,
    ).toBeNull();

    const bView = await saveFeedbackView({
      productId: b.product.id,
      userId: aUser.id,
      name: "Workspace B view",
      filters: { search: "", status: "all", category: "all", sort: "newest" },
    });
    expect(
      await deleteFeedbackView({
        productId: a.product.id,
        userId: aUser.id,
        viewId: bView.id,
      }),
    ).toBe(false);
    expect(
      await db
        .select({ id: feedbackSavedViews.id })
        .from(feedbackSavedViews)
        .where(eq(feedbackSavedViews.id, bView.id)),
    ).toHaveLength(1);
  });
});

/**
 * Fuzz: a deterministic stream of ids from another workspace (and ids that
 * exist nowhere) into every addressed route.
 *
 * The fixed cases above document individual services. This block exists to
 * stop a *new* route from being added without the same treatment: the API
 * manifest is walked, every path parameter is replaced with a foreign id, and
 * the answer must be the same as a missing row. A 2xx, or a body quoting the
 * other tenant's content, fails the test.
 */
function deterministic(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
}

describe("cross-tenant fuzz", () => {
  isolatedTest(
    "foreign and nonexistent ids never resolve on any addressed API route",
    async () => {
      const previousApi = process.env.FLAG_API;
      process.env.FLAG_API = "on";
      try {
        const a = await tenant();
        const b = await tenant();
        const aCustomer = await createCustomer(a.workspace.id);
        const bCustomer = await createCustomer(b.workspace.id);
        const bPost = await createFeedbackPost({
          productId: b.product.id,
          boardId: b.board.id,
          title: "Tenant B fuzz secret",
          authorCustomerId: bCustomer.id,
        });
        const bConversation = await createConversation({
          workspaceId: b.workspace.id,
          productId: b.product.id,
          customerId: bCustomer.id,
          subject: "Tenant B fuzz thread",
        });
        const { user } = await createMember(a.workspace.id, { role: "owner" });

        const material = createApiTokenMaterial();
        const tokenRows = await db
          .insert(apiTokens)
          .values({
            workspaceId: a.workspace.id,
            name: "Fuzz token",
            tokenHash: material.tokenHash,
            prefix: material.prefix,
            scopes: ["read", "write"],
            createdBy: user.id,
          })
          .returning({ id: apiTokens.id });
        if (!tokenRows[0]) throw new Error("Token insert returned no row.");

        const random = deterministic(0x5eed);
        const foreignIds = [
          bPost.id,
          b.board.id,
          b.product.id,
          b.workspace.id,
          bCustomer.id,
          bConversation.id,
          randomUUID(),
          randomUUID(),
        ];
        const pick = () => foreignIds[Math.floor(random() * foreignIds.length)] ?? randomUUID();

        const failures: string[] = [];

        for (const definition of API_ROUTE_DEFINITIONS) {
          if (!definition.path.includes("{")) continue;
          if (definition.method !== "GET" && definition.method !== "PATCH") continue;

          const path = definition.path.replace(/\{[^}]+\}/g, () => pick());
          const request = new NextRequest(new URL(`http://localhost/api/v1${path}`), {
            method: definition.method,
            headers: {
              authorization: `Bearer ${material.token}`,
              ...(definition.method === "PATCH"
                ? { "content-type": "application/json" }
                : {}),
            },
            ...(definition.method === "PATCH" ? { body: "{}" } : {}),
          });

          const response = await handleApiRequest(request, {
            params: Promise.resolve({
              segments: path.replace(/^\//, "").split("/").filter(Boolean),
            }),
          });
          const text = await response.text();

          if (response.status === 200) {
            failures.push(`200 ${definition.method} ${path}`);
          }
          if (text.includes("Tenant B fuzz")) {
            failures.push(`leak ${definition.method} ${path}`);
          }
        }

        // A write that names a foreign board must fail exactly like a missing
        // board; it must not fall back to the caller's first board.
        const create = await handleApiRequest(
          new NextRequest(new URL("http://localhost/api/v1/requests"), {
            method: "POST",
            headers: {
              authorization: `Bearer ${material.token}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              board_id: b.board.id,
              title: "Fuzz write into tenant B",
              body: "This must not be created.",
            }),
          }),
          { params: Promise.resolve({ segments: ["requests"] }) },
        );
        expect(create.status).toBe(404);

        // The public read path agrees: the id is missing on A's board.
        const board = await resolvePublicBoard(boardInput(a));
        if (!board) throw new Error("The workspace A board did not resolve.");
        expect(
          await getPublicRequestPage(
            { ...boardInput(a), requestId: bPost.id },
            viewerFor(a, aCustomer.id),
          ),
        ).toBeNull();

        const created = await db
          .select({ id: feedbackPosts.id })
          .from(feedbackPosts)
          .where(eq(feedbackPosts.title, "Fuzz write into tenant B"));
        expect(created).toHaveLength(0);

        expect(failures).toEqual([]);
      } finally {
        if (previousApi === undefined) delete process.env.FLAG_API;
        else process.env.FLAG_API = previousApi;
      }
    },
    120_000,
  );
});
