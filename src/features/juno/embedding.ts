import { getAiEmbeddingConfig } from "@/lib/env";
import { logEvent, serializeError } from "@/lib/logger";

import { tokenize } from "./text";

/**
 * Embeddings without a vector database.
 *
 * When `AI_EMBEDDING_MODEL` is configured, documents and queries go through the
 * OpenAI-compatible `/embeddings` endpoint. Otherwise a deterministic local
 * feature-hash embedding is used: tokens are hashed into a fixed number of
 * dimensions (with a signed bucket so unrelated collisions partially cancel)
 * and term frequencies are damped, then the vector is L2-normalized.
 *
 * The model name is stored beside every chunk, so changing providers cannot
 * silently compare vectors from two different spaces: retrieval only reads
 * chunks written by the current model.
 */

export const LOCAL_EMBEDDING_MODEL = "herald-hash-v1";
export const EMBEDDING_DIMENSIONS = 256;
const MAX_EMBEDDING_CHARS = 8_000;
const EMBEDDING_TIMEOUT_MS = 30_000;

export type EmbeddingResult = { vectors: number[][]; model: string };

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function normalizeVector(vector: number[]): number[] {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const norm = Math.sqrt(sum);
  if (norm === 0) return vector;
  return vector.map((value) => value / norm);
}

export function hashEmbedding(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const counts = new Map<string, number>();

  for (const token of tokenize(text)) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  for (const [token, count] of counts) {
    const hash = fnv1a(token);
    const bucket = hash % EMBEDDING_DIMENSIONS;
    const sign = (hash >>> 16) % 2 === 0 ? 1 : -1;
    const weight = 1 + Math.log(count);
    vector[bucket] = (vector[bucket] ?? 0) + sign * weight;
  }

  return normalizeVector(vector);
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  const similarity = dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
  return Number.isFinite(similarity) ? Math.max(-1, Math.min(1, similarity)) : 0;
}

function embeddingsUrl(base: string): string {
  return `${base.replace(/\/+$/, "")}/embeddings`;
}

async function providerEmbeddings(texts: string[]): Promise<number[][]> {
  const config = getAiEmbeddingConfig();
  if (!config) throw new Error("Embeddings are not configured.");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EMBEDDING_TIMEOUT_MS);

  try {
    const response = await fetch(embeddingsUrl(config.AI_API_URL), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.AI_API_KEY
          ? { authorization: `Bearer ${config.AI_API_KEY}` }
          : {}),
      },
      body: JSON.stringify({
        model: config.AI_EMBEDDING_MODEL,
        input: texts.map((text) => text.slice(0, MAX_EMBEDDING_CHARS)),
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      logEvent("error", "juno.embedding_failed", {
        status: response.status,
        model: config.AI_EMBEDDING_MODEL,
      });
      throw new Error("The embedding provider did not accept the document.");
    }

    const payload = (await response.json().catch(() => null)) as
      | { data?: { embedding?: unknown }[] }
      | null;

    const vectors = payload?.data?.map((entry) => entry.embedding);
    if (
      !vectors ||
      vectors.length !== texts.length ||
      vectors.some(
        (vector) =>
          !Array.isArray(vector) ||
          vector.length === 0 ||
          vector.some((value) => typeof value !== "number" || !Number.isFinite(value)),
      )
    ) {
      throw new Error("The embedding provider returned an invalid response.");
    }

    return (vectors as number[][]).map((vector) => normalizeVector(vector));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("The embedding")) throw error;
    logEvent("error", "juno.embedding_failed", { error: serializeError(error) });
    throw new Error("The embedding provider is unavailable.");
  } finally {
    clearTimeout(timeout);
  }
}

/** Which model new designs use right now; retrieval reads only this one. */
export function currentEmbeddingModel(): string {
  return getAiEmbeddingConfig()?.AI_EMBEDDING_MODEL ?? LOCAL_EMBEDDING_MODEL;
}

export async function embedDocuments(texts: string[]): Promise<EmbeddingResult> {
  if (texts.length === 0) return { vectors: [], model: currentEmbeddingModel() };

  const config = getAiEmbeddingConfig();
  if (!config) {
    return { vectors: texts.map(hashEmbedding), model: LOCAL_EMBEDDING_MODEL };
  }

  return {
    vectors: await providerEmbeddings(texts),
    model: config.AI_EMBEDDING_MODEL,
  };
}

export async function embedQuery(text: string): Promise<number[]> {
  const result = await embedDocuments([text]);
  return result.vectors[0] ?? [];
}
