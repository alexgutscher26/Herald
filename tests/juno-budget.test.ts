import { describe, expect, test } from "bun:test";

import { budgetAlertThreshold } from "@/features/juno/budget-policy";

describe("Mira budget alert threshold", () => {
  test("fires at 80% of a positive limit, rounded up", () => {
    expect(budgetAlertThreshold(5)).toBe(4);
    expect(budgetAlertThreshold(100)).toBe(80);
    expect(budgetAlertThreshold(99)).toBe(80);
    expect(budgetAlertThreshold(1)).toBe(1);
  });

  test("has no alert point when paid generation is disabled", () => {
    expect(budgetAlertThreshold(0)).toBeNull();
    expect(budgetAlertThreshold(-5)).toBeNull();
    expect(budgetAlertThreshold(Number.NaN)).toBeNull();
  });
});
