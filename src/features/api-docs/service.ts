import "server-only";

import { and, asc, desc, eq, or } from "drizzle-orm";

import { db } from "@/db";
import {
  apiDocs,
  apiDocVersions,
  type ApiDoc,
  type ApiDocChange,
  type ApiDocVersion,
} from "@/db/schema/api-docs";
import { products, workspaces } from "@/db/schema/workspaces";
import { assertCrawlableUrl, CrawlError } from "@/features/juno/crawl";
import { slugify } from "@/lib/slug";

import {
  diffOpenApi,
  hasBreakingChanges,
  listOpenApiOperations,
  openApiTitle,
  parseOpenApiDocument,
  type OpenApiOperation,
} from "./openapi-lib";

/** API document catalogue and version lifecycle. */

export type ApiDocResult<T> = { ok: true; data: T } | { ok: false; error: string };

export type ApiDocSummary = ApiDoc & {
  liveVersion: string | null;
  operationCount: number;
  versionCount: number;
};

export type ApiVersionView = ApiDocVersion & {
  operationCount: number;
  breakingCount: number;
};

export type PublicApiDoc = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  version: string;
  publishedAt: Date | null;
  document: Record<string, unknown>;
  operations: OpenApiOperation[];
};

function cleanSlug(value: string, fallback: string): string {
  return (slugify(value).slice(0, 80) || slugify(fallback).slice(0, 80) || "api").replace(
    /^-+|-+$/g,
    "",
  );
}

function failure(error: unknown, fallback: string): { ok: false; error: string } {
  if (error instanceof Error && /unique|duplicate/i.test(error.message)) {
    return { ok: false, error: "That version or slug already exists for this API." };
  }
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

export async function listApiDocs(productId: string): Promise<ApiDocSummary[]> {
  const docs = await db
    .select()
    .from(apiDocs)
    .where(eq(apiDocs.productId, productId))
    .orderBy(asc(apiDocs.name));
  if (docs.length === 0) return [];

  const versions = await db
    .select()
    .from(apiDocVersions)
    .where(eq(apiDocVersions.productId, productId))
    .orderBy(desc(apiDocVersions.createdAt));

  return docs.map((doc) => {
    const own = versions.filter((version) => version.apiDocId === doc.id);
    const live = own.find((version) => version.status === "live");
    return {
      ...doc,
      liveVersion: live?.version ?? null,
      operationCount: live ? listOpenApiOperations(live.document).length : 0,
      versionCount: own.length,
    };
  });
}

export async function getAdminApiDoc(productId: string, docId: string) {
  const rows = await db
    .select()
    .from(apiDocs)
    .where(and(eq(apiDocs.id, docId), eq(apiDocs.productId, productId)))
    .limit(1);
  const doc = rows[0];
  if (!doc) return null;

  const versions = await db
    .select()
    .from(apiDocVersions)
    .where(eq(apiDocVersions.apiDocId, docId))
    .orderBy(desc(apiDocVersions.createdAt));

  return {
    doc,
    versions: versions.map((version) => ({
      ...version,
      operationCount: listOpenApiOperations(version.document).length,
      breakingCount: version.breakingChanges.filter(
        (change) => change.severity === "breaking",
      ).length,
    })),
  };
}

export async function importApiDocVersion(input: {
  workspaceId: string;
  productId: string;
  userId: string | null;
  docSlug: string;
  name?: string;
  description?: string;
  raw: string;
  version: string;
  source: "file" | "url" | "ci";
  sourceUrl?: string | null;
}): Promise<ApiDocResult<{
  docId: string;
  versionId: string;
  changes: ApiDocChange[];
  breaking: boolean;
}>> {
  let document: Record<string, unknown>;
  try {
    document = parseOpenApiDocument(input.raw);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Invalid OpenAPI." };
  }

  const slug = cleanSlug(input.docSlug || openApiTitle(document), openApiTitle(document));
  const version = input.version.trim().slice(0, 80);
  if (!version) return { ok: false, error: "Give this import a version label." };

  const rows = await db
    .select()
    .from(apiDocs)
    .where(and(eq(apiDocs.productId, input.productId), eq(apiDocs.slug, slug)))
    .limit(1);
  let doc = rows[0];

  if (!doc) {
    try {
      const inserted = await db
        .insert(apiDocs)
        .values({
          workspaceId: input.workspaceId,
          productId: input.productId,
          slug,
          name: (input.name?.trim() || openApiTitle(document)).slice(0, 120),
          description: input.description?.trim().slice(0, 1000) || null,
          createdBy: input.userId,
        })
        .returning();
      doc = inserted[0];
    } catch (error) {
      return failure(error, "Could not create the API document.");
    }
  }
  if (!doc) return { ok: false, error: "Could not create the API document." };

  const liveRows = await db
    .select()
    .from(apiDocVersions)
    .where(and(eq(apiDocVersions.apiDocId, doc.id), eq(apiDocVersions.status, "live")))
    .limit(1);
  const live = liveRows[0];
  const changes = live ? diffOpenApi(live.document, document) : [];

  try {
    const inserted = await db
      .insert(apiDocVersions)
      .values({
        apiDocId: doc.id,
        productId: input.productId,
        version,
        source: input.source,
        sourceUrl: input.sourceUrl?.slice(0, 2000) ?? null,
        status: "draft",
        document,
        breakingChanges: changes,
        createdBy: input.userId,
      })
      .returning({ id: apiDocVersions.id });
    const versionId = inserted[0]?.id;
    if (!versionId) return { ok: false, error: "Could not store the API version." };
    return {
      ok: true,
      data: {
        docId: doc.id,
        versionId,
        changes,
        breaking: hasBreakingChanges(changes),
      },
    };
  } catch (error) {
    return failure(error, "Could not store the API version.");
  }
}

export async function publishApiDocVersion(input: {
  productId: string;
  versionId: string;
  confirmBreaking: boolean;
}): Promise<ApiDocResult<{ docId: string; version: string }>> {
  const rows = await db
    .select({ version: apiDocVersions, doc: apiDocs })
    .from(apiDocVersions)
    .innerJoin(apiDocs, eq(apiDocVersions.apiDocId, apiDocs.id))
    .where(
      and(
        eq(apiDocVersions.id, input.versionId),
        eq(apiDocVersions.productId, input.productId),
        eq(apiDocs.productId, input.productId),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return { ok: false, error: "That API version no longer exists." };
  if (
    hasBreakingChanges(row.version.breakingChanges) &&
    !input.confirmBreaking
  ) {
    return {
      ok: false,
      error: "This version has breaking changes. Review the diff and confirm before publishing.",
    };
  }

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(apiDocVersions)
        .set({ status: "superseded" })
        .where(
          and(
            eq(apiDocVersions.apiDocId, row.doc.id),
            eq(apiDocVersions.status, "live"),
          ),
        );
      await tx
        .update(apiDocVersions)
        .set({ status: "live", publishedAt: new Date() })
        .where(eq(apiDocVersions.id, row.version.id));
      await tx
        .update(apiDocs)
        .set({ updatedAt: new Date() })
        .where(eq(apiDocs.id, row.doc.id));
    });
    return { ok: true, data: { docId: row.doc.id, version: row.version.version } };
  } catch (error) {
    return failure(error, "Could not publish the API version.");
  }
}

