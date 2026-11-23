import { afterAll, beforeAll, describe, expect } from "bun:test";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { knowledgeSources } from "@/db/schema/knowledge";
import {
  createHelpArticle,
  createHelpCollection,
  setHelpArticleStatus,
} from "@/features/help/service";
import { retrieveKnowledge } from "@/features/juno/retrieval";

import {
  createMember,
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
 * Publishing a help article feeds Juno directly, and unpublishing removes it
 * from answers. No crawl job is involved: the article mutation rebuilds the
 * collection's knowledge version in place and pauses it when nothing public
 * remains.
 */

const previous: Record<string, string | undefined> = {};

beforeAll(async () => {
  previous.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL;
  previous.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET;
  previous.AI_API_URL = process.env.AI_API_URL;
  previous.AI_API_KEY = process.env.AI_API_KEY;
  previous.AI_MODEL = process.env.AI_MODEL;
  previous.AI_EMBEDDING_MODEL = process.env.AI_EMBEDDING_MODEL;

  process.env.BETTER_AUTH_URL ??= "http://app.local";
  process.env.BETTER_AUTH_SECRET ??= "integration-secret-value-at-least-32-chars";
  // Keep the deterministic local embedding: no test may call an AI provider.
  delete process.env.AI_API_URL;
  delete process.env.AI_API_KEY;
  delete process.env.AI_MODEL;
  delete process.env.AI_EMBEDDING_MODEL;

  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

describe("help publishing to Juno", () => {
  isolatedTest("a published article is cited, and unpublishing removes it", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const { user } = await createMember(workspace.id, { role: "admin" });

    const collection = await createHelpCollection({
      workspaceId: workspace.id,
      productId: product.id,
      userId: user.id,
      name: "Account and security",
      slug: "account-security",
    });
    if (!collection.ok || !collection.id) {
      throw new Error(collection.ok ? "Collection id missing." : collection.error);
    }

    const article = await createHelpArticle({
      workspaceId: workspace.id,
      productId: product.id,
      userId: user.id,
      collectionId: collection.id,
      title: "Rotate an API key",
      slug: "rotate-api-key",
      body: "Open Settings, choose API keys, then rotate the key and copy the new value.",
    });
    if (!article.ok || !article.id) {
      throw new Error(article.ok ? "Article id missing." : article.error);
    }

    const published = await setHelpArticleStatus({
      workspaceId: workspace.id,
      productId: product.id,
      articleId: article.id,
      published: true,
    });
    expect(published.ok).toBe(true);

    const hits = await retrieveKnowledge({
      productId: product.id,
      query: "how do I rotate an API key",
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.content).toContain("rotate the key");
    expect(hits[0]?.url).toBe(
      `/p/${workspace.slug}/${product.slug}/help/account-security/rotate-api-key`,
    );

    const [source] = await db
      .select()
      .from(knowledgeSources)
      .where(eq(knowledgeSources.productId, product.id));
    expect(source?.kind).toBe("help_collection");
    expect(source?.status).toBe("live");

    const unpublished = await setHelpArticleStatus({
      workspaceId: workspace.id,
      productId: product.id,
      articleId: article.id,
      published: false,
    });
    expect(unpublished.ok).toBe(true);

    expect(
      await retrieveKnowledge({
        productId: product.id,
        query: "how do I rotate an API key",
      }),
    ).toEqual([]);

    const [paused] = await db
      .select()
      .from(knowledgeSources)
      .where(eq(knowledgeSources.productId, product.id));
    expect(paused?.status).toBe("paused");
    expect(paused?.activeVersionId).toBeNull();
  });
});
