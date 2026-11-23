import { afterAll, beforeAll, describe, expect } from "bun:test";
import { NextRequest } from "next/server";
import { count, eq } from "drizzle-orm";

import { POST as createSession } from "@/app/api/public/session/route";
import { POST as identifyWidget } from "@/app/api/widget/identify/route";
import { db } from "@/db";
import { customerSessions } from "@/db/schema";
import { getPublicChangelogEntry } from "@/features/public/changelog";
import {
  getPublicBoardPage,
  getPublicRequestPage,
} from "@/features/public/queries";
import { getPublicRoadmapPage } from "@/features/public/roadmap";
import {
  loadWidgetShell,
  resolveWidgetTenant,
  widgetBoardSlug,
} from "@/features/widget/service";
import { getServerEnv } from "@/lib/env";

import {
  createBoard,
  createFeedbackPost,
  createModerationReview,
  createProduct,
  createRelease,
  createReleaseFeedbackLink,
  createWorkspace,
} from "./factories";
import {
  SETUP_TIMEOUT_MS,
  isolatedTest,
  setupTestDatabase,
  teardownTestDatabase,
} from "./harness";

/**
 * The W3 projection gate.
 *
 * The embed route has no widget-only data source: the bootstrap resolves a
 * tenant and the panels consume the same public DTOs as the full site. This
 * suite seeds one row per exclusion — hidden, merged, pending, rejected,
 * private board — and reads the exact functions the iframe calls, so a panel
 * cannot start showing content the public pages hide.
 *
 * The second half proves the other direction: a workspace with no public
 * surface never issues a customer session, through either the public bootstrap
 * or the widget identity handshake.
 */

const EXCLUDED = "WIDGET-EXCLUDED";

let previous: Record<string, string | undefined> = {};
let origin: string;

beforeAll(async () => {
  previous = {
    FLAG_PUBLIC_FEEDBACK: process.env.FLAG_PUBLIC_FEEDBACK,
    FLAG_WIDGET: process.env.FLAG_WIDGET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
  };

  process.env.FLAG_PUBLIC_FEEDBACK = "on";
  process.env.FLAG_WIDGET = "on";
  process.env.BETTER_AUTH_URL ??= "http://app.local";
  process.env.BETTER_AUTH_SECRET ??= "integration-secret-value-at-least-32-chars";

  await setupTestDatabase();
  // The same source the origin check reads, so a loaded .env cannot make the
  // request look cross-site.
  origin = new URL(getServerEnv().BETTER_AUTH_URL).origin;
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

function sessionRequest(workspaceSlug: string): NextRequest {
  return new NextRequest("http://app.local/api/public/session", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ workspaceSlug }),
  });
}

function identifyRequest(workspaceSlug: string): NextRequest {
  return new NextRequest("http://app.local/api/widget/identify", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ workspaceSlug, token: "not-a-token" }),
  });
}

