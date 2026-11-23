/**
 * Query rules for the dashboard command palette.
 *
 * Pure and unit-tested: the route and the browser both use the same trimming,
 * length limit and escaping, so a search cannot widen or break the SQL pattern.
 */

export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_LENGTH = 80;

export type GlobalSearchKind = "request" | "conversation" | "release" | "help" | "customer";

export type GlobalSearchItem = {
  id: string;
  title: string;
  subtitle: string;
  href: string;
};

export type GlobalSearchGroup = {
  kind: GlobalSearchKind;
  label: string;
  items: GlobalSearchItem[];
};

export function normalizeSearchQuery(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, SEARCH_MAX_LENGTH);
}

export function isSearchableQuery(value: string): boolean {
  return value.length >= SEARCH_MIN_LENGTH;
}

/** Escape LIKE metacharacters; Postgres uses backslash as the default escape. */
export function escapeSearchPattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

export function searchPattern(value: string): string {
  return `%${escapeSearchPattern(value)}%`;
}
