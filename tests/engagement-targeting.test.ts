import { describe, expect, test } from "bun:test";

import {
  matchesTargeting,
  normalizeTargetingRules,
  parseTargetingRules,
} from "@/features/engagement/rules";

describe("engagement audience targeting", () => {
  test("an empty audience matches everyone", () => {
    expect(matchesTargeting([], {})).toBe(true);
  });

  test("attributes support equals, contains and in", () => {
    const attributes = { plan: "Pro", company: "Acme Inc" };
    expect(
      matchesTargeting(
        [{ type: "attribute", key: "plan", operator: "equals", value: "pro" }],
        { attributes },
      ),
    ).toBe(true);
    expect(
      matchesTargeting(
        [{ type: "attribute", key: "company", operator: "contains", value: "acme" }],
        { attributes },
      ),
    ).toBe(true);
    expect(
      matchesTargeting(
        [{ type: "attribute", key: "plan", operator: "in", value: "free, pro" }],
        { attributes },
      ),
    ).toBe(true);
    expect(
      matchesTargeting(
        [{ type: "attribute", key: "missing", operator: "equals", value: "x" }],
        { attributes },
      ),
    ).toBe(false);
  });

  test("page, time and selector rules are deny-by-default", () => {
    const rules = [
      { type: "page_url" as const, operator: "contains" as const, value: "/pricing" },
      { type: "time_on_page" as const, operator: "gte" as const, value: 30 },
      { type: "selector" as const, value: "#pricing-table" },
    ];
    expect(matchesTargeting(rules, {})).toBe(false);
    expect(
      matchesTargeting(rules, {
        pageUrl: "https://example.com/pricing",
        timeOnPage: 45,
        selectors: ["#pricing-table"],
      }),
    ).toBe(true);
    expect(
      matchesTargeting(rules, {
        pageUrl: "https://example.com/pricing",
        timeOnPage: 10,
        selectors: ["#pricing-table"],
      }),
    ).toBe(false);
  });

  test("malformed rules are dropped instead of widening the audience", () => {
    expect(
      parseTargetingRules([
        { type: "attribute", key: "", operator: "equals", value: "pro" },
        { type: "selector" },
        { type: "time_on_page", operator: "gte", value: -1 },
      ]),
    ).toEqual([]);
    expect(normalizeTargetingRules('{"not":"an array"}')).toEqual([]);
    expect(
      normalizeTargetingRules(
        '[{"type":"attribute","key":"plan","operator":"equals","value":"pro"}]',
      ),
    ).toHaveLength(1);
  });
});
