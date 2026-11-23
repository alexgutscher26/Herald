import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { junoSettings } from "@/db/schema/knowledge";

import { sanitizeModelInput } from "./guardrails";
import {
  retrieveKnowledge,
  type KnowledgeAudience,
  type RetrievedChunk,
} from "./retrieval";

/**
 * Dry run: retrieval only, no answer generation.
 *
 * This calls the same retrieval path as a real answer, so scores and the
 * confidence floor are comparable, but it never calls the chat model and never
 * records usage. An embedding endpoint may still be called when configured;
 * that is retrieval, not generation, and is the only way the scores match a
 * production answer.
 */

export type JunoDryRunResult = {
  query: string;
  audience: KnowledgeAudience;
  confidenceFloor: number;
  clearsFloor: boolean;
  results: Array<{
    rank: number;
    title: string;
    sourceName: string;
    url: string | null;
    score: number;
    lexical: number;
    vector: number;
    excerpt: string;
  }>;
};

export async function dryRunKnowledgeRetrieval(input: {
  productId: string;
  query: string;
  audience?: KnowledgeAudience;
}): Promise<JunoDryRunResult> {
  const query = sanitizeModelInput(input.query).slice(0, 500);
  if (query.length < 2) {
    throw new Error("Enter a question with at least two characters.");
  }

  const audience = input.audience ?? "public";
  const settingRows = await db
    .select({ confidenceFloor: junoSettings.confidenceFloor })
    .from(junoSettings)
    .where(eq(junoSettings.productId, input.productId))
    .limit(1);
  const confidenceFloor = settingRows[0]?.confidenceFloor ?? 0.35;

  const results: RetrievedChunk[] = await retrieveKnowledge({
    productId: input.productId,
    query,
    limit: 8,
    audience,
  });

  return {
    query,
    audience,
    confidenceFloor,
    clearsFloor: Boolean(results[0] && results[0].score >= confidenceFloor),
    results: results.map((chunk, index) => ({
      rank: index + 1,
      title: chunk.title,
      sourceName: chunk.sourceName,
      url: chunk.url,
      score: chunk.score,
      lexical: chunk.lexical,
      vector: chunk.vector,
      excerpt: chunk.content.slice(0, 500),
    })),
  };
}
