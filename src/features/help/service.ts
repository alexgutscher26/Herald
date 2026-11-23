import "server-only";

import { and, asc, desc, eq, ilike, max, or, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  helpArticleRevisions,
  helpArticles,
  helpCollections,
  type HelpArticle,
  type HelpCollection,
} from "@/db/schema/help";
import { knowledgeSources } from "@/db/schema/knowledge";
import { products, workspaces } from "@/db/schema/workspaces";
import { workspaceBranding } from "@/db/schema/branding";
import { assertCrawlableUrl, CrawlError } from "@/features/juno/crawl";
import {
  cachedPublicPayload,
  invalidateAllPublicHelpArticles,
  publicPayloadKeys,
} from "@/features/public/payload-cache";
import { parseDocument } from "@/features/juno/text";
import {
  normalizeHelpTranslations,
  translatedHelp,
  type HelpTranslations,
} from "@/features/i18n/content";
import { slugify } from "@/lib/slug";

import type { HelpImportItem } from "./import-parse";
import { pauseHelpCollectionSource, syncHelpCollectionSource } from "./knowledge";

/** Help center reads and writes. Every mutation is product-scoped. */

export type HelpMutationResult =
  | { ok: true; id?: string; warning?: string }
  | { ok: false; error: string };

export type AdminHelpCollection = HelpCollection & {
  articleCount: number;
  publishedCount: number;
};

export type AdminHelpArticle = {
  id: string;
  collectionId: string;
  collectionName: string;
  slug: string;
  title: string;
  status: HelpArticle["status"];
  visibility: HelpArticle["visibility"];
  updatedAt: Date;
};

export type PublicHelpProduct = {
  workspaceId: string;
  productId: string;
  workspaceSlug: string;
  productSlug: string;
  workspaceName: string;
  productName: string;
  contentTranslationEnabled: boolean;
};

export type PublicHelpCollection = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  articles: Array<{ id: string; slug: string; title: string; updatedAt: Date }>;
};

export type PublicHelpArticle = {
  id: string;
  slug: string;
  title: string;
  body: string;
  updatedAt: Date;
  collection: { slug: string; name: string };
};

export type HelpSearchHit = {
  id: string;
  slug: string;
  title: string;
  collectionSlug: string;
  collectionName: string;
  excerpt: string;
};

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function cleanSlug(value: string, fallback: string): string {
  return (slugify(value).slice(0, 80) || slugify(fallback).slice(0, 80) || "item").replace(
    /^-+|-+$/g,
    "",
  );
}

