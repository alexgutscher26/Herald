import { afterAll, beforeAll, describe, expect } from "bun:test";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { releaseFeedbackLinks, releases } from "@/db/schema";
import { authorsForReleases, tagsForReleases } from "@/db/queries/releases";
import {
  createReleaseDraft,
  updateReleaseDraft,
} from "@/features/releases/draft-service";

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
 * The changelog API can only write drafts. These cases prove the draft create
 * and partial update semantics, tenant scoping, and that a published release is
 * never mutable through this path.
 */

beforeAll(async () => {
  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

describe("changelog draft API service", () => {
  isolatedTest("creates a complete draft with tags, authors and request links", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const product = await createProduct(workspace.id);
    const board = await createBoard(product.id);
    const { user } = await createMember(workspace.id, { role: "owner" });
    const request = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: "A shipped request",
      status: "shipped",
    });

    const result = await createReleaseDraft(
      { workspaceId: workspace.id, productId: product.id, userId: user.id },
      {
        title: "A new changelog entry",
        slug: "a-new-changelog-entry",
        summary: "An API-created draft.",
        body: "### What changed\n\nA complete draft body.",
        category: "improvement",
        tags: ["api", "changelog"],
        authorIds: [user.id],
        linkedFeedbackIds: [request.id],
        channels: { publicChangelog: true, inAppWidget: false, subscriberEmail: false },
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = await db
      .select()
      .from(releases)
      .where(eq(releases.id, result.releaseId));
    const release = rows[0];
    expect(release).toMatchObject({
      status: "draft",
      title: "A new changelog entry",
      slug: "a-new-changelog-entry",
      summary: "An API-created draft.",
      category: "improvement",
      channelPublicChangelog: true,
      channelInAppWidget: false,
      channelSubscriberEmail: false,
    });
    expect(release?.publishedAt).toBeNull();
    expect(release?.scheduledFor).toBeNull();

    expect(
      await db
        .select({ feedbackPostId: releaseFeedbackLinks.feedbackPostId })
        .from(releaseFeedbackLinks)
        .where(eq(releaseFeedbackLinks.releaseId, result.releaseId)),
    ).toEqual([{ feedbackPostId: request.id }]);
    expect((await tagsForReleases([result.releaseId])).get(result.releaseId)).toEqual([
      "api",
      "changelog",
    ]);
    expect(
      (await authorsForReleases([result.releaseId])).get(result.releaseId)?.map(
        (author) => author.id,
      ),
    ).toEqual([user.id]);
  });

  isolatedTest("updates only the supplied fields and preserves the rest", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const board = await createBoard(product.id);
    const { user } = await createMember(workspace.id, { role: "editor" });
    const request = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      status: "shipped",
    });

    const created = await createReleaseDraft(
      { workspaceId: workspace.id, productId: product.id, userId: user.id },
      {
        title: "Original title",
        slug: "original-title",
        summary: "Original summary.",
        body: "### Original\n\nOriginal body.",
        tags: ["api"],
        authorIds: [user.id],
        linkedFeedbackIds: [request.id],
      },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const updated = await updateReleaseDraft(
      { workspaceId: workspace.id, productId: product.id, userId: user.id },
      created.releaseId,
      { title: "Updated title", slug: "updated-title", tags: ["api", "launch"] },
    );
    expect(updated.ok).toBe(true);

    const rows = await db
      .select()
      .from(releases)
      .where(eq(releases.id, created.releaseId));
    expect(rows[0]).toMatchObject({
      title: "Updated title",
      slug: "updated-title",
      summary: "Original summary.",
      status: "draft",
    });
    expect(rows[0]?.bodyMarkdown).toContain("Original body.");
    expect((await tagsForReleases([created.releaseId])).get(created.releaseId)).toEqual([
      "api",
      "launch",
    ]);
    expect(
      (await authorsForReleases([created.releaseId])).get(created.releaseId)?.map(
        (author) => author.id,
      ),
    ).toEqual([user.id]);
    expect(
      await db
        .select({ feedbackPostId: releaseFeedbackLinks.feedbackPostId })
        .from(releaseFeedbackLinks)
        .where(eq(releaseFeedbackLinks.releaseId, created.releaseId)),
    ).toEqual([{ feedbackPostId: request.id }]);
  });

  isolatedTest("clears links and tags only when the caller asks", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const board = await createBoard(product.id);
    const { user } = await createMember(workspace.id, { role: "owner" });
    const request = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      status: "shipped",
    });

    const created = await createReleaseDraft(
      { workspaceId: workspace.id, productId: product.id, userId: user.id },
      {
        title: "Clearable draft",
        slug: "clearable-draft",
        tags: ["keep"],
        linkedFeedbackIds: [request.id],
      },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const cleared = await updateReleaseDraft(
      { workspaceId: workspace.id, productId: product.id, userId: user.id },
      created.releaseId,
      { tags: [], linkedFeedbackIds: [] },
    );
    expect(cleared.ok).toBe(true);

    expect(await tagsForReleases([created.releaseId])).toEqual(new Map());
    expect(
      await db
        .select({ feedbackPostId: releaseFeedbackLinks.feedbackPostId })
        .from(releaseFeedbackLinks)
        .where(eq(releaseFeedbackLinks.releaseId, created.releaseId)),
    ).toHaveLength(0);
  });

  isolatedTest("refuses published releases and another product's draft", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const other = await createProduct(workspace.id);
    const { user } = await createMember(workspace.id, { role: "owner" });

    const published = await createRelease({
      productId: product.id,
      status: "published",
    });
    const foreignDraft = await createRelease({
      productId: other.id,
      status: "draft",
    });

    expect(
      await updateReleaseDraft(
        { workspaceId: workspace.id, productId: product.id, userId: user.id },
        published.id,
        { title: "Nope" },
      ),
    ).toMatchObject({ ok: false, status: 409 });

    expect(
      await updateReleaseDraft(
        { workspaceId: workspace.id, productId: product.id, userId: user.id },
        foreignDraft.id,
        { title: "Nope" },
      ),
    ).toMatchObject({ ok: false, status: 404 });
  });

  isolatedTest("rejects a slug conflict and a request from another product", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const other = await createProduct(workspace.id);
    const otherBoard = await createBoard(other.id);
    const { user } = await createMember(workspace.id, { role: "owner" });

    await createRelease({
      productId: product.id,
      slug: "taken-slug",
      status: "draft",
    });
    const foreignRequest = await createFeedbackPost({
      productId: other.id,
      boardId: otherBoard.id,
      status: "shipped",
    });

    const context = { workspaceId: workspace.id, productId: product.id, userId: user.id };

    expect(
      await createReleaseDraft(context, {
        title: "A conflicting draft",
        slug: "taken-slug",
      }),
    ).toMatchObject({ ok: false, status: 409 });

    expect(
      await createReleaseDraft(context, {
        title: "A cross-product draft",
        slug: "a-cross-product-draft",
        linkedFeedbackIds: [foreignRequest.id],
      }),
    ).toMatchObject({ ok: false, status: 400 });

    expect(
      await db
        .select({ id: releases.id })
        .from(releases)
        .where(eq(releases.productId, product.id)),
    ).toHaveLength(1);
  });
});
