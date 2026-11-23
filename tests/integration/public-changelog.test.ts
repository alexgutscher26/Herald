import { afterAll, beforeAll, describe, expect } from "bun:test";

import { GET as getRss } from "@/app/p/[workspaceSlug]/[productSlug]/updates/rss.xml/route";
import {
  getPublicChangelogEntry,
  getPublicChangelogPage,
  listPublicChangelogEntries,
} from "@/features/public/changelog";
import { listPublicSitemapEntries } from "@/features/public/queries";

import {
  createBoard,
  createCustomer,
  createFeedbackPost,
  createModerationReview,
  createProduct,
  createRelease,
  createReleaseFeedbackLink,
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
 * Public changelog contract.
 *
 * The suite seeds every row that must not appear — draft, scheduled, archived,
 * channel-off, hidden, pending, rejected, merged, banned-author, private-board
 * and foreign-product links — then reads the same projections the pages use.
 */

let previousUrl: string | undefined;

beforeAll(async () => {
  previousUrl = process.env.BETTER_AUTH_URL;
  process.env.BETTER_AUTH_URL ??= "https://feedback.example.com";
  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  if (previousUrl === undefined) delete process.env.BETTER_AUTH_URL;
  else process.env.BETTER_AUTH_URL = previousUrl;
  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

describe("public changelog", () => {
  isolatedTest("lists only published public entries with tags, authors and video", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id, { publicChangelogEnabled: true });
    const author = await createUser({ name: "Ada Lovelace" });

    const visible = await createRelease({
      productId: product.id,
      title: "Faster search",
      slug: "faster-search",
      summary: "Search is now twice as fast.",
      body: "### What changed\n\nSearch is now twice as fast.",
      translations: {
        es: {
          title: "Búsqueda más rápida",
          summary: "La búsqueda es el doble de rápida.",
          body: "### Qué cambió\n\nLa búsqueda es el doble de rápida.",
        },
      },
      authorIds: [author.id],
      tagNames: ["API", "api", "mobile"],
      youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
    await createRelease({
      productId: product.id,
      title: "Draft entry",
      status: "draft",
    });
    await createRelease({
      productId: product.id,
      title: "Scheduled entry",
      status: "scheduled",
    });
    const archived = await createRelease({
      productId: product.id,
      title: "Archived entry",
      status: "archived",
    });
    await createRelease({
      productId: product.id,
      title: "Channel off",
      status: "published",
      channelPublicChangelog: false,
    });

    const page = await getPublicChangelogPage({
      workspaceSlug: workspace.slug,
      productSlug: product.slug,
    });
    expect(page).not.toBeNull();
    if (!page) return;

    expect(page.entries.map((entry) => entry.id)).toEqual([visible.id]);
    const entry = page.entries[0];
    expect(entry?.tags).toEqual(["API", "mobile"]);
    expect(entry?.authors).toEqual([{ id: author.id, name: "Ada Lovelace" }]);
    expect(entry?.summary).toBe("Search is now twice as fast.");
    expect(entry?.translations.es?.title).toBe("Búsqueda más rápida");
    expect(page.boardSlug).toBeNull();
    expect(page.roadmapEnabled).toBe(false);

    const detail = await getPublicChangelogEntry({
      workspaceSlug: workspace.slug,
      productSlug: product.slug,
      slug: visible.slug,
    });
    expect(detail?.entry.youtubeUrl).toBe(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
    expect(detail?.entry.translations.es?.body).toContain("doble de rápida");

    expect(
      await getPublicChangelogEntry({
        workspaceSlug: workspace.slug,
        productSlug: product.slug,
        slug: archived.slug,
      }),
    ).toBeNull();

    expect(
      await getPublicChangelogEntry({
        workspaceSlug: workspace.slug,
        productSlug: product.slug,
        slug: "missing",
      }),
    ).toBeNull();
  });

  isolatedTest("the product switch closes list, detail and RSS", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id, { publicChangelogEnabled: false });
    const release = await createRelease({ productId: product.id, title: "Hidden updates" });

    expect(
      await getPublicChangelogPage({
        workspaceSlug: workspace.slug,
        productSlug: product.slug,
      }),
    ).toBeNull();
    expect(
      await getPublicChangelogEntry({
        workspaceSlug: workspace.slug,
        productSlug: product.slug,
        slug: release.slug,
      }),
    ).toBeNull();

    const response = await getRss(new Request("https://feedback.example.com"), {
      params: Promise.resolve({ workspaceSlug: workspace.slug, productSlug: product.slug }),
    });
    expect(response.status).toBe(404);
  });

  isolatedTest("a viewer sees only visible linked requests plus their own pending one", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id, {
      publicChangelogEnabled: true,
      publicFeedbackEnabled: true,
    });
    const board = await createBoard(product.id, { slug: "feedback" });
    const moderated = await createBoard(product.id, {
      slug: "moderated",
      settings: {
        moderation: { requireApproval: "all", comments: "open", blockSensitiveInfo: false },
      },
    });
    const privateBoard = await createBoard(product.id, {
      slug: "private",
      visibility: "private",
    });
    const release = await createRelease({ productId: product.id, title: "Built things" });

    const viewer = await createCustomer(workspace.id, { email: "viewer@example.test" });
    const otherCustomer = await createCustomer(workspace.id);

    const visible = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: "Visible request",
      status: "shipped",
    });
    const viewerPending = await createFeedbackPost({
      productId: product.id,
      boardId: moderated.id,
      title: "Viewer pending request",
      status: "planned",
      authorCustomerId: viewer.id,
    });
    await createModerationReview({
      productId: product.id,
      contentType: "feedback_post",
      contentId: viewerPending.id,
      status: "pending",
    });
    const otherPending = await createFeedbackPost({
      productId: product.id,
      boardId: moderated.id,
      title: "Someone else pending",
      status: "planned",
      authorCustomerId: otherCustomer.id,
    });
    await createModerationReview({
      productId: product.id,
      contentType: "feedback_post",
      contentId: otherPending.id,
      status: "pending",
    });
    const rejected = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: "Rejected request",
    });
    await createModerationReview({
      productId: product.id,
      contentType: "feedback_post",
      contentId: rejected.id,
      status: "rejected",
    });
    const hidden = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: "Hidden request",
      hiddenAt: new Date(),
    });
    const merged = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: "Merged request",
      mergedIntoId: visible.id,
    });
    const archived = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: "Archived request",
      archivedAt: new Date(),
    });
    const privateRequest = await createFeedbackPost({
      productId: product.id,
      boardId: privateBoard.id,
      title: "Private board request",
    });
    const bannedCustomer = await createCustomer(workspace.id, { bannedAt: new Date() });
    const banned = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: "Banned author",
      authorCustomerId: bannedCustomer.id,
    });

    for (const post of [
      visible,
      viewerPending,
      otherPending,
      rejected,
      hidden,
      merged,
      archived,
      privateRequest,
      banned,
    ]) {
      await createReleaseFeedbackLink({
        productId: product.id,
        releaseId: release.id,
        feedbackPostId: post.id,
      });
    }

    const publicDetail = await getPublicChangelogEntry({
      workspaceSlug: workspace.slug,
      productSlug: product.slug,
      slug: release.slug,
    });
    expect(publicDetail?.entry.linkedRequests.map((request) => request.id)).toEqual([
      visible.id,
    ]);

    const viewerDetail = await getPublicChangelogEntry(
      {
        workspaceSlug: workspace.slug,
        productSlug: product.slug,
        slug: release.slug,
      },
      { customerId: viewer.id, workspaceId: workspace.id, identified: true, hasCompany: false },
    );
    expect(
      viewerDetail?.entry.linkedRequests.map((request) => request.id).sort(),
    ).toEqual([visible.id, viewerPending.id].sort());
    expect(
      viewerDetail?.entry.linkedRequests.find((request) => request.id === viewerPending.id)
        ?.pending,
    ).toBe(true);

    // A session from another workspace cannot widen the projection.
    const foreignViewerDetail = await getPublicChangelogEntry(
      {
        workspaceSlug: workspace.slug,
        productSlug: product.slug,
        slug: release.slug,
      },
      {
        customerId: viewer.id,
        workspaceId: "00000000-0000-4000-8000-000000000000",
        identified: true,
        hasCompany: false,
      },
    );
    expect(foreignViewerDetail?.entry.linkedRequests.map((request) => request.id)).toEqual([
      visible.id,
    ]);
  });

  isolatedTest("sitemap and RSS expose only published public entries", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id, { publicChangelogEnabled: true });
    const visible = await createRelease({
      productId: product.id,
      title: "Visible update",
      slug: "visible-update",
      summary: "Visible summary.",
    });
    await createRelease({ productId: product.id, title: "Draft update", status: "draft" });
    await createRelease({
      productId: product.id,
      title: "Off channel",
      channelPublicChangelog: false,
    });

    const entries = await listPublicSitemapEntries();
    const urls = entries.map((entry) =>
      entry.kind === "changelog"
        ? `/p/${entry.workspaceSlug}/${entry.productSlug}/updates`
        : entry.kind === "changelog_entry"
          ? `/p/${entry.workspaceSlug}/${entry.productSlug}/updates/${entry.slug}`
          : null,
    );
    expect(urls).toContain(`/p/${workspace.slug}/${product.slug}/updates`);
    expect(urls).toContain(`/p/${workspace.slug}/${product.slug}/updates/${visible.slug}`);
    expect(urls).not.toContain(
      `/p/${workspace.slug}/${product.slug}/updates/off-channel`,
    );

    const publicEntries = await listPublicChangelogEntries(product.id, 50);
    expect(publicEntries.map((entry) => entry.id)).toEqual([visible.id]);

    const response = await getRss(new Request("https://feedback.example.com"), {
      params: Promise.resolve({ workspaceSlug: workspace.slug, productSlug: product.slug }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/rss+xml");
    const xml = await response.text();
    expect(xml).toContain("<title>Visible update</title>");
    expect(xml).toContain(`${workspace.slug}/${product.slug}/updates/visible-update`);
    expect(xml).not.toContain("Draft update");
    expect(xml).not.toContain("Off channel");
  });
});
