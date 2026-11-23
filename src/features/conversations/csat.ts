import type { ConversationStatus } from "@/db/schema/conversations";

/** How long after a re-resolution the one allowed re-rating stays open. */
export const CSAT_RERATE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type CsatEligibilityRow = {
  csatRequestedAt: Date | null;
  csatRating: number | null;
  csatRatedAt: Date | null;
  csatReratedAt: Date | null;
  resolvedAt: Date | null;
  status: ConversationStatus;
};

/**
 * One rating, plus one update after the thread was reopened and resolved again.
 * The timestamp comparison is the evidence of a reopen: resolving without a
 * new customer reply leaves `resolvedAt` no later than the rating.
 */
export function csatEligibility(
  row: CsatEligibilityRow,
  now: Date,
): { canRate: boolean; rerate: boolean } {
  const rerate =
    row.csatRating !== null &&
    row.csatReratedAt === null &&
    row.status === "resolved" &&
    row.resolvedAt !== null &&
    row.csatRatedAt !== null &&
    row.resolvedAt > row.csatRatedAt &&
    now.getTime() - row.resolvedAt.getTime() <= CSAT_RERATE_WINDOW_MS;

  return {
    rerate,
    canRate:
      row.csatRequestedAt !== null &&
      row.status === "resolved" &&
      (row.csatRating === null || rerate),
  };
}