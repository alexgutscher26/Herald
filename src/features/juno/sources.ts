import "server-only";

import { and, asc, count, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  knowledgeSources,
  knowledgeVersions,
  type KnowledgeChangeSummary,
  type KnowledgeSource,
  type KnowledgeVersion,
} from "@/db/schema/knowledge";
import { enqueueJob } from "@/features/jobs/queue";

import {
  assertCrawlableUrl,
  CrawlError,
  pathPrefixFor,
} from "./crawl";
import { failKnowledgeVersion, ingestKnowledgeVersion } from "./ingest";
import {
  byteLength,
  isAllowedUpload,
  MAX_DOCUMENT_BYTES,
  parseDocument,
  PATH_PREFIX_MAX,
} from "./text";

/**
 * Knowledge source lifecycle.
 *
 * Every query is scoped by the already-authorized product id. A source has at
 * most one live version; a replacement or recrawl builds a new version while
 * the old one keeps serving. Pausing keeps every row and only removes the
 * source from retrieval. The beta limit is enforced on create, not in the UI.
 */

export const KNOWLEDGE_SOURCE_LIMIT = 5;

export type KnowledgeResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type KnowledgeVersionView = {
  id: string;
  status: KnowledgeVersion["status"];
  pageCount: number;
  chunkCount: number;
  error: string | null;
  createdAt: string;
  publishedAt: string | null;
};

export type KnowledgeSourceView = {
  id: string;
  name: string;
  kind: KnowledgeSource["kind"];
  status: KnowledgeSource["status"];
  visibility: KnowledgeSource["visibility"];
  url: string | null;
  pathPrefix: string | null;
  pageCount: number;
  lastError: string | null;
  recrawlIntervalHours: number;
  lastCheckedAt: string | null;
  lastChangedAt: string | null;
  lastChangeSummary: KnowledgeChangeSummary | null;
  createdAt: string;
  updatedAt: string;
  activeVersion: KnowledgeVersionView | null;
  latestVersion: KnowledgeVersionView | null;
};

function normalizeName(raw: string): string | null {
  const name = raw.replace(/\s+/g, " ").trim();
  if (name.length === 0 || name.length > 80) return null;
  return name;
}

function versionView(version: KnowledgeVersion): KnowledgeVersionView {
  return {
    id: version.id,
    status: version.status,
    pageCount: version.pageCount,
    chunkCount: version.chunkCount,
    error: version.error,
    createdAt: version.createdAt.toISOString(),
    publishedAt: version.publishedAt?.toISOString() ?? null,
  };
}

export async function listKnowledgeSources(
  productId: string,
): Promise<KnowledgeSourceView[]> {
  const sources = await db
    .select()
    .from(knowledgeSources)
    .where(eq(knowledgeSources.productId, productId))
    .orderBy(asc(knowledgeSources.createdAt));

  if (sources.length === 0) return [];

  const versions = await db
    .select()
    .from(knowledgeVersions)
    .where(
      inArray(
        knowledgeVersions.sourceId,
        sources.map((source) => source.id),
      ),
    )
    .orderBy(desc(knowledgeVersions.createdAt));

  const bySource = new Map<string, KnowledgeVersion[]>();
  for (const version of versions) {
    const list = bySource.get(version.sourceId) ?? [];
    list.push(version);
    bySource.set(version.sourceId, list);
  }

  return sources.map((source) => {
    const list = bySource.get(source.id) ?? [];
    const active = list.find((version) => version.id === source.activeVersionId);
    return {
      id: source.id,
      name: source.name,
      kind: source.kind,
      status: source.status,
      visibility: source.visibility,
      url: source.url,
      pathPrefix: source.pathPrefix,
      pageCount: source.pageCount,
      lastError: source.lastError,
      recrawlIntervalHours: source.recrawlIntervalHours,
      lastCheckedAt: source.lastCheckedAt?.toISOString() ?? null,
      lastChangedAt: source.lastChangedAt?.toISOString() ?? null,
      lastChangeSummary: source.lastChangeSummary,
      createdAt: source.createdAt.toISOString(),
      updatedAt: source.updatedAt.toISOString(),
      activeVersion: active ? versionView(active) : null,
      latestVersion: list[0] ? versionView(list[0]) : null,
    };
  });
}

