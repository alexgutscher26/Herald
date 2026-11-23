import type {
  FeedbackAttentionFilter,
  FeedbackCategory,
  FeedbackCustomFieldSort,
  FeedbackSavedViewFilters,
  FeedbackStatus,
  FeedbackViewSort,
  SegmentFilter,
} from "@/types";

/**
 * Normalize a saved view's filters.
 *
 * The value comes back from `jsonb`, which is not type-checked by the database,
 * and the same helper validates request input before it is stored. Unknown
 * values fall back to the unfiltered inbox instead of producing an empty,
 * confusing view.
 */

const STATUSES: (FeedbackStatus | "all")[] = [
  "all",
  "new",
  "under_review",
  "planned",
  "in_progress",
  "shipped",
  "closed",
];

const CATEGORIES: (FeedbackCategory | "all")[] = [
  "all",
  "feature_request",
  "bug",
  "improvement",
  "question",
];

const SORTS: FeedbackViewSort[] = [
  "newest",
  "oldest",
  "votes",
  "priority",
  "impact",
  "value_effort",
  "requester_weight",
  "revenue",
];

const ATTENTION: FeedbackAttentionFilter[] = [
  "all",
  "no_reply_7d",
  "planned_stale_30d",
];

const DEFAULT_FILTERS: FeedbackSavedViewFilters = {
  search: "",
  status: "all",
  category: "all",
  sort: "newest",
  customFieldSort: null,
  customFields: {},
  minScore: null,
  segment: null,
  assignee: "all",
  stale: "all",
};

/** Field keys and filter values are bounded so a saved view stays small. */
function normalizeCustomFieldFilters(value: unknown): Record<string, string> {
  const input = record(value);
  const filters: Record<string, string> = {};

  for (const [key, raw] of Object.entries(input)) {
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(key)) continue;
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim().slice(0, 200);
    if (trimmed === "") continue;
    filters[key] = trimmed;
  }

  return filters;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** A valid field key with a direction, or null when the JSON is malformed. */
function normalizeCustomFieldSort(value: unknown): FeedbackCustomFieldSort | null {
  const input = record(value);
  const key = typeof input.key === "string" ? input.key.trim() : "";
  const direction =
    input.direction === "asc" || input.direction === "desc" ? input.direction : null;
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(key) || direction === null) return null;
  return { key, direction };
}

/** A trait key/value pair, bounded so a saved view stays small. */
function normalizeSegment(value: unknown): SegmentFilter | null {
  const input = record(value);
  const key = typeof input.key === "string" ? input.key.trim().slice(0, 64) : "";
  const segmentValue =
    typeof input.value === "string" ? input.value.trim().slice(0, 200) : "";
  if (key === "" || segmentValue === "") return null;
  return { key, value: segmentValue };
}

/** "all", "me", "unassigned" or a member id; anything else is unfiltered. */
function normalizeAssignee(value: unknown): string {
  if (typeof value !== "string") return "all";
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > 120) return "all";
  return trimmed;
}

function normalizeAttention(value: unknown): FeedbackAttentionFilter {
  return ATTENTION.includes(value as FeedbackAttentionFilter)
    ? (value as FeedbackAttentionFilter)
    : "all";
}

function normalizeMinScore(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < 1 || value > 100) return null;
  return value;
}

export function normalizeViewFilters(value: unknown): FeedbackSavedViewFilters {
  const input = record(value);

  return {
    search:
      typeof input.search === "string" ? input.search.trim().slice(0, 120) : "",
    status: STATUSES.includes(input.status as FeedbackStatus | "all")
      ? (input.status as FeedbackStatus | "all")
      : "all",
    category: CATEGORIES.includes(input.category as FeedbackCategory | "all")
      ? (input.category as FeedbackCategory | "all")
      : "all",
    sort: SORTS.includes(input.sort as FeedbackViewSort)
      ? (input.sort as FeedbackViewSort)
      : "newest",
    customFieldSort: normalizeCustomFieldSort(input.customFieldSort),
    customFields: normalizeCustomFieldFilters(input.customFields),
    minScore: normalizeMinScore(input.minScore),
    segment: normalizeSegment(input.segment),
    assignee: normalizeAssignee(input.assignee),
    stale: normalizeAttention(input.stale),
  };
}

export function isEmptyViewFilters(filters: FeedbackSavedViewFilters): boolean {
  return (
    filters.search === "" &&
    filters.status === DEFAULT_FILTERS.status &&
    filters.category === DEFAULT_FILTERS.category &&
    filters.sort === DEFAULT_FILTERS.sort &&
    (filters.customFieldSort ?? null) === null &&
    Object.keys(filters.customFields ?? {}).length === 0 &&
    (filters.minScore ?? null) === null &&
    (filters.segment ?? null) === null &&
    (filters.assignee ?? "all") === DEFAULT_FILTERS.assignee &&
    (filters.stale ?? "all") === DEFAULT_FILTERS.stale
  );
}
