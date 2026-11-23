/**
 * Shared pagination primitives.
 *
 * Page-number readers (public board, changelog, dashboard lists) and keyset
 * readers (`/api/v1`, MCP) use the same bounds and the same opaque cursor
 * format. A cursor is base64url-encoded JSON carrying the sort mode, the last
 * row's sort value and its id. It is opaque to clients but is *not* a secret:
 * it contains no tenant id and no personal data, and the server re-applies all
 * authorization and filters on every request.
 *
 * `v` allows the format to change without misreading an old cursor.
 */

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;
export const MAX_PAGE = 10_000;

export type PaginationMeta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

/** Clamp a page number to the supported range; a bad value falls back to 1. */
export function normalizePage(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.min(Math.max(Math.trunc(value), 1), MAX_PAGE);
}

/** Clamp a page size to the supported range; a bad value uses the default. */
export function normalizePageSize(
  value: number | null | undefined,
  fallback = DEFAULT_PAGE_SIZE,
  max = MAX_PAGE_SIZE,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), 1), Math.max(1, max));
}

/** Offset for a 1-indexed page. */
export function pageOffset(
  page: number,
  pageSize: number,
  maxPageSize = MAX_PAGE_SIZE,
): number {
  return (normalizePage(page) - 1) * normalizePageSize(pageSize, DEFAULT_PAGE_SIZE, maxPageSize);
}

/**
 * Pagination metadata for a page-number reader.
 *
 * `totalPages` is never zero and `page` is clamped to the last page, so a URL
 * asking for page 99 of a three-page list renders page three rather than an
 * empty list that still claims there is more.
 */
export function paginationMeta(input: {
  page: number;
  pageSize: number;
  total: number;
  maxPageSize?: number;
}): PaginationMeta {
  const pageSize = normalizePageSize(input.pageSize, DEFAULT_PAGE_SIZE, input.maxPageSize);
  const total = Math.max(0, Math.trunc(input.total));
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return {
    page: Math.min(normalizePage(input.page), totalPages),
    pageSize,
    total,
    totalPages,
  };
}

export type CursorPayload = {
  v: 1;
  sort: string;
  value: string;
  id: string;
};

// A custom field's longest text value is 2,000 characters, and the cursor has
// to carry the last value to resume after it. The outer bound also caps the
// base64 payload so a client cannot send an arbitrarily large cursor.
const MAX_CURSOR_LENGTH = 8_192;

export function encodeCursor(payload: Omit<CursorPayload, "v">): string {
  const body: CursorPayload = { v: 1, ...payload };
  return Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
}

/**
 * Decode a cursor, returning `null` for anything malformed.
 *
 * A bad cursor is rejected by the caller as a 400 rather than silently
 * resetting to page one, because a silent reset can loop a client over the
 * same data.
 */
export function decodeCursor(raw: string | null | undefined): CursorPayload | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_CURSOR_LENGTH) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;

    const candidate = parsed as Record<string, unknown>;
    if (candidate.v !== 1) return null;
    // A custom-field sort carries `custom_field_asc:<key>`; keys are up to 40
    // characters, so the binding can exceed the old built-in-sort bound.
    if (typeof candidate.sort !== "string" || candidate.sort.length > 64) return null;
    if (typeof candidate.value !== "string" || candidate.value.length > 2_000) return null;
    if (typeof candidate.id !== "string" || !isUuid(candidate.id)) return null;

    return {
      v: 1,
      sort: candidate.sort,
      value: candidate.value,
      id: candidate.id,
    };
  } catch {
    return null;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
