/** One customer's stored traits, used only to filter requests by segment. */
export type CustomerSegment = {
  customerId: string;
  emailDomain: string | null;
  customerTraits: Record<string, unknown>;
  companyTraits: Record<string, unknown>[];
};

export type SegmentFilter = { key: string; value: string };

export type SegmentFacetKind = "plan" | "company_size" | "trait";

/** One stored trait value offered as a segment filter. */
export type SegmentFacet = {
  key: string;
  value: string;
  kind: SegmentFacetKind;
};

/**
 * Segment rules for gated public boards — pure logic only.
 *
 * Gating answers a different question from `boards.visibility`: visibility says
 * whether the surface is public at all, rules say which visitors may see it.
 * The dashboard reuses the trait matcher to filter requests by the requesters'
 * stored plan, company size or any other trait. Keeping the decision here
 * means the resolver, the admin action, the inbox and the tests all evaluate
 * the same way, without a database in the way.
 */

export type BoardAccessMatch = "company" | "email_domain" | "trait";

export type BoardAccessRule = {
  match: BoardAccessMatch;
  value: string;
  traitKey: string;
};

/** Everything the matcher needs, loaded for one visitor. */
export type ViewerSegments = {
  customerId: string | null;
  emailDomain: string | null;
  companyIds: string[];
  customerTraits: Record<string, unknown>;
  companyTraits: Record<string, unknown>[];
};

export const EMPTY_SEGMENTS: ViewerSegments = {
  customerId: null,
  emailDomain: null,
  companyIds: [],
  customerTraits: {},
  companyTraits: [],
};

export const MAX_ACCESS_RULES = 50;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Accept `Acme.COM`, `@acme.com` or `acme.com.` and return `acme.com`. */
export function normalizeDomain(value: string): string | null {
  const domain = value.trim().toLowerCase().replace(/^@/, "").replace(/\.$/, "");
  if (domain.length === 0 || domain.length > 253) return null;
  if (!domain.includes(".")) return null;
  if (!/^[a-z0-9.-]+$/.test(domain)) return null;
  if (domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) return null;
  return domain;
}

export function traitMatchesValue(
  traits: Record<string, unknown>,
  key: string,
  expected: string,
): boolean {
  if (!Object.hasOwn(traits, key)) return false;
  const actual = traits[key];
  if (typeof actual === "string") return actual.trim().toLowerCase() === expected;
  if (typeof actual === "number" || typeof actual === "boolean") {
    return String(actual) === expected;
  }
  return false;
}

function traitMatches(
  traits: Record<string, unknown>,
  key: string,
  expected: string,
): boolean {
  return traitMatchesValue(traits, key, expected);
}

/**
 * No rules means open; otherwise one match is enough.
 *
 * A visitor with no session has no segments, so every gated board denies them —
 * which is the intended answer for a board that is not public to the world.
 */
export function boardMatchesSegments(
  rules: BoardAccessRule[],
  segments: ViewerSegments,
): boolean {
  if (rules.length === 0) return true;

  return rules.some((rule) => {
    if (rule.match === "company") {
      return segments.companyIds.includes(rule.value);
    }
    if (rule.match === "email_domain") {
      return segments.emailDomain === rule.value;
    }
    if (rule.match === "trait") {
      return (
        traitMatches(segments.customerTraits, rule.traitKey, rule.value) ||
        segments.companyTraits.some((traits) =>
          traitMatches(traits, rule.traitKey, rule.value),
        )
      );
    }
    return false;
  });
}

export type AccessRuleInput = {
  match: string;
  value: string;
  traitKey?: string | null;
};

export type AccessRulesResult =
  | { ok: true; rules: BoardAccessRule[] }
  | { ok: false; error: string };

/**
 * Validate and canonically normalise a rule set.
 *
 * Values are normalised here rather than at the database so a rule written as
 * `Acme.COM` and one written as `acme.com` are the same rule — the unique
 * constraint then does what it looks like it does.
 */
/* -------------------------------------------------------------------------- */
/* Dashboard segment filters                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Whether one requester belongs to a segment.
 *
 * The same rule shape as a gated board: a customer trait or any of their
 * company traits can match. Values are compared case-insensitively, and a
 * number or boolean is stringified rather than coerced into a different
 * meaning.
 */
