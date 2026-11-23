import type { FeedbackAttentionFilter, FeedbackStatus } from "@/types";

/**
 * Attention rules for the inbox.
 *
 * "No team reply in 7 days" and "planned but untouched for 30 days" are checks
 * over timestamps the inbox already has, so they stay pure and identical for
 * the list, the saved view and any future report. A team reply means a public
 * team comment: internal notes are the team talking to itself, not answering
 * the customer.
 */

export const REPLY_SLA_DAYS = 7;
export const PLANNED_STALE_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Requests that are already finished are not waiting for a reply. */
const RESOLVED_STATUSES: FeedbackStatus[] = ["shipped", "closed"];

export const ATTENTION_OPTIONS: {
  value: FeedbackAttentionFilter;
  label: string;
}[] = [
  { value: "all", label: "Any attention" },
  { value: "no_reply_7d", label: "No team reply in 7 days" },
  { value: "planned_stale_30d", label: "Planned but untouched 30 days" },
];

export function isAwaitingReply(
  input: {
    status: FeedbackStatus;
    createdAt: string;
    lastTeamReplyAt: string | null;
  },
  now: Date,
): boolean {
  if (RESOLVED_STATUSES.includes(input.status)) return false;

  const started = input.lastTeamReplyAt ?? input.createdAt;
  const at = Date.parse(started);
  if (!Number.isFinite(at)) return false;
  return now.getTime() - at >= REPLY_SLA_DAYS * DAY_MS;
}

export function isPlannedAndStale(
  input: { status: FeedbackStatus; updatedAt: string },
  now: Date,
): boolean {
  if (input.status !== "planned") return false;

  const at = Date.parse(input.updatedAt);
  if (!Number.isFinite(at)) return false;
  return now.getTime() - at >= PLANNED_STALE_DAYS * DAY_MS;
}

export function matchesAttention(
  input: {
    status: FeedbackStatus;
    createdAt: string;
    updatedAt: string;
    lastTeamReplyAt: string | null;
  },
  filter: FeedbackAttentionFilter,
  now: Date,
): boolean {
  if (filter === "all") return true;
  if (filter === "no_reply_7d") return isAwaitingReply(input, now);
  return isPlannedAndStale(input, now);
}
