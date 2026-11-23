/**
 * Segment rules shared by the builder, outbound delivery and win-back.
 *
 * The evaluator is pure and deny-by-default: a missing trait or an unknown
 * event never matches. Rules are additive (AND), which keeps a saved segment
 * predictable when it is reused months later.
 */

import type { SegmentRule, SegmentTraitOperator } from "@/db/schema/segments";

export type { SegmentRule, SegmentTraitOperator };

export type SegmentCustomer = {
  id: string;
  emailNormalized: string | null;
  traits: Record<string, unknown>;
};

export const SEGMENT_RULE_LIMIT = 10;
export const SEGMENT_ACTIVITY_WINDOW_MAX_DAYS = 365;

const TRAIT_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/;
const EVENT_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_.:-]{0,79}$/;

export function isSegmentRule(value: unknown): value is SegmentRule {
  if (!value || typeof value !== "object") return false;
  const rule = value as Record<string, unknown>;

  if (rule.type === "trait") {
    return (
      typeof rule.key === "string" &&
      TRAIT_KEY_PATTERN.test(rule.key) &&
      (rule.operator === "equals" ||
        rule.operator === "contains" ||
        rule.operator === "in" ||
        rule.operator === "exists") &&
      typeof rule.value === "string"
    );
  }

  if (rule.type === "plan") {
    return (
      (rule.operator === "equals" || rule.operator === "in") &&
      typeof rule.value === "string" &&
      rule.value.trim().length > 0
    );
  }

  if (rule.type === "activity") {
    return (
      typeof rule.event === "string" &&
      EVENT_NAME_PATTERN.test(rule.event) &&
      (rule.operator === "performed" || rule.operator === "not_performed") &&
      typeof rule.withinDays === "number" &&
      Number.isInteger(rule.withinDays) &&
      rule.withinDays >= 1
    );
  }

  return false;
}

/** Normalize builder input without trusting any field. */
export function parseSegmentRules(input: unknown): SegmentRule[] {
  let raw = input;
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];

  const rules: SegmentRule[] = [];
  for (const value of raw) {
    if (!isSegmentRule(value)) continue;

    if (value.type === "trait") {
      const key = value.key.trim();
      const text = value.value.trim().slice(0, 200);
      if (!key) continue;
      if (value.operator !== "exists" && text === "") continue;
      rules.push({
        type: "trait",
        key,
        operator: value.operator,
        value: value.operator === "exists" ? "" : text,
      });
    } else if (value.type === "plan") {
      const text = value.value.trim().slice(0, 120);
      if (!text) continue;
      rules.push({ type: "plan", operator: value.operator, value: text });
    } else {
      rules.push({
        type: "activity",
        event: value.event.trim(),
        operator: value.operator,
        withinDays: Math.min(
          Math.max(Math.trunc(value.withinDays), 1),
          SEGMENT_ACTIVITY_WINDOW_MAX_DAYS,
        ),
      });
    }

    if (rules.length >= SEGMENT_RULE_LIMIT) break;
  }
  return rules;
}

function textMatches(
  actual: unknown,
  operator: SegmentTraitOperator,
  expected: string,
): boolean {
  if (operator === "exists") {
    return actual !== null && actual !== undefined && String(actual).trim() !== "";
  }
  if (actual === null || actual === undefined) return false;
  const value = String(actual).trim().toLowerCase();
  const wanted = expected.trim().toLowerCase();
  if (operator === "equals") return value === wanted;
  if (operator === "contains") return value.includes(wanted);
  return wanted
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .includes(value);
}

export function activityKey(customerId: string, event: string): string {
  return `${customerId}\u0000${event.toLowerCase()}`;
}

export type SegmentEvaluationContext = {
  customer: SegmentCustomer;
  /** `activityKey(customerId, event)` for every event inside each window. */
  activity: ReadonlySet<string>;
};

export function matchesSegment(
  rules: readonly SegmentRule[],
  context: SegmentEvaluationContext,
): boolean {
  if (rules.length === 0) return false;

  return rules.every((rule) => {
    if (rule.type === "trait") {
      return textMatches(context.customer.traits[rule.key], rule.operator, rule.value);
    }
    if (rule.type === "plan") {
      return textMatches(context.customer.traits.plan, rule.operator, rule.value);
    }
    const performed = context.activity.has(
      activityKey(context.customer.id, rule.event),
    );
    return rule.operator === "performed" ? performed : !performed;
  });
}

export function describeSegmentRule(rule: SegmentRule): string {
  if (rule.type === "trait") {
    if (rule.operator === "exists") return `${rule.key} exists`;
    if (rule.operator === "in") return `${rule.key} is one of ${rule.value}`;
    return `${rule.key} ${rule.operator} ${rule.value}`;
  }
  if (rule.type === "plan") {
    return rule.operator === "in" ? `plan is one of ${rule.value}` : `plan is ${rule.value}`;
  }
  return `${rule.event} ${rule.operator === "performed" ? "in the last" : "not in the last"} ${
    rule.withinDays
  } day${rule.withinDays === 1 ? "" : "s"}`;
}

/** Longest lookback any activity rule needs. */
export function activityWindowDays(rules: readonly SegmentRule[]): number {
  return rules.reduce(
    (days, rule) => (rule.type === "activity" ? Math.max(days, rule.withinDays) : days),
    0,
  );
}