function failure(error: unknown, fallback: string): { ok: false; error: string } {
  if (error instanceof Error && /unique|duplicate/i.test(error.message)) {
    return { ok: false, error: "That slug is already used in this product." };
  }
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

export async function listHelpAdmin(productId: string): Promise<{
  collections: AdminHelpCollection[];
  articles: AdminHelpArticle[];
}> {
  const [collections, articles] = await Promise.all([
    db
      .select()
      .from(helpCollections)
      .where(eq(helpCollections.productId, productId))
      .orderBy(asc(helpCollections.sortOrder), asc(helpCollections.name)),
    db
      .select({
        id: helpArticles.id,
        collectionId: helpArticles.collectionId,
        collectionName: helpCollections.name,
        slug: helpArticles.slug,
        title: helpArticles.title,
        status: helpArticles.status,
        visibility: helpArticles.visibility,
        updatedAt: helpArticles.updatedAt,
      })
      .from(helpArticles)
      .innerJoin(helpCollections, eq(helpArticles.collectionId, helpCollections.id))
      .where(eq(helpArticles.productId, productId))
      .orderBy(desc(helpArticles.updatedAt)),
  ]);

  const counts = await db
    .select({
      collectionId: helpArticles.collectionId,
      total: sql<number>`count(*)::int`,
      published: sql<number>`count(*) filter (where ${helpArticles.status} = 'published')::int`,
    })
    .from(helpArticles)
    .where(eq(helpArticles.productId, productId))
    .groupBy(helpArticles.collectionId);
  const byCollection = new Map(counts.map((row) => [row.collectionId, row]));

  return {
    collections: collections.map((collection) => ({
      ...collection,
      articleCount: byCollection.get(collection.id)?.total ?? 0,
      publishedCount: byCollection.get(collection.id)?.published ?? 0,
    })),
    articles,
  };
}

export async function getHelpArticleEditor(input: {
  productId: string;
  articleId: string;
}) {
  const rows = await db
    .select({
      article: helpArticles,
      collection: helpCollections,
    })
    .from(helpArticles)
    .innerJoin(helpCollections, eq(helpArticles.collectionId, helpCollections.id))
    .where(
      and(eq(helpArticles.id, input.articleId), eq(helpArticles.productId, input.productId)),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const revisions = await db
    .select()
    .from(helpArticleRevisions)
    .where(eq(helpArticleRevisions.articleId, input.articleId))
    .orderBy(desc(helpArticleRevisions.revisionNumber))
    .limit(20);

  return { ...row, revisions };
}

export async function listCollectionsForSelect(productId: string) {
  return db
    .select({ id: helpCollections.id, name: helpCollections.name })
    .from(helpCollections)
    .where(eq(helpCollections.productId, productId))
    .orderBy(asc(helpCollections.name));
}

export async function createHelpCollection(input: {
  workspaceId: string;
  productId: string;
  userId: string;
  name: string;
  slug?: string;
  description?: string;
  visibility?: "public" | "internal";
}): Promise<HelpMutationResult> {
  const name = clean(input.name, 120);
  if (!name) return { ok: false, error: "Use a collection name." };
  const slug = cleanSlug(input.slug ?? name, name);
  try {
    const inserted = await db
      .insert(helpCollections)
      .values({
        workspaceId: input.workspaceId,
        productId: input.productId,
        name,
        slug,
        description: clean(input.description, 1000) || null,
        visibility: input.visibility === "internal" ? "internal" : "public",
        createdBy: input.userId,
      })
      .returning({ id: helpCollections.id });
    return { ok: true, id: inserted[0]!.id };
  } catch (error) {
    return failure(error, "Could not create the collection.");
  }
}

export async function createHelpArticle(input: {
  workspaceId: string;
  productId: string;
  userId: string;
  collectionId: string;
  title: string;
  slug?: string;
  body: string;
  visibility?: "public" | "internal";
  translations?: unknown;
}): Promise<HelpMutationResult> {
  const title = clean(input.title, 200);
  const body = clean(input.body, 500_000);
  const translations = normalizeHelpTranslations(input.translations);
  if (!title || !body) return { ok: false, error: "An article needs a title and a body." };

  const collection = await db
    .select({ id: helpCollections.id })
    .from(helpCollections)
    .where(
      and(
        eq(helpCollections.id, input.collectionId),
        eq(helpCollections.productId, input.productId),
      ),
    )
    .limit(1);
  if (!collection[0]) return { ok: false, error: "Choose a collection in this product." };

  try {
    const articleId = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(helpArticles)
        .values({
          workspaceId: input.workspaceId,
          productId: input.productId,
          collectionId: input.collectionId,
          slug: cleanSlug(input.slug ?? title, title),
          title,
          body,
          translations,
          visibility: input.visibility === "internal" ? "internal" : "public",
          createdBy: input.userId,
          updatedBy: input.userId,
        })
        .returning({ id: helpArticles.id });
      const id = inserted[0]?.id;
      if (!id) throw new Error("Could not create the article.");
      await tx.insert(helpArticleRevisions).values({
        articleId: id,
        productId: input.productId,
        revisionNumber: 1,
        title,
        body,
        translations,
        visibility: input.visibility === "internal" ? "internal" : "public",
        createdBy: input.userId,
      });
      return id;
    });
    return { ok: true, id: articleId };
  } catch (error) {
    return failure(error, "Could not create the article.");
  }
}