describe("widget projections", () => {
  isolatedTest("the bootstrap and panels never expose non-public requests", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id, {
      publicFeedbackEnabled: true,
      publicRoadmapEnabled: true,
      publicChangelogEnabled: true,
    });
    const board = await createBoard(product.id, {
      name: "Feedback",
      slug: "feedback",
      position: 0,
    });
    const moderated = await createBoard(product.id, {
      name: "Moderated",
      slug: "moderated",
      position: 1,
      settings: {
        moderation: {
          requireApproval: "all",
          comments: "moderated",
          blockSensitiveInfo: false,
        },
      },
    });
    const privateBoard = await createBoard(product.id, {
      name: "Private",
      slug: "private",
      position: -1,
      visibility: "private",
    });

    const visible = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: `${EXCLUDED} visible`,
      body: "Public request.",
      status: "planned",
    });
    const approved = await createFeedbackPost({
      productId: product.id,
      boardId: moderated.id,
      title: `${EXCLUDED} approved`,
      status: "planned",
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
      title: `${EXCLUDED} hidden`,
      status: "planned",
      hiddenAt: new Date(),
    });
    const merged = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: `${EXCLUDED} merged`,
      status: "planned",
      mergedIntoId: visible.id,
    });
    const pending = await createFeedbackPost({
      productId: product.id,
      boardId: moderated.id,
      title: `${EXCLUDED} pending`,
      status: "planned",
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
      title: `${EXCLUDED} rejected`,
      status: "planned",
    });
    await createModerationReview({
      productId: product.id,
      contentType: "feedback_post",
      contentId: rejected.id,
      status: "rejected",
    });
    const privateRequest = await createFeedbackPost({
      productId: product.id,
      boardId: privateBoard.id,
      title: `${EXCLUDED} private board`,
      status: "planned",
    });

    // The bootstrap resolves the first public board and ignores the private
    // one even though it sorts first.
    const tenant = await resolveWidgetTenant({
      workspaceSlug: workspace.slug,
      productSlug: product.slug,
    });
    expect(tenant?.boardSlug).toBe(board.slug);
    expect(tenant && (await widgetBoardSlug(tenant, "private"))).toBeNull();

    const shell = await loadWidgetShell({
      workspaceSlug: workspace.slug,
      productSlug: product.slug,
      viewer: null,
    });
    expect(shell).not.toBeNull();
    if (!shell) return;
    expect(shell.boardSlug).toBe(board.slug);
    expect(shell.panels).toEqual({
      help: true,
      feedback: true,
      roadmap: true,
      updates: true,
      messages: true,
      notifications: true,
    });
    expect(shell.unread).toBe(0);

    const boardPage = await getPublicBoardPage({
      workspaceSlug: workspace.slug,
      productSlug: product.slug,
      boardSlug: board.slug,
    });
    expect(boardPage?.requests.map((request) => request.id)).toEqual([visible.id]);

    // The excluded rows are not addressable by their own URLs either.
    for (const request of [hidden, merged, pending, rejected]) {
      const boardSlug =
        request.boardId === moderated.id ? moderated.slug : board.slug;
      expect(
        await getPublicRequestPage({
          workspaceSlug: workspace.slug,
          productSlug: product.slug,
          boardSlug,
          requestId: request.id,
        }),
      ).toBeNull();
    }
    expect(
      await getPublicRequestPage({
        workspaceSlug: workspace.slug,
        productSlug: product.slug,
        boardSlug: privateBoard.slug,
        requestId: privateRequest.id,
      }),
    ).toBeNull();

    const roadmap = await getPublicRoadmapPage({
      workspaceSlug: workspace.slug,
      productSlug: product.slug,
    });
    expect(
      roadmap?.columns[0]?.requests.map((request) => request.id).sort(),
    ).toEqual([visible.id, approved.id].sort());

    const release = await createRelease({
      productId: product.id,
      title: "Widget update",
      slug: "widget-update",
    });
    for (const request of [
      visible,
      approved,
      hidden,
      merged,
      pending,
      rejected,
      privateRequest,
    ]) {
      await createReleaseFeedbackLink({
        productId: product.id,
        releaseId: release.id,
        feedbackPostId: request.id,
      });
    }

    const entry = await getPublicChangelogEntry(
      {
        workspaceSlug: workspace.slug,
        productSlug: product.slug,
        slug: release.slug,
      },
      null,
    );
    expect(
      entry?.entry.linkedRequests.map((request) => request.id).sort(),
    ).toEqual([visible.id, approved.id].sort());

    // Nothing the iframe can render carries an excluded row's title.
    const payload = JSON.stringify({ shell, boardPage, roadmap, entry });
    expect(payload).not.toContain(`${EXCLUDED} hidden`);
    expect(payload).not.toContain(`${EXCLUDED} merged`);
    expect(payload).not.toContain(`${EXCLUDED} pending`);
    expect(payload).not.toContain(`${EXCLUDED} rejected`);
    expect(payload).not.toContain(`${EXCLUDED} private board`);
    expect(payload).toContain(`${EXCLUDED} visible`);
  });

  isolatedTest("a private-only workspace never gets a customer session", async () => {
    const offFlags = await createWorkspace();
    const offProduct = await createProduct(offFlags.id, {
      publicFeedbackEnabled: false,
      publicRoadmapEnabled: false,
      publicChangelogEnabled: false,
    });
    await createBoard(offProduct.id, { slug: "feedback" });

    const privateBoards = await createWorkspace();
    const privateProduct = await createProduct(privateBoards.id, {
      publicFeedbackEnabled: true,
    });
    await createBoard(privateProduct.id, { slug: "private", visibility: "private" });
    await createBoard(privateProduct.id, {
      slug: "retired",
      archivedAt: new Date(),
    });

    // Every public surface is off: no bootstrap at all.
    expect(
      await resolveWidgetTenant({
        workspaceSlug: offFlags.slug,
        productSlug: offProduct.slug,
      }),
    ).toBeNull();
    expect(
      await loadWidgetShell({
        workspaceSlug: offFlags.slug,
        productSlug: offProduct.slug,
        viewer: null,
      }),
    ).toBeNull();

    // Feedback is switched on, but every board is private or archived. The
    // bootstrap resolves the product with no board and no feedback tab, and
    // still cannot create a session for it.
    const tenant = await resolveWidgetTenant({
      workspaceSlug: privateBoards.slug,
      productSlug: privateProduct.slug,
    });
    expect(tenant).not.toBeNull();
    if (!tenant) return;

    expect(tenant.boardSlug).toBeNull();
    expect(await widgetBoardSlug(tenant, null)).toBeNull();

    const shell = await loadWidgetShell({
      workspaceSlug: privateBoards.slug,
      productSlug: privateProduct.slug,
      viewer: null,
    });
    expect(shell?.boardSlug).toBeNull();
    expect(shell?.panels.feedback).toBe(false);
    expect(shell?.panels.roadmap).toBe(false);
    expect(shell?.panels.updates).toBe(false);
    expect(shell?.unread).toBe(0);

    for (const workspace of [offFlags, privateBoards]) {
      const session = await createSession(sessionRequest(workspace.slug));
      expect(session.status).toBe(404);
      expect(session.headers.getSetCookie()).toHaveLength(0);

      const identify = await identifyWidget(identifyRequest(workspace.slug));
      expect(identify.status).toBe(404);
      expect(identify.headers.getSetCookie()).toHaveLength(0);

      const rows = await db
        .select({ value: count() })
        .from(customerSessions)
        .where(eq(customerSessions.workspaceId, workspace.id));
      expect(rows[0]?.value ?? 0).toBe(0);
    }
  });
});
