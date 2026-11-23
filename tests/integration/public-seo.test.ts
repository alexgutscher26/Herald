import { afterAll, beforeAll, describe, expect } from "bun:test";

import { eq } from "drizzle-orm";

import sitemap from "@/app/sitemap";
import { db } from "@/db";
import { feedbackPosts } from "@/db/schema";
import {
  getMergedRequestCanonicalId,
  listPublicSitemapEntries,
} from "@/features/public/queries";

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
 * The sitemap and Open Graph routes are public projections too. A URL must not
 * appear for a private or archived board, a hidden, merged, archived, banned or
 * unapproved request, or a workspace whose plan closes the public surface.
 * Merged duplicates are the one intentional redirect: their old URL moves to
 * the canonical request instead of dead-ending.
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

describe("public sitemap entries", () => {
  isolatedTest("lists public boards and only requests that are publicly visible", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const board = await createBoard(product.id);
    const privateBoard = await createBoard(product.id, { visibility: "private" });
    const archivedBoard = await createBoard(product.id, { archivedAt: new Date() });

    const visible = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: "Visible request",
    });
    const hidden = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: "Hidden request",
    });
    await db
      .update(feedbackPosts)
      .set({ hiddenAt: new Date() })
      .where(eq(feedbackPosts.id, hidden.id));

    const merged = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: "Merged duplicate",
      mergedIntoId: visible.id,
    });
    const archivedRequest = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: "Archived request",
      archivedAt: new Date(),
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

    const bannedCustomer = await createCustomer(workspace.id, { bannedAt: new Date() });
    const banned = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: "Banned author request",
      authorCustomerId: bannedCustomer.id,
    });

    const entries = await listPublicSitemapEntries();
    const urls = entries.map((entry) =>
      entry.kind === "request"
        ? `/p/${entry.workspaceSlug}/${entry.productSlug}/${entry.boardSlug}/${entry.requestId}`
        : entry.kind === "roadmap"
          ? `/p/${entry.workspaceSlug}/${entry.productSlug}/roadmap`
          : entry.kind === "changelog"
            ? `/p/${entry.workspaceSlug}/${entry.productSlug}/updates`
            : entry.kind === "changelog_entry"
              ? `/p/${entry.workspaceSlug}/${entry.productSlug}/updates/${entry.slug}`
              : entry.kind === "help"
                ? `/p/${entry.workspaceSlug}/${entry.productSlug}/help`
                : entry.kind === "help_collection"
                  ? `/p/${entry.workspaceSlug}/${entry.productSlug}/help/${entry.collectionSlug}`
                  : entry.kind === "help_article"
                    ? `/p/${entry.workspaceSlug}/${entry.productSlug}/help/${entry.collectionSlug}/${entry.articleSlug}`
                    : entry.kind === "api_docs"
                      ? `/p/${entry.workspaceSlug}/${entry.productSlug}/docs/api`
                      : entry.kind === "api_doc"
                        ? `/p/${entry.workspaceSlug}/${entry.productSlug}/docs/api/${entry.docSlug}`
                        : `/p/${entry.workspaceSlug}/${entry.productSlug}/${entry.boardSlug}`,
    );

    expect(urls).toContain(`/p/${workspace.slug}/${product.slug}/${board.slug}`);
    expect(urls).not.toContain(
      `/p/${workspace.slug}/${product.slug}/${privateBoard.slug}`,
    );
    expect(urls).not.toContain(
      `/p/${workspace.slug}/${product.slug}/${archivedBoard.slug}`,
    );

    expect(urls).toContain(
      `/p/${workspace.slug}/${product.slug}/${board.slug}/${visible.id}`,
    );
    for (const excluded of [hidden, merged, archivedRequest, rejected, banned]) {
      expect(urls).not.toContain(
        `/p/${workspace.slug}/${product.slug}/${board.slug}/${excluded.id}`,
      );
    }
  });

  isolatedTest("requires an approval before listing a moderated request", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const board = await createBoard(product.id, {
      settings: {
        moderation: {
          requireApproval: "all",
          comments: "open",
          blockSensitiveInfo: false,
        },
      },
    });

    const pending = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: "Pending request",
    });
    const approved = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: "Approved request",
    });
    await createModerationReview({
      productId: product.id,
      contentType: "feedback_post",
      contentId: approved.id,
      status: "approved",
    });

    const urls = (await listPublicSitemapEntries()).map((entry) =>
      entry.kind === "request" ? entry.requestId : null,
    );

    expect(urls).not.toContain(pending.id);
    expect(urls).toContain(approved.id);
  });

  isolatedTest("the sitemap route emits absolute URLs for those entries", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const board = await createBoard(product.id);
    const request = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
    });

    const urls = (await sitemap()).map((entry) => entry.url);
    const origin = process.env.BETTER_AUTH_URL ?? "https://feedback.example.com";

    expect(urls).toContain(
      `${origin}/p/${workspace.slug}/${product.slug}/${board.slug}`,
    );
    expect(urls).toContain(
      `${origin}/p/${workspace.slug}/${product.slug}/${board.slug}/${request.id}`,
    );
  });
});

describe("merged request redirects", () => {
  isolatedTest("resolves the canonical request only while it is public", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const board = await createBoard(product.id);
    const input = {
      workspaceSlug: workspace.slug,
      productSlug: product.slug,
      boardSlug: board.slug,
    };

    const canonical = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: "Canonical",
    });
    const duplicate = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      title: "Duplicate",
      mergedIntoId: canonical.id,
    });

    expect(
      await getMergedRequestCanonicalId({ ...input, requestId: duplicate.id }),
    ).toBe(canonical.id);

    // A request that was never merged is not a redirect target.
    expect(
      await getMergedRequestCanonicalId({ ...input, requestId: canonical.id }),
    ).toBeNull();

    await db
      .update(feedbackPosts)
      .set({ hiddenAt: new Date() })
      .where(eq(feedbackPosts.id, duplicate.id));
    expect(
      await getMergedRequestCanonicalId({ ...input, requestId: duplicate.id }),
    ).toBeNull();
  });

  isolatedTest("never redirects a foreign board or a hidden canonical request", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const board = await createBoard(product.id);
    const foreignProduct = await createProduct(workspace.id);
    const foreignBoard = await createBoard(foreignProduct.id);

    const canonical = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
    });
    const duplicate = await createFeedbackPost({
      productId: product.id,
      boardId: board.id,
      mergedIntoId: canonical.id,
    });
    const foreign = await createFeedbackPost({
      productId: foreignProduct.id,
      boardId: foreignBoard.id,
      mergedIntoId: canonical.id,
    });

    expect(
      await getMergedRequestCanonicalId({
        workspaceSlug: workspace.slug,
        productSlug: product.slug,
        boardSlug: foreignBoard.slug,
        requestId: duplicate.id,
      }),
    ).toBeNull();

    expect(
      await getMergedRequestCanonicalId({
        workspaceSlug: workspace.slug,
        productSlug: foreignProduct.slug,
        boardSlug: foreignBoard.slug,
        requestId: foreign.id,
      }),
    ).toBeNull();

    await db
      .update(feedbackPosts)
      .set({ hiddenAt: new Date() })
      .where(eq(feedbackPosts.id, canonical.id));

    expect(
      await getMergedRequestCanonicalId({
        workspaceSlug: workspace.slug,
        productSlug: product.slug,
        boardSlug: board.slug,
        requestId: duplicate.id,
      }),
    ).toBeNull();
  });
});