async function insertRevision(tx: typeof db, input: {
  articleId: string;
  productId: string;
  title: string;
  body: string;
  translations: HelpTranslations;
  visibility: "public" | "internal";
  userId: string;
}) {
  const latest = await tx
    .select({ value: max(helpArticleRevisions.revisionNumber) })
    .from(helpArticleRevisions)
    .where(eq(helpArticleRevisions.articleId, input.articleId));
  const next = Number(latest[0]?.value ?? 0) + 1;
  await tx.insert(helpArticleRevisions).values({
    articleId: input.articleId,
    productId: input.productId,
    revisionNumber: next,
    title: input.title,
    body: input.body,
    translations: input.translations,
    visibility: input.visibility,
    createdBy: input.userId,
  });
}

export async function saveHelpArticle(input: {
  workspaceId: string;
  productId: string;
  userId: string;
  articleId: string;
  title: string;
  body: string;
  visibility: "public" | "internal";
  slug?: string;
  translations?: unknown;
}): Promise<HelpMutationResult> {
  const title = clean(input.title, 200);
  const body = clean(input.body, 500_000);
  const translations = normalizeHelpTranslations(input.translations);
  if (!title || !body) return { ok: false, error: "An article needs a title and a body." };

  const rows = await db
    .select()
    .from(helpArticles)
    .where(
      and(eq(helpArticles.id, input.articleId), eq(helpArticles.productId, input.productId)),
    )
    .limit(1);
  const article = rows[0];
  if (!article) return { ok: false, error: "That article no longer exists." };

  try {
    // A published article is already in Juno. Pause first so a failed rebuild
    // cannot leave the previous body answering questions after this edit.
    if (article.status === "published") {
      await pauseHelpCollectionSource({
        collectionId: article.collectionId,
        productId: input.productId,
      });
    }
    await db.transaction(async (tx) => {
      await tx
        .update(helpArticles)
        .set({
          title,
          body,
          translations,
          visibility: input.visibility,
          slug: input.slug ? cleanSlug(input.slug, title) : article.slug,
          updatedBy: input.userId,
          updatedAt: new Date(),
        })
        .where(eq(helpArticles.id, article.id));
      await insertRevision(tx as unknown as typeof db, {
        articleId: article.id,
        productId: input.productId,
        title,
        body,
        translations,
        visibility: input.visibility,
        userId: input.userId,
      });
    });
  } catch (error) {
    return failure(error, "Could not save the article.");
  }

  invalidateAllPublicHelpArticles();

  if (article.status === "published") {
    const sync = await syncHelpCollectionSource({
      collectionId: article.collectionId,
      workspaceId: input.workspaceId,
      productId: input.productId,
    });
    if (!sync.ok) {
      return {
        ok: true,
        id: article.id,
        warning: `Saved, but Juno could not rebuild this collection: ${sync.error}`,
      };
    }
  }
  return { ok: true, id: article.id };
}

