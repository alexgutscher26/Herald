/**
 * Audience targeting shared by surveys, experiences and outbound messages.
 *
 * The evaluator is deliberately pure so the same rules can be checked in the
 * browser (page context) and on the server (customer traits). A missing value
 * never matches: targeting is deny-by-default.
 */

export type TargetingOperator = "equals" | "contains" | "in";

export type TargetingRule =
  | { type: "attribute"; key: string; operator: TargetingOperator; value: string }
  | { type: "page_url"; operator: "equals" | "contains"; value: string }
  | { type: "time_on_page"; operator: "gte"; value: number }
  | { type: "selector"; value: string }
  /** A product event fired by the host page. Never evaluated on the server. */
  | { type: "event"; value: string };

export type TargetingContext = {
  attributes?: Record<string, string | number | boolean | null | undefined>;
  pageUrl?: string | null;
  timeOnPage?: number | null;
  selectors?: string[];
  events?: string[];
};

export function isTargetingRule(value: unknown): value is TargetingRule {
  if (!value || typeof value !== "object") return false;
  const rule = value as Record<string, unknown>;
  if (rule.type === "attribute") {
    return (
      typeof rule.key === "string" &&
      rule.key.length > 0 &&
      (rule.operator === "equals" ||
        rule.operator === "contains" ||
        rule.operator === "in") &&
      typeof rule.value === "string"
    );
  }
  if (rule.type === "page_url") {
    return (
      (rule.operator === "equals" || rule.operator === "contains") &&
      typeof rule.value === "string"
    );
  }
  if (rule.type === "time_on_page") {
    return (
      rule.operator === "gte" &&
      typeof rule.value === "number" &&
      rule.value >= 0
    );
  }
  if (rule.type === "selector" || rule.type === "event") {
    return typeof rule.value === "string" && rule.value.length > 0;
  }
  return false;
}

export function parseTargetingRules(value: unknown): TargetingRule[] {
  return Array.isArray(value) ? value.filter(isTargetingRule) : [];
}

function attributeMatches(
  actual: unknown,
  operator: TargetingOperator,
  expected: string,
): boolean {
  if (actual === null || actual === undefined) return false;
  const text = String(actual).toLowerCase();
  const wanted = expected.toLowerCase();
  if (operator === "equals") return text === wanted;
  if (operator === "contains") return text.includes(wanted);
  return expected
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .includes(text);
}

export function matchesTargeting(
  rules: readonly TargetingRule[],
  context: TargetingContext,
): boolean {
  if (rules.length === 0) return true;
  return rules.every((rule) => {
    if (rule.type === "attribute") {
      return attributeMatches(
        context.attributes?.[rule.key],
        rule.operator,
        rule.value,
      );
    }
    if (rule.type === "page_url") {
      if (!context.pageUrl) return false;
      return rule.operator === "equals"
        ? context.pageUrl === rule.value
        : context.pageUrl.includes(rule.value);
    }
    if (rule.type === "time_on_page") {
      return (context.timeOnPage ?? 0) >= rule.value;
    }
    if (rule.type === "event") {
      return (context.events ?? []).includes(rule.value);
    }
    return (context.selectors ?? []).includes(rule.value);
  });
}

/** All values are strings in the admin form; normalize while preserving numbers. */
export function normalizeTargetingRules(input: unknown): TargetingRule[] {
  const raw = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? (() => {
          try {
            return JSON.parse(input) as unknown;
          } catch {
            return [];
          }
        })()
      : [];
  return parseTargetingRules(raw);
}

export function audienceFromTraits(
  traits: Record<string, unknown> | null | undefined,
): Record<string, string | number | boolean | null> {
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(traits ?? {})) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      result[key] = value;
    }
  }
  return result;
}

export function describeRule(rule: TargetingRule): string {
  if (rule.type === "attribute") {
    return `${rule.key} ${rule.operator} ${rule.value}`;
  }
  if (rule.type === "page_url") {
    return `page URL ${rule.operator} ${rule.value}`;
  }
  if (rule.type === "time_on_page") {
    return `time on page >= ${rule.value}s`;
  }
  if (rule.type === "event") {
    return `event ${rule.value}`;
  }
  return `selector ${rule.value}`;
}