export async function rollbackApiDocVersion(input: {
  productId: string;
  versionId: string;
}): Promise<ApiDocResult<{ docId: string; version: string }>> {
  return publishApiDocVersion({
    productId: input.productId,
    versionId: input.versionId,
    confirmBreaking: true,
  });
}

export async function deleteApiDoc(input: {
  productId: string;
  docId: string;
}): Promise<ApiDocResult<null>> {
  const rows = await db
    .delete(apiDocs)
    .where(and(eq(apiDocs.id, input.docId), eq(apiDocs.productId, input.productId)))
    .returning({ id: apiDocs.id });
  return rows[0] ? { ok: true, data: null } : { ok: false, error: "API not found." };
}

export async function fetchApiDocUrl(raw: string): Promise<
  { ok: true; content: string; url: string } | { ok: false; error: string }
> {
  let target: URL;
  try {
    target = await assertCrawlableUrl(raw.trim());
  } catch (error) {
    return {
      ok: false,
      error: error instanceof CrawlError ? error.message : "That URL cannot be imported.",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(target, {
      signal: controller.signal,
      cache: "no-store",
      redirect: "manual",
      headers: { accept: "application/json" },
    });
    if (!response.ok) return { ok: false, error: `The URL returned ${response.status}.` };
    const content = await response.text();
    if (content.length > 5_000_000) return { ok: false, error: "The document is too large." };
    return { ok: true, content, url: target.toString() };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error && error.name === "AbortError"
          ? "The URL took too long to load."
          : "Could not read that URL.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function resolvePublicProduct(input: {
  workspaceSlug: string;
  productSlug: string;
}) {
  const rows = await db
    .select({
      workspaceId: workspaces.id,
      productId: products.id,
      workspaceName: workspaces.name,
      productName: products.name,
    })
    .from(products)
    .innerJoin(workspaces, eq(products.workspaceId, workspaces.id))
    .where(
      and(
        eq(workspaces.slug, input.workspaceSlug),
        eq(products.slug, input.productSlug),
        or(
          eq(products.publicFeedbackEnabled, true),
          eq(products.publicRoadmapEnabled, true),
          eq(products.publicChangelogEnabled, true),
        ),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

const liveVersionSelect = {
  id: apiDocs.id,
  slug: apiDocs.slug,
  name: apiDocs.name,
  description: apiDocs.description,
  version: apiDocVersions.version,
  publishedAt: apiDocVersions.publishedAt,
  document: apiDocVersions.document,
} as const;

export async function listPublicApiDocs(input: {
  workspaceSlug: string;
  productSlug: string;
}): Promise<{
  productName: string;
  docs: Array<{ id: string; slug: string; name: string; description: string | null; version: string }>;
} | null> {
  const product = await resolvePublicProduct(input);
  if (!product) return null;

  const rows = await db
    .select(liveVersionSelect)
    .from(apiDocs)
    .innerJoin(
      apiDocVersions,
      and(eq(apiDocVersions.apiDocId, apiDocs.id), eq(apiDocVersions.status, "live")),
    )
    .where(eq(apiDocs.productId, product.productId))
    .orderBy(asc(apiDocs.name));

  return {
    productName: product.productName,
    docs: rows.map(({ id, slug, name, description, version }) => ({
      id,
      slug,
      name,
      description,
      version,
    })),
  };
}

export async function getPublicApiDoc(input: {
  workspaceSlug: string;
  productSlug: string;
  docSlug: string;
}): Promise<{ productName: string; doc: PublicApiDoc } | null> {
  const product = await resolvePublicProduct(input);
  if (!product) return null;

  const rows = await db
    .select(liveVersionSelect)
    .from(apiDocs)
    .innerJoin(
      apiDocVersions,
      and(eq(apiDocVersions.apiDocId, apiDocs.id), eq(apiDocVersions.status, "live")),
    )
    .where(and(eq(apiDocs.productId, product.productId), eq(apiDocs.slug, input.docSlug)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  return {
    productName: product.productName,
    doc: {
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      version: row.version,
      publishedAt: row.publishedAt,
      document: row.document,
      operations: listOpenApiOperations(row.document),
    },
  };
}
