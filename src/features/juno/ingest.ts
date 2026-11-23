import "server-only";

import { and, eq, ne } from "drizzle-orm";

import { db } from "@/db";
import {
  knowledgeChunks,
  knowledgePages,
  knowledgeSources,
  knowledgeVersions,
} from "@/db/schema/knowledge";

import { embedDocuments } from "./embedding";
import { chunkText, normalizeText } from "./text";

/**
 * Build one knowledge version.
 *
 * Pages are chunked and embedded before the transaction opens, so a slow
 * provider never holds row locks. The transaction then swaps the version in:
 * the old live version is only superseded after the new rows are complete, so
 * retrieval either sees the previous package or the new one, never a partial
 * index.
 */

export type IngestPage = {
  title: string;
  url: string | null;
  content: string;
};

type PreparedPage = {
  title: string;
  url: string | null;
  content: string;
  chunks: { content: string; embedding: number[] }[];
};

export async function ingestKnowledgeVersion(input: {
  sourceId: string;
  productId: string;
  versionId: string;
  pages: IngestPage[];
  now?: Date;
}): Promise<{ pageCount: number; chunkCount: number }> {
  const now = input.now ?? new Date();

  const prepared: PreparedPage[] = [];
  const chunkTexts: string[] = [];

  for (const page of input.pages) {
    const content = normalizeText(page.content);
    if (content === "") continue;
    const pieces = chunkText(content);
    if (pieces.length === 0) continue;
    const entry: PreparedPage = {
      title: page.title.trim().slice(0, 200) || "Untitled",
      url: page.url,
      content,
      chunks: [],
    };
    for (const piece of pieces) {
      chunkTexts.push(piece);
      entry.chunks.push({ content: piece, embedding: [] });
    }
    prepared.push(entry);
  }

  if (prepared.length === 0) {
    throw new Error("The source produced no readable text.");
  }

  const { vectors, model } = await embedDocuments(chunkTexts);
  let vectorIndex = 0;
  for (const page of prepared) {
    for (const chunk of page.chunks) {
      chunk.embedding = vectors[vectorIndex] ?? [];
      vectorIndex += 1;
    }
  }

  const chunkCount = chunkTexts.length;

  return db.transaction(async (tx) => {
    const sources = await tx
      .select()
      .from(knowledgeSources)
      .where(
        and(
          eq(knowledgeSources.id, input.sourceId),
          eq(knowledgeSources.productId, input.productId),
        ),
      )
      .limit(1)
      .for("update");

    if (!sources[0]) throw new Error("That knowledge source no longer exists.");

    // Rebuilding a version replaces its pages; chunks cascade with them.
    await tx
      .delete(knowledgePages)
      .where(eq(knowledgePages.versionId, input.versionId));

    for (let ordinal = 0; ordinal < prepared.length; ordinal += 1) {
      const page = prepared[ordinal];
      if (!page) continue;
      const inserted = await tx
        .insert(knowledgePages)
        .values({
          versionId: input.versionId,
          sourceId: input.sourceId,
          productId: input.productId,
          title: page.title,
          url: page.url,
          content: page.content.slice(0, 200_000),
          ordinal,
          createdAt: now,
        })
        .returning({ id: knowledgePages.id });

      const pageId = inserted[0]?.id;
      if (!pageId) throw new Error("Could not store a knowledge page.");

      if (page.chunks.length > 0) {
        await tx.insert(knowledgeChunks).values(
          page.chunks.map((chunk, index) => ({
            pageId,
            versionId: input.versionId,
            sourceId: input.sourceId,
            productId: input.productId,
            ordinal: index,
            content: chunk.content,
            embedding: chunk.embedding,
            embeddingModel: model,
            createdAt: now,
          })),
        );
      }
    }

    await tx
      .update(knowledgeVersions)
      .set({
        status: "live",
        pageCount: prepared.length,
        chunkCount,
        error: null,
        publishedAt: now,
      })
      .where(eq(knowledgeVersions.id, input.versionId));

    await tx
      .update(knowledgeVersions)
      .set({ status: "superseded" })
      .where(
        and(
          eq(knowledgeVersions.sourceId, input.sourceId),
          eq(knowledgeVersions.status, "live"),
          ne(knowledgeVersions.id, input.versionId),
        ),
      );

    await tx
      .update(knowledgeSources)
      .set({
        status: "live",
        activeVersionId: input.versionId,
        pageCount: prepared.length,
        lastError: null,
        updatedAt: now,
      })
      .where(eq(knowledgeSources.id, input.sourceId));

    return { pageCount: prepared.length, chunkCount };
  });
}

/**
 * Record a failed build.
 *
 * A source that still has a live version keeps serving it and stays `live` for
 * retrieval; only the error text is updated. A first build with nothing to
 * serve becomes `error`.
 */
export async function failKnowledgeVersion(input: {
  sourceId: string;
  productId: string;
  versionId: string;
  error: string;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();
  const message = input.error.slice(0, 500);

  await db
    .update(knowledgeVersions)
    .set({ status: "failed", error: message })
    .where(
      and(
        eq(knowledgeVersions.id, input.versionId),
        eq(knowledgeVersions.productId, input.productId),
      ),
    );

  const sources = await db
    .select({
      activeVersionId: knowledgeSources.activeVersionId,
      lastError: knowledgeSources.lastError,
    })
    .from(knowledgeSources)
    .where(
      and(
        eq(knowledgeSources.id, input.sourceId),
        eq(knowledgeSources.productId, input.productId),
      ),
    )
    .limit(1);

  const source = sources[0];
  if (!source) return;

  await db
    .update(knowledgeSources)
    .set({
      status: source.activeVersionId ? "live" : "error",
      lastError: message,
      updatedAt: now,
    })
    .where(eq(knowledgeSources.id, input.sourceId));
}
