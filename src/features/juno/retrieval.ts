import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  knowledgeChunks,
  knowledgePages,
  knowledgeSources,
  knowledgeVersions,
} from "@/db/schema/knowledge";

import { currentEmbeddingModel, embedQuery } from "./embedding";
import { rankChunks } from "./rank";

/**
 * Retrieve chunks from live, unpaused sources.
 *
 * Only the current embedding model is read: a provider change cannot compare
 * vectors from two spaces. At beta scale (five sources) loading the live
 * chunks and ranking in the application is predictable and keeps retrieval
 * independent of a vector extension; the cap prevents an accidental full-table
 * scan from becoming an unbounded memory read.
 */

const MAX_CANDIDATES = 2_000;

/**
 * Who is asking. Public answers (widget, email, public help) may only read
 * `public` sources; `internal` is reserved for a team-only run such as the
 * evaluation harness and can never be selected by a customer request.
 */
export type KnowledgeAudience = "public" | "internal";

export type RetrievedChunk = {
  chunkId: string;
  sourceId: string;
  sourceName: string;
  title: string;
  url: string | null;
  content: string;
  score: number;
  lexical: number;
  vector: number;
};

export async function retrieveKnowledge(input: {
  productId: string;
  query: string;
  limit?: number;
  audience?: KnowledgeAudience;
}): Promise<RetrievedChunk[]> {
  const audience = input.audience ?? "public";
  const rows = await db
    .select({
      id: knowledgeChunks.id,
      content: knowledgeChunks.content,
      embedding: knowledgeChunks.embedding,
      sourceId: knowledgeSources.id,
      sourceName: knowledgeSources.name,
      title: knowledgePages.title,
      url: knowledgePages.url,
    })
    .from(knowledgeChunks)
    .innerJoin(knowledgePages, eq(knowledgeChunks.pageId, knowledgePages.id))
    .innerJoin(knowledgeVersions, eq(knowledgeChunks.versionId, knowledgeVersions.id))
    .innerJoin(knowledgeSources, eq(knowledgeChunks.sourceId, knowledgeSources.id))
    .where(
      and(
        eq(knowledgeChunks.productId, input.productId),
        eq(knowledgeChunks.embeddingModel, currentEmbeddingModel()),
        eq(knowledgeVersions.status, "live"),
        eq(knowledgeSources.status, "live"),
        audience === "public"
          ? eq(knowledgeSources.visibility, "public")
          : undefined,
      ),
    )
    .limit(MAX_CANDIDATES);

  if (rows.length === 0) return [];

  const queryEmbedding = await embedQuery(input.query);
  const ranked = rankChunks(
    input.query,
    rows.map((row) => ({
      id: row.id,
      content: row.content,
      embedding: row.embedding,
      sourceId: row.sourceId,
      sourceName: row.sourceName,
      title: row.title,
      url: row.url,
    })),
    queryEmbedding,
  );

  return ranked
    .filter((entry) => entry.score > 0)
    .slice(0, Math.min(Math.max(input.limit ?? 6, 1), 12))
    .map((entry) => ({
      chunkId: entry.chunk.id,
      sourceId: entry.chunk.sourceId,
      sourceName: entry.chunk.sourceName,
      title: entry.chunk.title,
      url: entry.chunk.url,
      content: entry.chunk.content,
      score: Number(entry.score.toFixed(3)),
      lexical: Number(entry.lexical.toFixed(3)),
      vector: Number(entry.vector.toFixed(3)),
    }));
}
