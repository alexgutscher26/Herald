import type { JunoDuplicateMode } from "@/db/schema/knowledge";

/**
 * Duplicate matching policy.
 *
 * The matcher is deterministic, so the decision can be explained and tested
 * without an LLM. Assisted mode never applies a merge; automatic mode only
 * merges a match at or above the high-confidence line. Everything between the
 * suggestion floor and that line goes to the team queue.
 */

export const DUPLICATE_SUGGESTION_FLOOR = 0.2;
export const DUPLICATE_AUTO_MERGE_SCORE = 0.8;

/**
 * Combine the lexical and embedding signals. The higher one wins, so a
 * paraphrase that shares no words can still surface, while an exact shared
 * term remains a strong signal even when the vectors are unhelpful.
 */
export function duplicateMatchScore(lexical: number, semantic: number): number {
  if (!Number.isFinite(lexical)) return Number.isFinite(semantic) ? semantic : 0;
  if (!Number.isFinite(semantic)) return lexical;
  return Math.max(0, Math.min(1, Math.max(lexical, semantic)));
}

export type DuplicateMatch = {
  id: string;
  title: string;
  score: number;
};

export type DuplicateDecision =
  | { action: "none" }
  | {
      action: "queue";
      match: DuplicateMatch;
      mode: Exclude<JunoDuplicateMode, "off">;
    }
  | { action: "merge"; match: DuplicateMatch; mode: "automatic" };

export function decideDuplicate(input: {
  mode: JunoDuplicateMode;
  matches: DuplicateMatch[];
}): DuplicateDecision {
  if (input.mode === "off") return { action: "none" };

  const top = [...input.matches]
    .filter((match) => Number.isFinite(match.score))
    .sort((left, right) => right.score - left.score)[0];

  if (!top || top.score < DUPLICATE_SUGGESTION_FLOOR) return { action: "none" };

  if (input.mode === "automatic" && top.score >= DUPLICATE_AUTO_MERGE_SCORE) {
    return { action: "merge", match: top, mode: "automatic" };
  }

  return {
    action: "queue",
    match: top,
    mode: input.mode === "automatic" ? "automatic" : "assisted",
  };
}
