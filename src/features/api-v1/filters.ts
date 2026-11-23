import { feedbackStatusEnum } from "@/db/schema/feedback";
import {
  CONVERSATION_VIEWS,
  type ConversationView,
} from "@/features/conversations/filters";

import { decodeCursor, type CursorPayload } from "./cursor";

/**
 * Query-string parsing for `/api/v1`.
 *
 * Pure and strict: an unknown status, sort or cursor is a 400 with a message
 * naming the parameter, rather than a silent fallback to an unfiltered query.
 * Falling back would quietly return more data than the caller asked for, which
 * is the wrong default for an API.
 */

export type FilterParse<T> = { ok: true; value: T } | { ok: false; error: string };

export const REQUEST_SORTS = ["newest", "oldest", "updated", "votes"] as const;
export type RequestSort = (typeof REQUEST_SORTS)[number];

export const CHANGELOG_SORTS = ["newest", "oldest", "updated"] as const;
export type ChangelogSort = (typeof CHANGELOG_SORTS)[number];

export const BOARD_SORTS = ["position", "name", "newest"] as const;
export type BoardSort = (typeof BOARD_SORTS)[number];

export const CONVERSATION_SORTS = ["newest", "oldest", "updated"] as const;
export type ConversationSort = (typeof CONVERSATION_SORTS)[number];

export type CustomFieldFilter = { key: string; value: string };

/** `sort=custom_field_asc:<key>` or `custom_field_desc:<key>`. */
export type RequestCustomSort = {
  key: string;
  direction: "asc" | "desc";
};

const CUSTOM_SORT_PATTERN = /^custom_field_(asc|desc):([a-z][a-z0-9_]{0,39})$/;

/** Canonical cursor binding for either a built-in or custom-field sort. */
export function requestSortKey(
  sort: RequestSort,
  customSort: RequestCustomSort | null,
): string {
  return customSort ? `custom_field_${customSort.direction}:${customSort.key}` : sort;
}

export type RequestFilters = {
  status: (typeof feedbackStatusEnum.enumValues)[number] | null;
  board: string | null;
  tag: string | null;
  author: string | null;
  /** Repeated `custom_field=key:value` pairs; every one must match. */
  customFields: CustomFieldFilter[];
  updatedSince: Date | null;
  query: string;
  sort: RequestSort;
  /** Overrides `sort` when present. */
  customSort: RequestCustomSort | null;
  limit: number;
  cursor: CursorPayload | null;
  includeArchived: boolean;
  includeMerged: boolean;
};

export type ChangelogFilters = {
  status: "draft" | "scheduled" | "published" | "archived" | null;
  tag: string | null;
  updatedSince: Date | null;
  query: string;
  sort: ChangelogSort;
  limit: number;
  cursor: CursorPayload | null;
};

export type ConversationFilters = {
  inboxState: ConversationView;
  assignee: string | null;
  updatedSince: Date | null;
  query: string;
  sort: ConversationSort;
  limit: number;
  cursor: CursorPayload | null;
};

function first(params: URLSearchParams, name: string): string | null {
  const value = params.get(name);
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function parseLimit(params: URLSearchParams): FilterParse<number> {
  const raw = first(params, "limit");
  if (raw === null) return { ok: true, value: 25 };
  if (!/^\d{1,3}$/.test(raw)) {
    return { ok: false, error: "`limit` must be a whole number between 1 and 100." };
  }
  const value = Number.parseInt(raw, 10);
  if (value < 1 || value > 100) {
    return { ok: false, error: "`limit` must be between 1 and 100." };
  }
  return { ok: true, value };
}

function parseCursor(
  params: URLSearchParams,
  sort: string,
): FilterParse<CursorPayload | null> {
  const raw = first(params, "cursor");
  if (raw === null) return { ok: true, value: null };

  const decoded = decodeCursor(raw);
  if (!decoded) return { ok: false, error: "`cursor` is not a valid cursor." };
  if (decoded.sort !== sort) {
    return {
      ok: false,
      error: "`cursor` belongs to a different sort; restart without it.",
    };
  }
  return { ok: true, value: decoded };
}

function parseUpdatedSince(params: URLSearchParams): FilterParse<Date | null> {
  const raw = first(params, "updated_since");
  if (raw === null) return { ok: true, value: null };
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, error: "`updated_since` must be an ISO 8601 timestamp." };
  }
  return { ok: true, value: parsed };
}

function parseBoolean(params: URLSearchParams, name: string): FilterParse<boolean> {
  const raw = first(params, name);
  if (raw === null) return { ok: true, value: false };
  if (raw === "true" || raw === "1") return { ok: true, value: true };
  if (raw === "false" || raw === "0") return { ok: true, value: false };
  return { ok: false, error: `\`${name}\` must be true or false.` };
}

function parseSort<T extends string>(
  params: URLSearchParams,
  allowed: readonly T[],
  fallback: T,
): FilterParse<T> {
  const raw = first(params, "sort");
  if (raw === null) return { ok: true, value: fallback };
  if (!(allowed as readonly string[]).includes(raw)) {
    return {
      ok: false,
      error: `\`sort\` must be one of: ${allowed.join(", ")}.`,
    };
  }
  return { ok: true, value: raw as T };
}

