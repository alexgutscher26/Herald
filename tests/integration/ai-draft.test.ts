import { afterAll, beforeAll, describe, expect } from "bun:test";

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import {
  inAppNotifications,
  notificationDeliveries,
  releaseFeedbackLinks,
  releases,
} from "@/db/schema";
import { authorsForReleases, tagsForReleases } from "@/db/queries/releases";
import {
  createAiDraft,
  listAiDraftCandidates,
  loadAiDraftRequests,
  rewriteAiDraft,
} from "@/features/releases/ai-draft";

import {
  createBoard,
  createFeedbackPost,
  createMember,
  createProduct,
  createRelease,
  createWorkspace,
} from "./factories";
import {
  SETUP_TIMEOUT_MS,
  isolatedTest,
  setupTestDatabase,
  teardownTestDatabase,
} from "./harness";

/**
 * AI drafts use a real local OpenAI-compatible server. The test proves the
 * selected requests are the only source, that hidden/private requests never
 * enter the prompt, and that the result is written as a private draft with no
 * notification or publication side effects.
 */

let server: Server | null = null;
let previousUrl: string | undefined;
let previousKey: string | undefined;
let previousModel: string | undefined;
const capturedBodies: unknown[] = [];

beforeAll(async () => {
  await setupTestDatabase();

  server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    try {
      capturedBodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown);
    } catch {
      capturedBodies.push(null);
    }

    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: "Faster search for everyone",
                summary:
                  "Search now matches partial words and ranks recent results first.",
                body: "### What changed\n\n- Search matches partial words.\n- Recent results rank first.",
                category: "improvement",
                tags: ["search", "speed"],
              }),
            },
          },
        ],
      }),
    );
  });

  await new Promise<void>((resolve) => {
    server?.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo | null;
  if (!address) throw new Error("The test AI server did not expose a port.");

  previousUrl = process.env.AI_API_URL;
  previousKey = process.env.AI_API_KEY;
  previousModel = process.env.AI_MODEL;
  process.env.AI_API_URL = `http://127.0.0.1:${address.port}/v1`;
  process.env.AI_API_KEY = "test-key";
  process.env.AI_MODEL = "test-model";
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  if (previousUrl === undefined) delete process.env.AI_API_URL;
  else process.env.AI_API_URL = previousUrl;
  if (previousKey === undefined) delete process.env.AI_API_KEY;
  else process.env.AI_API_KEY = previousKey;
  if (previousModel === undefined) delete process.env.AI_MODEL;
  else process.env.AI_MODEL = previousModel;

  await new Promise<void>((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
  });
  server = null;

  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

describe("AI changelog drafts", () => {
  isolatedTest("creates a private draft from visible shipped requests only", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const product = await createProduct(workspace.id, {
      name: "Herald",
      description: "Customer feedback and changelogs.",
    });
    const board = await createBoard(product.id, { name: "Feedback" });
    const privateBoard = await createBoard(product.id, {
      name: "Private ideas",
      visibility: "private",
    });
    const { user } = await createMember(workspace.id, { role: "owner" });

    const visible = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: "Faster search",
      body: "Search should match partial words and rank recent results first.",
      status: "shipped",
    });
    const hidden = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: "Hidden secret project",
      body: "This must never reach the prompt.",
      status: "shipped",
      hiddenAt: new Date(),
    });
    const privateRequest = await createFeedbackPost({
      productId: product.id,
      boardId: privateBoard.id,
      title: "Private roadmap bet",
      body: "This is not public.",
      status: "shipped",
    });

    const candidates = await listAiDraftCandidates(product.id);
    expect(candidates.map((candidate) => candidate.id)).toEqual([visible.id]);
    expect(await loadAiDraftRequests(product.id, [visible.id])).not.toBeNull();
    expect(await loadAiDraftRequests(product.id, [hidden.id])).toBeNull();
    expect(await loadAiDraftRequests(product.id, [privateRequest.id])).toBeNull();

    const before = capturedBodies.length;
    const result = await createAiDraft(
      {
        workspaceId: workspace.id,
        productId: product.id,
        userId: user.id,
        productName: product.name,
        productDescription: product.description ?? "",
      },
      { feedbackIds: [visible.id], focus: "Lead with speed." },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(capturedBodies).toHaveLength(before + 1);
    const prompt = JSON.stringify(capturedBodies.at(-1));
    expect(prompt).toContain("Faster search");
    expect(prompt).toContain("Lead with speed.");
    expect(prompt).not.toContain("Hidden secret project");
    expect(prompt).not.toContain("Private roadmap bet");

    const rows = await db
      .select()
      .from(releases)
      .where(eq(releases.id, result.releaseId));
    const release = rows[0];
    expect(release).toBeDefined();
    expect(release).toMatchObject({
      status: "draft",
      title: "Faster search for everyone",
      summary: "Search now matches partial words and ranks recent results first.",
      category: "improvement",
    });
    expect(release?.publishedAt).toBeNull();
    expect(release?.scheduledFor).toBeNull();
    expect(release?.bodyMarkdown).toContain("Search matches partial words.");

    const links = await db
      .select({ feedbackPostId: releaseFeedbackLinks.feedbackPostId })
      .from(releaseFeedbackLinks)
      .where(eq(releaseFeedbackLinks.releaseId, result.releaseId));
    expect(links).toEqual([{ feedbackPostId: visible.id }]);

    expect((await tagsForReleases([result.releaseId])).get(result.releaseId)).toEqual([
      "search",
      "speed",
    ]);
    expect(
      (await authorsForReleases([result.releaseId])).get(result.releaseId)?.map(
        (author) => author.id,
      ),
    ).toEqual([user.id]);

    // The write path is draft-only: no delivery, in-app notification or
    // publication timestamp is created.
    expect(
      await db
        .select({ id: notificationDeliveries.id })
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.releaseId, result.releaseId)),
    ).toHaveLength(0);
    expect(
      await db
        .select({ id: inAppNotifications.id })
        .from(inAppNotifications)
        .where(eq(inAppNotifications.releaseId, result.releaseId)),
    ).toHaveLength(0);
  });

  isolatedTest("rewrites an existing draft in place and keeps its uploaded image", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const product = await createProduct(workspace.id, {
      name: "Herald",
      description: "Customer feedback and changelogs.",
    });
    const board = await createBoard(product.id);
    const { user } = await createMember(workspace.id, { role: "owner" });

    const source = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: "Faster search",
      body: "Search should match partial words and rank recent results first.",
      status: "shipped",
    });
    const hidden = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: "Hidden secret project",
      body: "This must never reach the prompt.",
      status: "shipped",
      hiddenAt: new Date(),
    });

    const image =
      "![Search results](/api/release-images/workspaces/11111111-1111-4111-8111-111111111111/products/22222222-2222-4222-8222-222222222222/image/33333333-3333-4333-8333-333333333333.png)";
    const release = await createRelease({
      productId: product.id,
      title: "Search update",
      slug: "search-update",
      summary: "A small search update for customers.",
      body: `### What changed\n\n${image}\n\n- Search works.`,
      status: "draft",
      authorIds: [user.id],
      tagNames: ["search"],
    });
    await db.insert(releaseFeedbackLinks).values([
      { productId: product.id, releaseId: release.id, feedbackPostId: source.id },
      { productId: product.id, releaseId: release.id, feedbackPostId: hidden.id },
    ]);

    const before = capturedBodies.length;
    const result = await rewriteAiDraft(
      {
        workspaceId: workspace.id,
        productId: product.id,
        userId: user.id,
        productName: product.name,
        productDescription: product.description ?? "",
      },
      { releaseId: release.id, focus: "Tighten the copy." },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.releaseId).toBe(release.id);
    expect(capturedBodies).toHaveLength(before + 1);

    const prompt = JSON.stringify(capturedBodies.at(-1));
    expect(prompt).toContain("Search update");
    expect(prompt).toContain("Faster search");
    expect(prompt).toContain("Tighten the copy.");
    expect(prompt).toContain("/api/release-images/");
    expect(prompt).not.toContain("Hidden secret project");

    const rows = await db
      .select()
      .from(releases)
      .where(eq(releases.id, release.id));
    expect(rows[0]).toMatchObject({
      status: "draft",
      title: "Faster search for everyone",
      slug: "search-update",
      category: "improvement",
    });
    expect(rows[0]?.bodyMarkdown).toContain("Search matches partial words.");
    expect(rows[0]?.bodyMarkdown).toContain("/api/release-images/");
    expect(rows[0]?.publishedAt).toBeNull();
    expect(rows[0]?.scheduledFor).toBeNull();

    const links = await db
      .select({ feedbackPostId: releaseFeedbackLinks.feedbackPostId })
      .from(releaseFeedbackLinks)
      .where(eq(releaseFeedbackLinks.releaseId, release.id));
    expect(links.map((link) => link.feedbackPostId).sort()).toEqual(
      [source.id, hidden.id].sort(),
    );

    expect(
      await db
        .select({ id: notificationDeliveries.id })
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.releaseId, release.id)),
    ).toHaveLength(0);
  });

  isolatedTest("refuses to rewrite a release that is no longer a draft", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const product = await createProduct(workspace.id);
    const { user } = await createMember(workspace.id, { role: "owner" });
    const published = await createRelease({
      productId: product.id,
      status: "published",
      title: "Already live",
    });

    const result = await rewriteAiDraft(
      {
        workspaceId: workspace.id,
        productId: product.id,
        userId: user.id,
        productName: product.name,
        productDescription: "",
      },
      { releaseId: published.id, focus: "" },
    );
    expect(result).toMatchObject({ ok: false, status: 409 });
  });

  isolatedTest("refuses a request that is not shipped or not in this product", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const product = await createProduct(workspace.id);
    const other = await createProduct(workspace.id);
    const board = await createBoard(product.id);
    const otherBoard = await createBoard(other.id);
    const { user } = await createMember(workspace.id, { role: "owner" });

    const open = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      status: "open",
    });
    const foreign = await createFeedbackPost({
      productId: other.id,
      boardId: otherBoard.id,
      status: "shipped",
    });

    const context = {
      workspaceId: workspace.id,
      productId: product.id,
      userId: user.id,
      productName: product.name,
      productDescription: "",
    };

    const notShipped = await createAiDraft(
      context,
      { feedbackIds: [open.id], focus: "" },
    );
    expect(notShipped).toMatchObject({ ok: false, status: 400 });

    const crossProduct = await createAiDraft(
      context,
      { feedbackIds: [foreign.id], focus: "" },
    );
    expect(crossProduct).toMatchObject({ ok: false, status: 400 });

    expect(
      await db
        .select({ id: releases.id })
        .from(releases)
        .where(eq(releases.productId, product.id)),
    ).toHaveLength(0);
  });
});