async function sourceCount(productId: string): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(knowledgeSources)
    .where(
      and(
        eq(knowledgeSources.productId, productId),
        inArray(knowledgeSources.kind, ["upload", "url"]),
      ),
    );
  return rows[0]?.value ?? 0;
}

async function newVersion(input: {
  sourceId: string;
  productId: string;
}): Promise<string> {
  const inserted = await db
    .insert(knowledgeVersions)
    .values({
      sourceId: input.sourceId,
      productId: input.productId,
      status: "building",
    })
    .returning({ id: knowledgeVersions.id });
  const id = inserted[0]?.id;
  if (!id) throw new Error("Could not start a knowledge version.");
  return id;
}

function limitReached(): KnowledgeResult<never> {
  return {
    ok: false,
    error: "Beta workspaces can keep up to five knowledge sources. Remove one first.",
  };
}

function documentError(error: unknown): string {
  return error instanceof Error ? error.message : "Could not read that document.";
}

export async function createUploadSource(input: {
  workspaceId: string;
  productId: string;
  userId: string;
  name: string;
  filename: string;
  mimeType?: string | null;
  content: string;
}): Promise<KnowledgeResult<{ sourceId: string }>> {
  const name = normalizeName(input.name);
  if (!name) return { ok: false, error: "Use a source name between 1 and 80 characters." };
  if (!isAllowedUpload(input.filename, input.mimeType)) {
    return {
      ok: false,
      error: "Upload Markdown, plain text, HTML, JSON, YAML or PDF.",
    };
  }
  if (byteLength(input.content) > MAX_DOCUMENT_BYTES) {
    return { ok: false, error: "Documents must be 10 MB or smaller." };
  }

  let document;
  try {
    document = parseDocument({
      filename: input.filename,
      mimeType: input.mimeType,
      content: input.content,
    });
  } catch (error) {
    return { ok: false, error: documentError(error) };
  }

  if ((await sourceCount(input.productId)) >= KNOWLEDGE_SOURCE_LIMIT) {
    return limitReached();
  }

  const created = await db
    .insert(knowledgeSources)
    .values({
      workspaceId: input.workspaceId,
      productId: input.productId,
      name,
      kind: "upload",
      status: "processing",
      createdBy: input.userId,
    })
    .returning({ id: knowledgeSources.id });

  const sourceId = created[0]?.id;
  if (!sourceId) return { ok: false, error: "Could not create the source." };

  const versionId = await newVersion({ sourceId, productId: input.productId });

  try {
    await ingestKnowledgeVersion({
      sourceId,
      productId: input.productId,
      versionId,
      pages: [{ title: document.title ?? name, url: null, content: document.text }],
    });
    return { ok: true, data: { sourceId } };
  } catch (error) {
    await failKnowledgeVersion({
      sourceId,
      productId: input.productId,
      versionId,
      error: documentError(error),
    });
    return { ok: false, error: documentError(error) };
  }
}