export async function setHelpArticleStatus(input: {
  workspaceId: string;
  productId: string;
  articleId: string;
  published: boolean;
}): Promise<HelpMutationResult> {
  const rows = await db
    .select()
    .from(helpArticles)
    .where(
      and(eq(helpArticles.id, input.articleId), eq(helpArticles.productId, input.productId)),
    )
    .limit(1);
  const article = rows[0];
  if (!article) return { ok: false, error: "That article no longer exists." };

  if (!input.published) {
    await pauseHelpCollectionSource({
      collectionId: article.collectionId,
      productId: input.productId,
    });
  }

  await db
    .update(helpArticles)
    .set({
      status: input.published ? "published" : "draft",
      publishedAt: input.published ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(helpArticles.id, article.id));

  invalidateAllPublicHelpArticles();

  const sync = await syncHelpCollectionSource({
    collectionId: article.collectionId,
    workspaceId: input.workspaceId,
    productId: input.productId,
  });
  if (!sync.ok) {
    return {
      ok: true,
      id: article.id,
      warning: `The page is ${input.published ? "published" : "unpublished"}, but Juno could not rebuild: ${sync.error}`,
    };
  }
  return { ok: true, id: article.id };
}

export async function deleteHelpArticle(input: {
  workspaceId: string;
  productId: string;
  articleId: string;
}): Promise<HelpMutationResult> {
  const rows = await db
    .select({ collectionId: helpArticles.collectionId, status: helpArticles.status })
    .from(helpArticles)
    .where(
      and(eq(helpArticles.id, input.articleId), eq(helpArticles.productId, input.productId)),
    )
    .limit(1);
  const article = rows[0];
  if (!article) return { ok: false, error: "That article no longer exists." };

  await pauseHelpCollectionSource({
    collectionId: article.collectionId,
    productId: input.productId,
  });
  await db.delete(helpArticles).where(eq(helpArticles.id, input.articleId));
  invalidateAllPublicHelpArticles();
  await syncHelpCollectionSource({
    collectionId: article.collectionId,
    workspaceId: input.workspaceId,
    productId: input.productId,
  });
  return { ok: true };
}

export async function deleteHelpCollection(input: {
  workspaceId: string;
  productId: string;
  collectionId: string;
}): Promise<HelpMutationResult> {
  await pauseHelpCollectionSource({
    collectionId: input.collectionId,
    productId: input.productId,
  });
  await db
    .delete(knowledgeSources)
    .where(
      and(
        eq(knowledgeSources.productId, input.productId),
        eq(knowledgeSources.kind, "help_collection"),
        eq(knowledgeSources.originId, input.collectionId),
      ),
    );
  await db.delete(helpCollections).where(
    and(
      eq(helpCollections.id, input.collectionId),
      eq(helpCollections.productId, input.productId),
    ),
  );
  return { ok: true };
}

export async function importHelpItems(input: {
  workspaceId: string;
  productId: string;
  userId: string;
  items: HelpImportItem[];
  publish?: boolean;
}): Promise<HelpMutationResult & { imported?: number; warnings?: string[] }> {
  if (input.items.length === 0) return { ok: false, error: "Nothing to import." };
  const warnings: string[] = [];
  const touchedCollections = new Set<string>();

  for (const item of input.items) {
    const collectionName = clean(item.collection, 120) || "Help center";
    const collectionSlug = cleanSlug(collectionName, "help-center");
    const collection = await db
      .select({ id: helpCollections.id })
      .from(helpCollections)
      .where(
        and(
          eq(helpCollections.productId, input.productId),
          or(
            eq(helpCollections.slug, collectionSlug),
            eq(helpCollections.name, collectionName),
          ),
        ),
      )
      .limit(1);

    let collectionId = collection[0]?.id;
    if (!collectionId) {
      const created = await createHelpCollection({
        workspaceId: input.workspaceId,
        productId: input.productId,
        userId: input.userId,
        name: collectionName,
        slug: collectionSlug,
        visibility: item.visibility === "internal" ? "internal" : "public",
      });
      if (!created.ok || !created.id) {
        warnings.push(created.ok ? "Could not create a collection." : created.error);
        continue;
      }
      collectionId = created.id;
    }
    touchedCollections.add(collectionId);

    const existing = await db
      .select({ id: helpArticles.id, status: helpArticles.status })
      .from(helpArticles)
      .where(
        and(
          eq(helpArticles.collectionId, collectionId),
          eq(helpArticles.slug, cleanSlug(item.slug, item.title)),
        ),
      )
      .limit(1);

    if (existing[0]) {
      if (existing[0].status === "published") {
        await pauseHelpCollectionSource({
          collectionId,
          productId: input.productId,
        });
      }
      const saved = await saveHelpArticle({
        workspaceId: input.workspaceId,
        productId: input.productId,
        userId: input.userId,
        articleId: existing[0].id,
        title: item.title,
        body: item.body,
        visibility: item.visibility,
        slug: item.slug,
      });
      if (!saved.ok) warnings.push(saved.error);
      else if (saved.warning) warnings.push(saved.warning);
    } else {
      const created = await createHelpArticle({
        workspaceId: input.workspaceId,
        productId: input.productId,
        userId: input.userId,
        collectionId,
        title: item.title,
        slug: item.slug,
        body: item.body,
        visibility: item.visibility,
      });
      if (!created.ok) warnings.push(created.error);
    }
  }

  if (input.publish) {
    for (const collectionId of touchedCollections) {
      const articleRows = await db
        .select({ id: helpArticles.id })
        .from(helpArticles)
        .where(
          and(
            eq(helpArticles.collectionId, collectionId),
            eq(helpArticles.productId, input.productId),
            eq(helpArticles.status, "draft"),
          ),
        );
      for (const article of articleRows) {
        await setHelpArticleStatus({
          workspaceId: input.workspaceId,
          productId: input.productId,
          articleId: article.id,
          published: true,
        });
      }
      await syncHelpCollectionSource({
        collectionId,
        workspaceId: input.workspaceId,
        productId: input.productId,
      });
    }
  }

  return { ok: true, imported: input.items.length, warnings };
}

export async function importHelpFromUrl(input: {
  workspaceId: string;
  productId: string;
  url: string;
  collection?: string;
}): Promise<{ ok: true; item: HelpImportItem } | { ok: false; error: string }> {
  let target: URL;
  try {
    target = await assertCrawlableUrl(input.url.trim());
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
      headers: { accept: "text/html,text/markdown,text/plain" },
    });
    if (!response.ok) return { ok: false, error: `The URL returned ${response.status}.` };
    const content = await response.text();
    if (content.length > 2_000_000) return { ok: false, error: "The URL is too large." };
    const parsed = parseDocument({
      filename: new URL(target).pathname,
      mimeType: response.headers.get("content-type"),
      content,
    });
    return {
      ok: true,
      item: {
        title: parsed.title?.slice(0, 200) || target.hostname,
        slug: cleanSlug(parsed.title ?? target.pathname, "imported-article"),
        body: parsed.text,
        collection: input.collection?.trim() || "Help center",
        visibility: "public",
      },
    };
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
}): Promise<PublicHelpProduct | null> {
  const rows = await db
    .select({
      workspaceId: workspaces.id,
      productId: products.id,
      workspaceSlug: workspaces.slug,
      productSlug: products.slug,
      workspaceName: workspaces.name,
      productName: products.name,
      contentTranslationEnabled: sql<boolean>`coalesce(${workspaceBranding.contentTranslationEnabled}, false)`,
    })
    .from(products)
    .innerJoin(workspaces, eq(products.workspaceId, workspaces.id))
    .leftJoin(workspaceBranding, eq(workspaceBranding.workspaceId, workspaces.id))
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

export async function getPublicHelpIndex(input: {
  workspaceSlug: string;
  productSlug: string;
  locale?: string | undefined;
}): Promise<{ product: PublicHelpProduct; collections: PublicHelpCollection[] } | null> {
  const product = await resolvePublicProduct(input);
  if (!product) return null;

  const [collections, articles] = await Promise.all([
    db
      .select()
      .from(helpCollections)
      .where(
        and(
          eq(helpCollections.productId, product.productId),
          eq(helpCollections.visibility, "public"),
        ),
      )
      .orderBy(asc(helpCollections.sortOrder), asc(helpCollections.name)),
    db
      .select({
        id: helpArticles.id,
        collectionId: helpArticles.collectionId,
        slug: helpArticles.slug,
        title: helpArticles.title,
        translations: helpArticles.translations,
        updatedAt: helpArticles.updatedAt,
      })
      .from(helpArticles)
      .where(
        and(
          eq(helpArticles.productId, product.productId),
          eq(helpArticles.status, "published"),
          eq(helpArticles.visibility, "public"),
        ),
      )
      .orderBy(asc(helpArticles.title)),
  ]);

  return {
    product,
    collections: collections.map((collection) => ({
      id: collection.id,
      slug: collection.slug,
      name: collection.name,
      description: collection.description,
      articles: articles
        .filter((article) => article.collectionId === collection.id)
        .map(({ id, slug, title, updatedAt, translations }) => ({
          id,
          slug,
          ...translatedHelp(
            { title, body: "", translations },
            input.locale,
            product.contentTranslationEnabled,
          ),
          updatedAt,
        })),
    })),
  };
}

export async function getPublicHelpCollection(input: {
  workspaceSlug: string;
  productSlug: string;
  collectionSlug: string;
  locale?: string;
}): Promise<{
  product: PublicHelpProduct;
  collection: PublicHelpCollection;
} | null> {
  const page = await getPublicHelpIndex(input);
  if (!page) return null;
  const collection = page.collections.find((entry) => entry.slug === input.collectionSlug);
  return collection ? { product: page.product, collection } : null;
}

/**
 * Immutable half of a published help article: the row and its collection.
 * Translation and the product's switches are applied after the cache read, so
 * one entry serves every locale and a visibility change still applies at once.
 * Invalidation is wired into save/publish/unpublish/delete below.
 */
async function loadPublicHelpArticleBase(
  productId: string,
  collectionSlug: string,
  articleSlug: string,
) {
  return cachedPublicPayload(
    publicPayloadKeys.helpArticleEntry(productId, collectionSlug, articleSlug),
    async () => {
      const rows = await db
        .select({
          id: helpArticles.id,
          slug: helpArticles.slug,
          title: helpArticles.title,
          body: helpArticles.body,
          translations: helpArticles.translations,
          updatedAt: helpArticles.updatedAt,
          collectionSlug: helpCollections.slug,
          collectionName: helpCollections.name,
        })
        .from(helpArticles)
        .innerJoin(helpCollections, eq(helpArticles.collectionId, helpCollections.id))
        .where(
          and(
            eq(helpArticles.productId, productId),
            eq(helpArticles.slug, articleSlug),
            eq(helpArticles.status, "published"),
            eq(helpArticles.visibility, "public"),
            eq(helpCollections.slug, collectionSlug),
            eq(helpCollections.visibility, "public"),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },
  );
}

export async function getPublicHelpArticle(input: {
  workspaceSlug: string;
  productSlug: string;
  collectionSlug: string;
  articleSlug: string;
  locale?: string;
}): Promise<{ product: PublicHelpProduct; article: PublicHelpArticle } | null> {
  const product = await resolvePublicProduct(input);
  if (!product) return null;

  const row = await loadPublicHelpArticleBase(
    product.productId,
    input.collectionSlug,
    input.articleSlug,
  );
  if (!row) return null;

  return {
    product,
    article: {
      id: row.id,
      slug: row.slug,
      ...translatedHelp(row, input.locale, product.contentTranslationEnabled),
      updatedAt: row.updatedAt,
      collection: { slug: row.collectionSlug, name: row.collectionName },
    },
  };
}

export async function searchPublicHelp(input: {
  workspaceSlug: string;
  productSlug: string;
  query: string;
  locale?: string | undefined;
}): Promise<{ product: PublicHelpProduct; hits: HelpSearchHit[] } | null> {
  const product = await resolvePublicProduct(input);
  if (!product) return null;
  const query = input.query.trim().slice(0, 100);
  if (query.length < 2) return { product, hits: [] };

  const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
  const rows = await db
    .select({
      id: helpArticles.id,
      slug: helpArticles.slug,
      title: helpArticles.title,
      body: helpArticles.body,
      translations: helpArticles.translations,
      collectionSlug: helpCollections.slug,
      collectionName: helpCollections.name,
    })
    .from(helpArticles)
    .innerJoin(helpCollections, eq(helpArticles.collectionId, helpCollections.id))
    .where(
      and(
        eq(helpArticles.productId, product.productId),
        eq(helpArticles.status, "published"),
        eq(helpArticles.visibility, "public"),
        eq(helpCollections.visibility, "public"),
        or(
          ilike(helpArticles.title, pattern),
          ilike(helpArticles.body, pattern),
          sql`${helpArticles.translations}::text ilike ${pattern}`,
        ),
      ),
    )
    .orderBy(asc(helpArticles.title))
    .limit(20);

  return {
    product,
    hits: rows.map((row) => {
      const copy = translatedHelp(
        row,
        input.locale,
        product.contentTranslationEnabled,
      );
      return {
        id: row.id,
        slug: row.slug,
        title: copy.title,
        collectionSlug: row.collectionSlug,
        collectionName: row.collectionName,
        excerpt: copy.body.replace(/\s+/g, " ").slice(0, 180),
      };
    }),
  };
}
