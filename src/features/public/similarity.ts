/**
 * Duplicate and similar-request matching.
 *
 * Pure so the submit page, the suggestion endpoint and the detail page rank
 * results the same way, and so the scoring can be tested without a database.
 * Matching is word overlap rather than a full-text index because it runs on a
 * bounded candidate set and must treat a user's half-typed title as useful
 * input.
 */

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "can",
  "could",
  "do",
  "does",
  "for",
  "from",
  "get",
  "has",
  "have",
  "how",
  "i",
  "if",
  "in",
  "is",
  "it",
  "its",
  "just",
  "me",
  "my",
  "need",
  "not",
  "of",
  "on",
  "or",
  "our",
  "please",
  "should",
  "so",
  "some",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "to",
  "too",
  "us",
  "want",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "will",
  "with",
  "would",
  "you",
  "your",
]);

export const MAX_SIMILARITY_TOKENS = 24;
export const SUGGESTION_MIN_SCORE = 0.12;

/**
 * Detail pages show a shorter list than the submit-time suggester, and only
 * when the match is strong enough to be useful. A weak "similar" list is worse
 * than none: it sends readers away from the request they chose.
 */
export const DETAIL_SIMILAR_MIN_SCORE = 0.22;
export const DETAIL_SIMILAR_LIMIT = 3;

/** Lowercase alphanumeric words, without stopwords or very short tokens. */
export function tokenize(value: string): string[] {
  const tokens = new Set<string>();

  for (const raw of value.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3) continue;
    if (STOPWORDS.has(raw)) continue;
    tokens.add(raw);
    if (tokens.size >= MAX_SIMILARITY_TOKENS) break;
  }

  return [...tokens];
}

export type SimilarityInput = {
  title: string;
  body: string;
};

/**
 * Score two requests from 0 to 1.
 *
 * Shared title words count double: two requests called "Dark mode" and
 * "Dark mode for the editor" are more likely duplicates than two bodies that
 * both mention "editor". The score is normalised by the candidate's tokens so
 * a long post does not match everything by sheer length.
 */
export function similarityScore(left: SimilarityInput, right: SimilarityInput): number {
  const leftTokens = new Set(tokenize(`${left.title} ${left.body}`));
  if (leftTokens.size === 0) return 0;

  const rightTitle = new Set(tokenize(right.title));
  const rightTokens = new Set(tokenize(`${right.title} ${right.body}`));
  if (rightTokens.size === 0) return 0;

  let shared = 0;
  let weight = 0;
  for (const token of rightTokens) {
    if (!leftTokens.has(token)) continue;
    shared += rightTitle.has(token) ? 2 : 1;
  }
  for (const token of rightTokens) weight += rightTitle.has(token) ? 2 : 1;

  return weight === 0 ? 0 : Math.min(1, shared / Math.max(weight, leftTokens.size));
}

export type RankableRequest = SimilarityInput & { id: string };

/** Rank candidates against one query, best first, dropping weak matches. */
export function rankSimilar<T extends RankableRequest>(
  query: SimilarityInput,
  candidates: T[],
  options: { limit: number; excludeIds?: Iterable<string>; minScore?: number },
): T[] {
  const excluded = new Set(options.excludeIds ?? []);
  const minScore = options.minScore ?? SUGGESTION_MIN_SCORE;

  return candidates
    .filter((candidate) => !excluded.has(candidate.id))
    .map((candidate) => ({ candidate, score: similarityScore(query, candidate) }))
    .filter((entry) => entry.score >= minScore)
    .sort((left, right) => right.score - left.score)
    .slice(0, options.limit)
    .map((entry) => entry.candidate);
}

/** Single-line excerpt for a suggestion card. */
export function excerpt(body: string, length = 140): string {
  const compact = body.replace(/\s+/g, " ").trim();
  return compact.length <= length ? compact : `${compact.slice(0, length - 1).trimEnd()}…`;
}