export async function createUrlSource(input: {
  workspaceId: string;
  productId: string;
  userId: string;
  name: string;
  url: string;
}): Promise<KnowledgeResult<{ sourceId: string }>> {
  const name = normalizeName(input.name);
  if (!name) return { ok: false, error: "Use a source name between 1 and 80 characters." };

  let target: URL;
  try {
    target = await assertCrawlableUrl(input.url.trim());
  } catch (error) {
    return {
      ok: false,
      error: error instanceof CrawlError ? error.message : "That URL cannot be crawled.",
    };
  }

  if ((await sourceCount(input.productId)) >= KNOWLEDGE_SOURCE_LIMIT) {
    return limitReached();
  }

  const created = await db
    .insert(knowledgeSources)
    .values({
      workspaceId: input.workspaceId,
      productId: input.productId,
      name,
      kind: "url",
      url: target.toString(),
      pathPrefix: pathPrefixFor(target.pathname).slice(0, PATH_PREFIX_MAX),
      status: "processing",
      createdBy: input.userId,
    })
    .returning({ id: knowledgeSources.id });

  const sourceId = created[0]?.id;
  if (!sourceId) return { ok: false, error: "Could not create the source." };

  const versionId = await newVersion({ sourceId, productId: input.productId });

  try {
    await enqueueJob({
      type: "crawl_knowledge",
      payload: { sourceId, versionId },
      dedupeKey: `crawl:${versionId}`,
    });
    return { ok: true, data: { sourceId } };
  } catch {
    await failKnowledgeVersion({
      sourceId,
      productId: input.productId,
      versionId,
      error: "Could not queue the crawl.",
    });
    return { ok: false, error: "Could not queue the crawl. Please try again." };
  }
}

export async function recrawlSource(input: {
  productId: string;
  sourceId: string;
}): Promise<KnowledgeResult<{ sourceId: string }>> {
  const rows = await db
    .select()
    .from(knowledgeSources)
    .where(
      and(
        eq(knowledgeSources.id, input.sourceId),
        eq(knowledgeSources.productId, input.productId),
      ),
    )
    .limit(1);

  const source = rows[0];
  if (!source) return { ok: false, error: "That knowledge source no longer exists." };
  if (source.kind !== "url" || !source.url) {
    return { ok: false, error: "Only crawled sources can be recrawled." };
  }

  const versionId = await newVersion({ sourceId: source.id, productId: input.productId });

  await db
    .update(knowledgeSources)
    .set({ status: "processing", lastError: null, updatedAt: new Date() })
    .where(eq(knowledgeSources.id, source.id));

  try {
    await enqueueJob({
      type: "crawl_knowledge",
      payload: { sourceId: source.id, versionId },
      dedupeKey: `crawl:${versionId}`,
    });
    return { ok: true, data: { sourceId: source.id } };
  } catch {
    await failKnowledgeVersion({
      sourceId: source.id,
      productId: input.productId,
      versionId,
      error: "Could not queue the recrawl.",
    });
    return { ok: false, error: "Could not queue the recrawl. Please try again." };
  }
}

export async function replaceUploadSource(input: {
  productId: string;
  sourceId: string;
  filename: string;
  mimeType?: string | null;
  content: string;
}): Promise<KnowledgeResult<{ sourceId: string }>> {
  const rows = await db
    .select()
    .from(knowledgeSources)
    .where(
      and(
        eq(knowledgeSources.id, input.sourceId),
        eq(knowledgeSources.productId, input.productId),
      ),
    )
    .limit(1);

  const source = rows[0];
  if (!source) return { ok: false, error: "That knowledge source no longer exists." };
  if (source.kind !== "upload") {
    return { ok: false, error: "Uploaded sources can be replaced; crawled sources are recrawled." };
  }
  if (!isAllowedUpload(input.filename, input.mimeType)) {
    return { ok: false, error: "Upload Markdown, plain text, HTML, JSON, YAML or PDF." };
  }
  if (byteLength(input.content) > MAX_DOCUMENT_BYTES) {
    return { ok: false, error: "Documents must be 10 MB or smaller." };
  }

  let document;
  try {
    document = parseDocument({
      filename: input.filename,
      mimeType: input.mimeType,
      content: input.content,
    });
  } catch (error) {
    return { ok: false, error: documentError(error) };
  }

  const versionId = await newVersion({ sourceId: source.id, productId: input.productId });

  try {
    await ingestKnowledgeVersion({
      sourceId: source.id,
      productId: input.productId,
      versionId,
      pages: [
        { title: document.title ?? source.name, url: null, content: document.text },
      ],
    });
    return { ok: true, data: { sourceId: source.id } };
  } catch (error) {
    await failKnowledgeVersion({
      sourceId: source.id,
      productId: input.productId,
      versionId,
      error: documentError(error),
    });
    return { ok: false, error: documentError(error) };
  }
}

