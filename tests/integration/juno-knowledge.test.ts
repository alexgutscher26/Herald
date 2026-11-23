import { afterAll, beforeAll, describe, expect } from "bun:test";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { knowledgeSources, knowledgeVersions } from "@/db/schema/knowledge";
import { retrieveKnowledge } from "@/features/juno/retrieval";
import {
  createUploadSource,
  createUrlSource,
  listKnowledgeSources,
  pauseSource,
  removeSource,
  replaceUploadSource,
  resumeSource,
} from "@/features/juno/sources";
import { runKnowledgeCrawl } from "@/features/juno/crawl-runner";

import {
  createMember,
  createProduct,
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
 * Knowledge sources against real Postgres.
 *
 * Covers the versioned package: an upload is parsed, chunked and embedded into
 * a live version; a replacement supersedes it only after the new rows exist;
 * pausing removes a source from retrieval without deleting its history; the
 * five-source limit is enforced server-side; and non-public crawl targets are
 * refused before anything is fetched.
 */

let previous: Record<string, string | undefined> = {};

beforeAll(async () => {
  previous = {
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    AI_API_URL: process.env.AI_API_URL,
    AI_API_KEY: process.env.AI_API_KEY,
    AI_MODEL: process.env.AI_MODEL,
    AI_EMBEDDING_MODEL: process.env.AI_EMBEDDING_MODEL,
  };
  process.env.BETTER_AUTH_URL ??= "http://app.local";
  process.env.BETTER_AUTH_SECRET ??= "integration-secret-value-at-least-32-chars";
  // Force the deterministic local embedding: no test may call an AI provider.
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

async function tenant() {
  const workspace = await createWorkspace();
  const product = await createProduct(workspace.id);
  const { user } = await createMember(workspace.id, { role: "admin" });
  return { workspace, product, user };
}

async function upload(
  context: Awaited<ReturnType<typeof tenant>>,
  content: string,
  name = "Help center",
): Promise<string> {
  const result = await createUploadSource({
    workspaceId: context.workspace.id,
    productId: context.product.id,
    userId: context.user.id,
    name,
    filename: "help.md",
    mimeType: "text/markdown",
    content,
  });
  if (!result.ok) throw new Error(result.error);
  return result.data.sourceId;
}

describe("knowledge sources", () => {
  isolatedTest("an upload is chunked, published and retrievable only in its product", async () => {
    const context = await tenant();
    const other = await tenant();

    await upload(
      context,
      [
        "# Exporting",
        "",
        "## Export a CSV",
        "",
        "Open Settings, choose Export, then CSV. The download starts immediately.",
        "",
        "## Invite a teammate",
        "",
        "Admins can invite teammates from Team settings.",
      ].join("\n"),
    );

    const sources = await listKnowledgeSources(context.product.id);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.status).toBe("live");
    expect(sources[0]?.activeVersion?.status).toBe("live");
    expect(sources[0]?.activeVersion?.chunkCount).toBeGreaterThan(0);
    expect(sources[0]?.pageCount).toBe(1);

    const hits = await retrieveKnowledge({
      productId: context.product.id,
      query: "how do I export a csv",
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.sourceName).toBe("Help center");
    expect(hits[0]?.content).toContain("CSV");

    // A different product sees none of it.
    expect(
      await retrieveKnowledge({ productId: other.product.id, query: "export csv" }),
    ).toEqual([]);
  });

  isolatedTest("pausing removes a source from retrieval and resuming restores it", async () => {
    const context = await tenant();
    const sourceId = await upload(
      context,
      "# Billing\n\nInvoices are available under Billing.",
    );

    expect(
      (await retrieveKnowledge({ productId: context.product.id, query: "invoices" })).length,
    ).toBeGreaterThan(0);

    const paused = await pauseSource({
      productId: context.product.id,
      sourceId,
    });
    expect(paused.ok).toBe(true);
    expect(
      await retrieveKnowledge({ productId: context.product.id, query: "invoices" }),
    ).toEqual([]);
    expect((await listKnowledgeSources(context.product.id))[0]?.status).toBe("paused");

    const resumed = await resumeSource({ productId: context.product.id, sourceId });
    expect(resumed.ok).toBe(true);
    expect(
      (await retrieveKnowledge({ productId: context.product.id, query: "invoices" })).length,
    ).toBeGreaterThan(0);
  });

  isolatedTest("the beta limit is five sources, enforced on create", async () => {
    const context = await tenant();

    for (let index = 0; index < 5; index += 1) {
      await upload(context, `# Doc ${index}\n\nFact number ${index}.`, `Doc ${index}`);
    }

    const sixth = await createUploadSource({
      workspaceId: context.workspace.id,
      productId: context.product.id,
      userId: context.user.id,
      name: "Sixth",
      filename: "sixth.md",
      content: "# Sixth\n\nOne too many.",
    });
    expect(sixth.ok).toBe(false);
    if (!sixth.ok) expect(sixth.error).toContain("five");

    const sources = await listKnowledgeSources(context.product.id);
    const removed = await removeSource({
      productId: context.product.id,
      sourceId: sources[0]!.id,
    });
    expect(removed.ok).toBe(true);

    const retry = await createUploadSource({
      workspaceId: context.workspace.id,
      productId: context.product.id,
      userId: context.user.id,
      name: "Replacement",
      filename: "replacement.md",
      content: "# Replacement\n\nNow there is room.",
    });
    expect(retry.ok).toBe(true);
  });

  isolatedTest("replacing an upload publishes a new version and supersedes the old", async () => {
    const context = await tenant();
    const sourceId = await upload(
      context,
      "# Exporting\n\nThe legacy export lives under Settings.",
    );

    const replaced = await replaceUploadSource({
      productId: context.product.id,
      sourceId,
      filename: "help.md",
      content: "# Exporting\n\nThe new export now lives under Data, then Export.",
    });
    expect(replaced.ok).toBe(true);

    const versions = await db
      .select()
      .from(knowledgeVersions)
      .where(eq(knowledgeVersions.sourceId, sourceId));
    expect(versions).toHaveLength(2);
    expect(versions.filter((version) => version.status === "live")).toHaveLength(1);
    expect(versions.filter((version) => version.status === "superseded")).toHaveLength(1);

    const hits = await retrieveKnowledge({
      productId: context.product.id,
      query: "where does the export live",
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((hit) => hit.content.includes("legacy"))).toBe(false);
    expect(hits.some((hit) => hit.content.includes("new export"))).toBe(true);
  });

  isolatedTest("non-public crawl targets are refused before anything is fetched", async () => {
    const context = await tenant();

    for (const url of [
      "http://127.0.0.1/docs",
      "http://localhost:3000/docs",
      "http://169.254.169.254/latest/meta-data",
      "file:///etc/passwd",
      "https://user:pass@example.com/docs",
      "https://example.com:8080/docs",
    ]) {
      const result = await createUrlSource({
        workspaceId: context.workspace.id,
        productId: context.product.id,
        userId: context.user.id,
        name: uniqueLabel("Blocked"),
        url,
      });
      expect(result.ok).toBe(false);
    }

    expect(await listKnowledgeSources(context.product.id)).toEqual([]);
  });

  isolatedTest("a failed crawl records the failure and invents no knowledge", async () => {
    const context = await tenant();

    const [source] = await db
      .insert(knowledgeSources)
      .values({
        workspaceId: context.workspace.id,
        productId: context.product.id,
        name: "Broken crawl",
        kind: "url",
        url: "http://127.0.0.1/docs",
        pathPrefix: "/docs/",
        status: "processing",
        createdBy: context.user.id,
      })
      .returning();
    if (!source) throw new Error("Source insert returned no row.");

    const [version] = await db
      .insert(knowledgeVersions)
      .values({
        sourceId: source.id,
        productId: context.product.id,
        status: "building",
      })
      .returning();
    if (!version) throw new Error("Version insert returned no row.");

    await expect(
      runKnowledgeCrawl({ sourceId: source.id, versionId: version.id }),
    ).rejects.toThrow();

    const [failed] = await db
      .select()
      .from(knowledgeVersions)
      .where(eq(knowledgeVersions.id, version.id));
    expect(failed?.status).toBe("failed");
    expect(failed?.error ?? "").toContain("publicly reachable");

    const [broken] = await db
      .select()
      .from(knowledgeSources)
      .where(eq(knowledgeSources.id, source.id));
    expect(broken?.status).toBe("error");

    expect(
      await retrieveKnowledge({ productId: context.product.id, query: "anything" }),
    ).toEqual([]);
  });
});
