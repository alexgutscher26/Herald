import type { FeedbackStatus } from "@/types";

/**
 * Workflow prompts for the internal roadmap.
 *
 * These are suggestions, not automation: nothing is moved or closed, and the
 * page recomputes them from the same row the kanban already renders. The
 * thresholds are deliberately conservative so a busy board is not covered in
 * warnings, and they are exported so a future settings UI can tune them
 * without changing the rules in two places.
 */

export const ROADMAP_PROMPT_THRESHOLDS = {
  plannedStaleDays: 45,
  inProgressStaleDays: 21,
  lowTractionReviewDays: 14,
  lowTractionVotes: 2,
} as const;

const DAY_MS = 86_400_000;

export type RoadmapPromptKind =
  | "stale_planned"
  | "stale_in_progress"
  | "low_traction_review";

export type RoadmapPrompt = {
  kind: RoadmapPromptKind;
  label: string;
  message: string;
  suggestedAction: string;
};

function plural(value: number, singular: string): string {
  return `${value} ${singular}${value === 1 ? "" : "s"}`;
}

export function getRoadmapPrompt(
  input: {
    status: FeedbackStatus;
    updatedAt: string;
    votes: number;
  },
  now: Date,
): RoadmapPrompt | null {
  const then = Date.parse(input.updatedAt);
  const nowMs = now.getTime();
  if (Number.isNaN(then) || Number.isNaN(nowMs) || then > nowMs) return null;

  const days = Math.floor((nowMs - then) / DAY_MS);

  if (input.status === "planned" && days >= ROADMAP_PROMPT_THRESHOLDS.plannedStaleDays) {
    return {
      kind: "stale_planned",
      label: "Stale commitment",
      message: `In Planned for ${days} days without a change.`,
      suggestedAction: "Start it, re-scope it, or move it back to Under review.",
    };
  }

  if (
    input.status === "in_progress" &&
    days >= ROADMAP_PROMPT_THRESHOLDS.inProgressStaleDays
  ) {
    return {
      kind: "stale_in_progress",
      label: "No progress update",
      message: `In progress for ${days} days without an update.`,
      suggestedAction: "Ship what is ready or add a progress note for voters.",
    };
  }

  if (
    input.status === "under_review" &&
    days >= ROADMAP_PROMPT_THRESHOLDS.lowTractionReviewDays &&
    input.votes <= ROADMAP_PROMPT_THRESHOLDS.lowTractionVotes
  ) {
    return {
      kind: "low_traction_review",
      label: "Low traction",
      message: `In review for ${days} days with ${plural(input.votes, "vote")}.`,
      suggestedAction: "Accept, merge with a similar request, or close it.",
    };
  }

  return null;
}
