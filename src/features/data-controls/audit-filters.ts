/**
 * Audit-log filter parsing and query-string building.
 *
 * Pure so the page, the CSV route and the tests all agree on what a filter
 * means. Values are narrowed hard: dates must be `YYYY-MM-DD`, and the text
 * filters drop SQL wildcards and control characters so a pasted `%` cannot ask
 * for every row by accident.
 */

export type AuditFilterInput = Record<string, string | string[] | undefined>;

export type AuditFilters = {
  actor: string;
  action: string;
  targetType: string;
  from: string;
  to: string;
  search: string;
};

export const EMPTY_AUDIT_FILTERS: AuditFilters = {
  actor: "",
  action: "",
  targetType: "",
  from: "",
  to: "",
  search: "",
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function one(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function text(value: string | string[] | undefined, max: number): string {
  return one(value)
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/[%_\\]/g, "")
    .trim()
    .slice(0, max);
}

function date(value: string | string[] | undefined): string {
  const candidate = one(value).trim();
  return DATE_PATTERN.test(candidate) ? candidate : "";
}

export function parseAuditFilters(input: AuditFilterInput): AuditFilters {
  return {
    actor: text(input.actor, 120),
    action: one(input.action).replace(/[^a-z0-9_.:-]/gi, "").slice(0, 80),
    targetType: one(input.targetType).replace(/[^a-z0-9_:-]/gi, "").slice(0, 60),
    from: date(input.from),
    to: date(input.to),
    search: text(input.search, 120),
  };
}

export function hasAuditFilters(filters: AuditFilters): boolean {
  return Object.values(filters).some((value) => value !== "");
}

/** Query string for the CSV route; empty filters are omitted. */
export function auditFilterQuery(filters: AuditFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** Inclusive UTC bounds for the date inputs. */
export function auditDateBounds(filters: AuditFilters): {
  from: Date | null;
  to: Date | null;
} {
  const from = filters.from ? new Date(`${filters.from}T00:00:00.000Z`) : null;
  const to = filters.to ? new Date(`${filters.to}T23:59:59.999Z`) : null;
  return {
    from: from && !Number.isNaN(from.getTime()) ? from : null,
    to: to && !Number.isNaN(to.getTime()) ? to : null,
  };
}
