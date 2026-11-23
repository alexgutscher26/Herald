/**
 * Conversation inbox filters.
 *
 * Pure: no database, no request context. The page parses URL params through
 * this module, the query layer consumes the result, and the unit suite pins the
 * accepted values and the defaults.
 *
 * Deliberate choices:
 * - Unknown views, assignee filters and empty search fall back to the queue and
 *   "anyone", never to an unfiltered query. A typo must not widen the inbox.
 * - `all` is the working inbox (queue + open + snoozed + resolved). Spam and
 *   archived threads are reachable only through their own tabs, so they stay
 *   out of the main list and out of search by default.
 */

export const CONVERSATION_VIEWS = [
  "queue",
  "open",
  "all",
  "snoozed",
  "resolved",
  "spam",
  "archived",
] as const;

export type ConversationView = (typeof CONVERSATION_VIEWS)[number];

export const ASSIGNEE_FILTERS = ["any", "me", "unassigned"] as const;
export type AssigneeFilter = (typeof ASSIGNEE_FILTERS)[number];

export type InboxFilters = {
  view: ConversationView;
  query: string;
  assignee: AssigneeFilter;
  /** Exact tag name; empty means every tag. */
  tag?: string;
};

export const MAX_SEARCH_LENGTH = 120;

export function parseInboxFilters(input: {
  view?: string | string[];
  q?: string | string[];
  assignee?: string | string[];
  tag?: string | string[];
}): InboxFilters {
  const view = first(input.view);
  const query = first(input.q);
  const assignee = first(input.assignee);
  const tag = first(input.tag);

  return {
    view: isConversationView(view) ? view : "queue",
    query: (query ?? "").trim().slice(0, MAX_SEARCH_LENGTH),
    assignee: isAssigneeFilter(assignee) ? assignee : "any",
    tag: (tag ?? "").trim().slice(0, 40),
  };
}

export function isConversationView(value: unknown): value is ConversationView {
  return (
    typeof value === "string" &&
    (CONVERSATION_VIEWS as readonly string[]).includes(value)
  );
}

export function isAssigneeFilter(value: unknown): value is AssigneeFilter {
  return (
    typeof value === "string" &&
    (ASSIGNEE_FILTERS as readonly string[]).includes(value)
  );
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Build an inbox URL that preserves the other filters.
 *
 * The result is a path + query string built from validated values only, so it
 * is safe to hand to `Link`/`router.push` without echoing raw input.
 */
export function inboxHref(
  base: string,
  filters: InboxFilters,
  overrides: Partial<InboxFilters> = {},
): string {
  const next = { ...filters, ...overrides };
  const params = new URLSearchParams();
  if (next.view !== "queue") params.set("view", next.view);
  if (next.query) params.set("q", next.query);
  if (next.assignee !== "any") params.set("assignee", next.assignee);
  if (next.tag) params.set("tag", next.tag);
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}