async function setSourceStatus(input: {
  productId: string;
  sourceId: string;
  status: "paused" | "live";
}): Promise<KnowledgeResult<{ sourceId: string }>> {
  const rows = await db
    .select({
      id: knowledgeSources.id,
      activeVersionId: knowledgeSources.activeVersionId,
    })
    .from(knowledgeSources)
    .where(
      and(
        eq(knowledgeSources.id, input.sourceId),
        eq(knowledgeSources.productId, input.productId),
      ),
    )
    .limit(1);

  const source = rows[0];
  if (!source) return { ok: false, error: "That knowledge source no longer exists." };

  if (input.status === "live" && !source.activeVersionId) {
    return { ok: false, error: "Build this source before unpausing it." };
  }

  await db
    .update(knowledgeSources)
    .set({ status: input.status, updatedAt: new Date() })
    .where(eq(knowledgeSources.id, source.id));

  return { ok: true, data: { sourceId: source.id } };
}

export function pauseSource(input: {
  productId: string;
  sourceId: string;
}): Promise<KnowledgeResult<{ sourceId: string }>> {
  return setSourceStatus({ ...input, status: "paused" });
}

export function resumeSource(input: {
  productId: string;
  sourceId: string;
}): Promise<KnowledgeResult<{ sourceId: string }>> {
  return setSourceStatus({ ...input, status: "live" });
}

export async function saveSourceSettings(input: {
  productId: string;
  sourceId: string;
  visibility: string;
  recrawlIntervalHours: number;
}): Promise<KnowledgeResult<{ sourceId: string }>> {
  if (input.visibility !== "public" && input.visibility !== "internal") {
    return { ok: false, error: "Choose public or internal only." };
  }
  if (
    !Number.isInteger(input.recrawlIntervalHours) ||
    input.recrawlIntervalHours < 0 ||
    input.recrawlIntervalHours > 720
  ) {
    return { ok: false, error: "Recrawl intervals must be between 0 and 720 hours." };
  }

  const rows = await db
    .select({ kind: knowledgeSources.kind })
    .from(knowledgeSources)
    .where(
      and(
        eq(knowledgeSources.id, input.sourceId),
        eq(knowledgeSources.productId, input.productId),
      ),
    )
    .limit(1);
  const source = rows[0];
  if (!source) return { ok: false, error: "That knowledge source no longer exists." };

  const isCrawl = source.kind === "url";
  await db
    .update(knowledgeSources)
    .set({
      visibility: input.visibility,
      recrawlIntervalHours: isCrawl ? input.recrawlIntervalHours : 0,
      updatedAt: new Date(),
    })
    .where(eq(knowledgeSources.id, input.sourceId));

  return { ok: true, data: { sourceId: input.sourceId } };
}

/** Clear the "source changed" alert without pretending the check did not run. */
export async function dismissSourceChange(input: {
  productId: string;
  sourceId: string;
}): Promise<KnowledgeResult<{ sourceId: string }>> {
  const updated = await db
    .update(knowledgeSources)
    .set({ lastChangeSummary: null, updatedAt: new Date() })
    .where(
      and(
        eq(knowledgeSources.id, input.sourceId),
        eq(knowledgeSources.productId, input.productId),
      ),
    )
    .returning({ id: knowledgeSources.id });

  if (!updated[0]) {
    return { ok: false, error: "That knowledge source no longer exists." };
  }
  return { ok: true, data: { sourceId: input.sourceId } };
}

export async function removeSource(input: {
  productId: string;
  sourceId: string;
}): Promise<KnowledgeResult<{ removed: true }>> {
  const removed = await db
    .delete(knowledgeSources)
    .where(
      and(
        eq(knowledgeSources.id, input.sourceId),
        eq(knowledgeSources.productId, input.productId),
      ),
    )
    .returning({ id: knowledgeSources.id });

  if (removed.length === 0) {
    return { ok: false, error: "That knowledge source no longer exists." };
  }
  return { ok: true, data: { removed: true } };
}
