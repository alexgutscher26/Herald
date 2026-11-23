import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  helpArticles,
  helpCollections,
  knowledgeSources,
  knowledgeVersions,
} from "@/db/schema";
import { failKnowledgeVersion, ingestKnowledgeVersion } from "@/features/juno/ingest";

/**
 * Project a help collection into the existing versioned knowledge pipeline.
 *
 * Article rows remain the source of truth. Publishing builds a knowledge
 * version from only published + public articles. Unpublishing pauses the
 * source and supersedes its live version before the article changes, so a
 * stale answer cannot outlive the page.
 */

async function findSource(collectionId: string, productId: string) {
  const rows = await db
    .select()
    .from(knowledgeSources)
    .where(
      and(
        eq(knowledgeSources.productId, productId),
        eq(knowledgeSources.kind, "help_collection"),
        eq(knowledgeSources.originId, collectionId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function pauseHelpCollectionSource(input: {
  collectionId: string;
  productId: string;
}): Promise<void> {
  const source = await findSource(input.collectionId, input.productId);
  if (!source) return;

  await db.transaction(async (tx) => {
    await tx
      .update(knowledgeVersions)
      .set({ status: "superseded" })
      .where(
        and(eq(knowledgeVersions.sourceId, source.id), eq(knowledgeVersions.status, "live")),
      );
    await tx
      .update(knowledgeSources)
      .set({ status: "paused", activeVersionId: null, updatedAt: new Date() })
      .where(eq(knowledgeSources.id, source.id));
  });
}

export async function syncHelpCollectionSource(input: {
  collectionId: string;
  workspaceId: string;
  productId: string;
  now?: Date;
}): Promise<{ ok: true; pageCount: number } | { ok: false; error: string }> {
  const now = input.now ?? new Date();
  const collectionRows = await db
    .select()
    .from(helpCollections)
    .where(
      and(
        eq(helpCollections.id, input.collectionId),
        eq(helpCollections.workspaceId, input.workspaceId),
        eq(helpCollections.productId, input.productId),
      ),
    )
    .limit(1);

  const collection = collectionRows[0];
  if (!collection) return { ok: false, error: "That collection no longer exists." };

  if (collection.visibility !== "public") {
    await pauseHelpCollectionSource({
      collectionId: collection.id,
      productId: input.productId,
    });
    return { ok: true, pageCount: 0 };
  }

  const articles = await db
    .select({
      slug: helpArticles.slug,
      title: helpArticles.title,
      body: helpArticles.body,
    })
    .from(helpArticles)
    .where(
      and(
        eq(helpArticles.collectionId, collection.id),
        eq(helpArticles.productId, input.productId),
        eq(helpArticles.status, "published"),
        eq(helpArticles.visibility, "public"),
      ),
    )
    .orderBy(asc(helpArticles.slug));

  let source = await findSource(collection.id, input.productId);
  if (!source) {
    const inserted = await db
      .insert(knowledgeSources)
      .values({
        workspaceId: input.workspaceId,
        productId: input.productId,
        name: `Help: ${collection.name}`.slice(0, 80),
        kind: "help_collection",
        originId: collection.id,
        status: "processing",
      })
      .returning({ id: knowledgeSources.id });
    const sourceId = inserted[0]?.id;
    if (!sourceId) return { ok: false, error: "Could not create the help knowledge source." };
    const created = await db
      .select()
      .from(knowledgeSources)
      .where(eq(knowledgeSources.id, sourceId))
      .limit(1);
    source = created[0] ?? null;
  }
  if (!source) return { ok: false, error: "Could not create the help knowledge source." };

  if (articles.length === 0) {
    await pauseHelpCollectionSource({
      collectionId: collection.id,
      productId: input.productId,
    });
    return { ok: true, pageCount: 0 };
  }

  const pathRows = await db.execute(sql`
    SELECT w."slug" AS workspace_slug, p."slug" AS product_slug
    FROM "help_collections" c
    INNER JOIN "workspaces" w ON w."id" = c."workspace_id"
    INNER JOIN "products" p ON p."id" = c."product_id"
    WHERE c."id" = ${collection.id}
    LIMIT 1
  `);
  const path = pathRows.rows[0] as
    | { workspace_slug?: string; product_slug?: string }
    | undefined;
  const workspaceSlug = path?.workspace_slug ?? "workspace";
  const productSlug = path?.product_slug ?? "product";

  const version = await db
    .insert(knowledgeVersions)
    .values({
      sourceId: source.id,
      productId: input.productId,
      status: "building",
    })
    .returning({ id: knowledgeVersions.id });
  const versionId = version[0]?.id;
  if (!versionId) return { ok: false, error: "Could not start a knowledge version." };

  try {
    const result = await ingestKnowledgeVersion({
      sourceId: source.id,
      productId: input.productId,
      versionId,
      now,
      pages: articles.map((article) => ({
        title: article.title,
        url: `/p/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(
          productSlug,
        )}/help/${encodeURIComponent(collection.slug)}/${encodeURIComponent(article.slug)}`,
        content: `${article.title}\n\n${article.body}`,
      })),
    });
    return { ok: true, pageCount: result.pageCount };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not publish help content.";
    await failKnowledgeVersion({
      sourceId: source.id,
      productId: input.productId,
      versionId,
      error: message,
    });
    return { ok: false, error: message };
  }
}
