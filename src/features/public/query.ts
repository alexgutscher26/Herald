import type { PublicFeedbackStatus } from "./types";

/**
 * Public board query state.
 *
 * A visitor drives the board with the URL: `?q=…&status=…&tag=…&sort=…&page=…`.
 * Keeping this parsing pure means the page, the link builders and the tests all
 * agree on what a valid query is, and an unknown value degrades to the default
 * instead of erroring or reaching SQL as-is.
 */

export const PUBLIC_BOARD_PAGE_SIZE = 20;
export const PUBLIC_BOARD_MAX_PAGE_SIZE = 50;
export const PUBLIC_BOARD_MAX_SEARCH_LENGTH = 120;
export const PUBLIC_BOARD_MAX_TAG_LENGTH = 48;

export const PUBLIC_BOARD_SORTS = ["top", "trending", "newest"] as const;
export type PublicBoardSort = (typeof PUBLIC_BOARD_SORTS)[number];

/**
 * Public roadmap ordering. Both options use public data only — never the
 * team's impact, effort, revenue or computed priority score. `votes` is the
 * explicit "most wanted" switch; `recent` is the editorial default.
 */
export const PUBLIC_ROADMAP_SORTS = ["recent", "votes"] as const;
export type PublicRoadmapSort = (typeof PUBLIC_ROADMAP_SORTS)[number];

export function parsePublicRoadmapSort(value: unknown): PublicRoadmapSort {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" &&
    (PUBLIC_ROADMAP_SORTS as readonly string[]).includes(first)
    ? (first as PublicRoadmapSort)
    : "recent";
}

export const PUBLIC_STATUSES: readonly PublicFeedbackStatus[] = [
  "open",
  "under_review",
  "planned",
  "in_progress",
  "shipped",
  "closed",
];

export type PublicBoardQuery = {
  search: string;
  status: PublicFeedbackStatus | null;
  tag: string | null;
  sort: PublicBoardSort;
  page: number;
  pageSize: number;
};

/** `searchParams` values as Next.js hands them to a page or route handler. */
export type RawPublicBoardQuery = {
  q?: string | string[] | undefined;
  status?: string | string[] | undefined;
  tag?: string | string[] | undefined;
  sort?: string | string[] | undefined;
  page?: string | string[] | undefined;
  pageSize?: string | string[] | undefined;
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function positiveInteger(value: string | undefined, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

export function isPublicStatus(value: unknown): value is PublicFeedbackStatus {
  return (
    typeof value === "string" &&
    (PUBLIC_STATUSES as readonly string[]).includes(value)
  );
}

export function isPublicBoardSort(value: unknown): value is PublicBoardSort {
  return (
    typeof value === "string" &&
    (PUBLIC_BOARD_SORTS as readonly string[]).includes(value)
  );
}

export function parsePublicBoardQuery(input: RawPublicBoardQuery): PublicBoardQuery {
  const search = (first(input.q) ?? "").trim().slice(0, PUBLIC_BOARD_MAX_SEARCH_LENGTH);
  const statusValue = first(input.status);
  const tag = (first(input.tag) ?? "").trim().slice(0, PUBLIC_BOARD_MAX_TAG_LENGTH);
  const sortValue = first(input.sort);

  return {
    search,
    status: isPublicStatus(statusValue) ? statusValue : null,
    tag: tag === "" ? null : tag,
    sort: isPublicBoardSort(sortValue) ? sortValue : "newest",
    page: positiveInteger(first(input.page), 1, 10_000),
    pageSize: positiveInteger(first(input.pageSize), PUBLIC_BOARD_PAGE_SIZE, PUBLIC_BOARD_MAX_PAGE_SIZE),
  };
}

/**
 * Whether the URL represents a filtered or paginated view.
 *
 * Only the clean board URL is canonical: a search, status/tag filter, sort or
 * page is a useful view for a visitor but duplicate content for a crawler, so
 * those variants are served with `noindex, follow`.
 */
export function isFilteredPublicBoardQuery(query: PublicBoardQuery): boolean {
  return (
    query.search !== "" ||
    query.status !== null ||
    query.tag !== null ||
    query.sort !== "newest" ||
    query.page > 1 ||
    query.pageSize !== PUBLIC_BOARD_PAGE_SIZE
  );
}

/**
 * Build a query string that only carries values differing from the defaults.
 *
 * Clean URLs matter twice here: they are the canonical form search engines
 * index, and they keep pagination links from accumulating empty parameters.
 */
export function publicBoardQueryString(
  query: PublicBoardQuery,
  overrides: Partial<PublicBoardQuery> = {},
): string {
  const merged = { ...query, ...overrides };
  const params = new URLSearchParams();

  if (merged.search !== "") params.set("q", merged.search);
  if (merged.status !== null) params.set("status", merged.status);
  if (merged.tag !== null) params.set("tag", merged.tag);
  if (merged.sort !== "newest") params.set("sort", merged.sort);
  if (merged.page > 1) params.set("page", String(merged.page));
  if (merged.pageSize !== PUBLIC_BOARD_PAGE_SIZE) {
    params.set("pageSize", String(merged.pageSize));
  }

  const serialised = params.toString();
  return serialised === "" ? "" : `?${serialised}`;
}

/** Escape `%`, `_` and the escape character itself for a LIKE/ILIKE pattern. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}