export function parseRequestFilters(
  params: URLSearchParams,
): FilterParse<RequestFilters> {
  const rawSort = first(params, "sort");
  let sort: RequestSort = "newest";
  let customSort: RequestCustomSort | null = null;

  if (rawSort?.startsWith("custom_field_")) {
    const match = CUSTOM_SORT_PATTERN.exec(rawSort);
    if (!match) {
      return {
        ok: false,
        error:
          "`sort` custom form is `custom_field_asc:<key>` or `custom_field_desc:<key>` with a lowercase field key.",
      };
    }
    customSort = {
      key: match[2] as string,
      direction: match[1] as "asc" | "desc",
    };
  } else {
    const parsedSort = parseSort(params, REQUEST_SORTS, "newest");
    if (!parsedSort.ok) {
      return {
        ok: false,
        error: `${parsedSort.error} Custom-field sorting uses custom_field_asc:<key> or custom_field_desc:<key>.`,
      };
    }
    sort = parsedSort.value;
  }

  const limit = parseLimit(params);
  if (!limit.ok) return limit;

  const cursor = parseCursor(params, requestSortKey(sort, customSort));
  if (!cursor.ok) return cursor;

  const updatedSince = parseUpdatedSince(params);
  if (!updatedSince.ok) return updatedSince;

  const includeArchived = parseBoolean(params, "include_archived");
  if (!includeArchived.ok) return includeArchived;

  const includeMerged = parseBoolean(params, "include_merged");
  if (!includeMerged.ok) return includeMerged;

  const status = first(params, "status");
  if (
    status !== null &&
    !(feedbackStatusEnum.enumValues as readonly string[]).includes(status)
  ) {
    return {
      ok: false,
      error: `\`status\` must be one of: ${feedbackStatusEnum.enumValues.join(", ")}.`,
    };
  }

  const customFields: CustomFieldFilter[] = [];
  const seenKeys = new Set<string>();
  for (const raw of params.getAll("custom_field")) {
    const separator = raw.indexOf(":");
    const key = separator === -1 ? raw : raw.slice(0, separator);
    const value = separator === -1 ? "" : raw.slice(separator + 1).trim();

    if (!/^[a-z][a-z0-9_]{0,39}$/.test(key)) {
      return {
        ok: false,
        error: "`custom_field` must be `key:value` with a lowercase field key.",
      };
    }
    if (value === "" || value.length > 200) {
      return {
        ok: false,
        error: "`custom_field` needs a value of at most 200 characters.",
      };
    }
    if (seenKeys.has(key)) {
      return { ok: false, error: "Each `custom_field` key may appear only once." };
    }
    seenKeys.add(key);
    customFields.push({ key, value });
  }
  if (customFields.length > 5) {
    return { ok: false, error: "Filter by at most five custom fields." };
  }

  return {
    ok: true,
    value: {
      status: (status as RequestFilters["status"]) ?? null,
      board: first(params, "board"),
      tag: first(params, "tag"),
      author: first(params, "author"),
      customFields,
      updatedSince: updatedSince.value,
      query: (first(params, "q") ?? "").slice(0, 200),
      sort,
      customSort,
      limit: limit.value,
      cursor: cursor.value,
      includeArchived: includeArchived.value,
      includeMerged: includeMerged.value,
    },
  };
}

export function parseChangelogFilters(
  params: URLSearchParams,
): FilterParse<ChangelogFilters> {
  const sort = parseSort(params, CHANGELOG_SORTS, "newest");
  if (!sort.ok) return sort;

  const limit = parseLimit(params);
  if (!limit.ok) return limit;

  const cursor = parseCursor(params, sort.value);
  if (!cursor.ok) return cursor;

  const updatedSince = parseUpdatedSince(params);
  if (!updatedSince.ok) return updatedSince;

  const status = first(params, "status");
  const statuses = ["draft", "scheduled", "published", "archived"] as const;
  if (status !== null && !(statuses as readonly string[]).includes(status)) {
    return {
      ok: false,
      error: `\`status\` must be one of: ${statuses.join(", ")}.`,
    };
  }

  return {
    ok: true,
    value: {
      status: (status as ChangelogFilters["status"]) ?? null,
      tag: first(params, "tag"),
      updatedSince: updatedSince.value,
      query: (first(params, "q") ?? "").slice(0, 200),
      sort: sort.value,
      limit: limit.value,
      cursor: cursor.value,
    },
  };
}

export function parseConversationFilters(
  params: URLSearchParams,
): FilterParse<ConversationFilters> {
  const sort = parseSort(params, CONVERSATION_SORTS, "newest");
  if (!sort.ok) return sort;

  const limit = parseLimit(params);
  if (!limit.ok) return limit;

  const cursor = parseCursor(params, sort.value);
  if (!cursor.ok) return cursor;

  const updatedSince = parseUpdatedSince(params);
  if (!updatedSince.ok) return updatedSince;

  const inboxState = first(params, "inbox_state") ?? "queue";
  if (!(CONVERSATION_VIEWS as readonly string[]).includes(inboxState)) {
    return {
      ok: false,
      error: `\`inbox_state\` must be one of: ${CONVERSATION_VIEWS.join(", ")}.`,
    };
  }

  return {
    ok: true,
    value: {
      inboxState: inboxState as ConversationView,
      assignee: first(params, "assignee"),
      updatedSince: updatedSince.value,
      query: (first(params, "q") ?? "").slice(0, 200),
      sort: sort.value,
      limit: limit.value,
      cursor: cursor.value,
    },
  };
}

export function parseBoardSort(params: URLSearchParams): FilterParse<BoardSort> {
  return parseSort(params, BOARD_SORTS, "position");
}