export function segmentMatchesFilter(
  segment: CustomerSegment,
  filter: SegmentFilter,
): boolean {
  return (
    traitMatchesValue(segment.customerTraits, filter.key, filter.value) ||
    segment.companyTraits.some((traits) =>
      traitMatchesValue(traits, filter.key, filter.value),
    )
  );
}

/**
 * Whether a request has at least one requester in the segment.
 *
 * A request with no identified customers never matches: the filter is about
 * who asked, and an anonymous request has no segment.
 */
export function requestMatchesSegment(
  filter: SegmentFilter | null | undefined,
  segments: readonly CustomerSegment[],
): boolean {
  if (!filter) return true;
  return segments.some((segment) => segmentMatchesFilter(segment, filter));
}

function facetKind(key: string): SegmentFacetKind {
  if (key === "plan") return "plan";
  if (key === "company_size" || key === "companySize") return "company_size";
  return "trait";
}

export const MAX_SEGMENT_FACETS = 100;

/**
 * Distinct trait values the inbox can offer as segment filters.
 *
 * Values come from stored rows only. Plan and company-size keys are labelled;
 * every other key stays a generic trait. Arrays and objects are skipped
 * because a filter compares one scalar value, and the list is capped so a
 * workspace with noisy traits cannot make the page enormous.
 */
export function buildSegmentFacets(
  segments: readonly CustomerSegment[],
  limit = MAX_SEGMENT_FACETS,
): SegmentFacet[] {
  const byKey = new Map<string, SegmentFacet>();

  const add = (traits: Record<string, unknown>): void => {
    for (const [key, raw] of Object.entries(traits)) {
      if (raw === null || raw === undefined) continue;
      if (typeof raw === "object") continue;
      const value = String(raw).trim().slice(0, 80);
      if (value === "") continue;
      const id = `${key}\u0000${value}`;
      if (byKey.has(id)) continue;
      byKey.set(id, { key, value, kind: facetKind(key) });
    }
  };

  for (const segment of segments) {
    add(segment.customerTraits);
    for (const traits of segment.companyTraits) add(traits);
  }

  const rank: Record<SegmentFacetKind, number> = {
    plan: 0,
    company_size: 1,
    trait: 2,
  };

  return [...byKey.values()]
    .sort(
      (a, b) =>
        rank[a.kind] - rank[b.kind] ||
        a.key.localeCompare(b.key) ||
        a.value.localeCompare(b.value),
    )
    .slice(0, Math.max(0, limit));
}

export function normalizeAccessRules(inputs: AccessRuleInput[]): AccessRulesResult {
  if (inputs.length > MAX_ACCESS_RULES) {
    return { ok: false, error: `A board can have at most ${MAX_ACCESS_RULES} rules.` };
  }

  const seen = new Set<string>();
  const rules: BoardAccessRule[] = [];

  for (const input of inputs) {
    if (input.match === "company") {
      const value = input.value.trim().toLowerCase();
      if (!UUID_PATTERN.test(value)) {
        return { ok: false, error: "Choose a company from this workspace." };
      }
      if (seen.has(`company:${value}`)) continue;
      seen.add(`company:${value}`);
      rules.push({ match: "company", value, traitKey: "" });
      continue;
    }

    if (input.match === "email_domain") {
      const value = normalizeDomain(input.value);
      if (!value) {
        return { ok: false, error: "Enter a domain like acme.com." };
      }
      if (seen.has(`email_domain:${value}`)) continue;
      seen.add(`email_domain:${value}`);
      rules.push({ match: "email_domain", value, traitKey: "" });
      continue;
    }

    if (input.match === "trait") {
      const traitKey = (input.traitKey ?? "").trim().slice(0, 64);
      const value = input.value.trim().toLowerCase().slice(0, 200);
      if (traitKey.length === 0) {
        return { ok: false, error: "Name the trait to match on." };
      }
      if (value.length === 0) {
        return { ok: false, error: "Enter the trait value to match." };
      }
      const key = `trait:${traitKey}:${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rules.push({ match: "trait", value, traitKey });
      continue;
    }

    return { ok: false, error: "Choose company, email domain or trait." };
  }

  return { ok: true, rules };
}
