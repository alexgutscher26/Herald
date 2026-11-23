import { cosineSimilarity } from "./embedding";
import { lexicalScore } from "./text";

/**
 * Blend lexical overlap with vector similarity.
 *
 * Lexical matching dominates: at beta scale a workspace has a handful of
 * sources, and an exact product term ("CSV export") is a stronger signal than
 * a nearby embedding. The vector term still lets a paraphrase match when the
 * words differ. The result is capped at 1.
 */

export const LEXICAL_WEIGHT = 0.6;
export const VECTOR_WEIGHT = 0.4;

export type RankableChunk = {
  id: string;
  content: string;
  embedding: number[];
};

export type ScoredChunk<T extends RankableChunk> = {
  chunk: T;
  score: number;
  lexical: number;
  vector: number;
};

export function rankChunks<T extends RankableChunk>(
  query: string,
  chunks: T[],
  queryEmbedding: number[],
): ScoredChunk<T>[] {
  return chunks
    .map((chunk) => {
      const lexical = lexicalScore(query, chunk.content);
      const vector = Math.max(0, cosineSimilarity(queryEmbedding, chunk.embedding));
      const score = Math.min(
        1,
        LEXICAL_WEIGHT * lexical + VECTOR_WEIGHT * vector,
      );
      return { chunk, score, lexical, vector };
    })
    .sort((left, right) => right.score - left.score);
}
