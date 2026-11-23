import { describe, expect, test } from "bun:test";

import {
  activityKey,
  describeSegmentRule,
  matchesSegment,
  parseSegmentRules,
  type SegmentRule,
} from "@/features/segments/rules";

const customer = {
  id: "customer-1",
  emailNormalized: "ada@example.com",
  traits: { plan: "pro", company_size: 42, beta: true },
};

function matches(rules: SegmentRule[], activity: string[] = []): boolean {
  return matchesSegment(rules, {
    customer,
    activity: new Set(activity.map((event) => activityKey(customer.id, event))),
  });
}

describe("segment rules", () => {
  test("parses only complete, bounded rules", () => {
    const rules = parseSegmentRules([
      { type: "trait", key: "plan", operator: "equals", value: "pro" },
      { type: "trait", key: "plan", operator: "equals", value: "" },
      { type: "activity", event: "report_exported", operator: "performed", withinDays: 9999 },
      { type: "plan", operator: "in", value: "pro, scale" },
      { type: "bogus" },
    ]);

    expect(rules).toEqual([
      { type: "trait", key: "plan", operator: "equals", value: "pro" },
      { type: "activity", event: "report_exported", operator: "performed", withinDays: 365 },
      { type: "plan", operator: "in", value: "pro, scale" },
    ]);
  });

  test("matches traits, plan and list membership case-insensitively", () => {
    expect(
      matches([{ type: "trait", key: "company_size", operator: "equals", value: "42" }]),
    ).toBe(true);
    expect(matches([{ type: "plan", operator: "in", value: "starter, pro" }])).toBe(true);
    expect(matches([{ type: "plan", operator: "equals", value: "free" }])).toBe(false);
    expect(matches([{ type: "trait", key: "missing", operator: "exists", value: "" }])).toBe(
      false,
    );
  });

  test("activity is deny-by-default and supports not_performed", () => {
    expect(
      matches([
        { type: "activity", event: "report_exported", operator: "performed", withinDays: 30 },
      ]),
    ).toBe(false);
    expect(
      matches(
        [{ type: "activity", event: "report_exported", operator: "performed", withinDays: 30 }],
        ["report_exported"],
      ),
    ).toBe(true);
    expect(
      matches(
        [
          {
            type: "activity",
            event: "report_exported",
            operator: "not_performed",
            withinDays: 30,
          },
        ],
        [],
      ),
    ).toBe(true);
  });

  test("an empty segment matches nobody", () => {
    expect(matches([])).toBe(false);
  });

  test("describes rules in operator language", () => {
    expect(
      describeSegmentRule({ type: "plan", operator: "in", value: "pro, scale" }),
    ).toBe("plan is one of pro, scale");
    expect(
      describeSegmentRule({
        type: "activity",
        event: "report_exported",
        operator: "performed",
        withinDays: 1,
      }),
    ).toBe("report_exported in the last 1 day");
  });
});
