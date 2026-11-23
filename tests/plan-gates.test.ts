import { describe, expect, test } from "bun:test";

import {
  PLAN_FEATURES,
  PLAN_GATE_MATRIX,
  PLAN_IDS,
  PLANS,
  hasFeature,
  usageStatus,
  type PlanFeature,
  type PlanId,
} from "@/features/entitlements/plans";

/** Customer-visible promise per plan. Changes here require a plan change. */
const FEATURE_MATRIX: Record<PlanId, Record<PlanFeature, boolean>> = {
  free: {
    publicFeedback: true,
    widget: true,
    api: false,
    ai: false,
    winback: true,
    guestPosting: false,
    privateBoards: false,
    customBranding: false,
    customDomains: false,
    advancedSearch: false,
    sso: false,
    identityMasking: false,
    hideAttribution: false,
  },
  starter: {
    publicFeedback: true,
    widget: true,
    api: false,
    ai: false,
    winback: true,
    guestPosting: true,
    privateBoards: true,
    customBranding: true,
    customDomains: true,
    advancedSearch: false,
    sso: false,
    identityMasking: false,
    hideAttribution: true,
  },
  pro: {
    publicFeedback: true,
    widget: true,
    api: true,
    ai: true,
    winback: true,
    guestPosting: true,
    privateBoards: true,
    customBranding: true,
    customDomains: true,
    advancedSearch: true,
    sso: true,
    identityMasking: true,
    hideAttribution: true,
  },
  lifetime: {
    publicFeedback: true,
    widget: true,
    api: true,
    ai: true,
    winback: true,
    guestPosting: true,
    privateBoards: true,
    customBranding: true,
    customDomains: true,
    advancedSearch: true,
    sso: false,
    identityMasking: false,
    hideAttribution: true,
  },
};

describe("plan gate matrix", () => {
  for (const gate of PLAN_GATE_MATRIX) {
    test(`${gate.feature} names a server gate on every plan`, () => {
      expect(gate.serverGate.trim().length).toBeGreaterThan(8);
      for (const plan of PLAN_IDS) {
        expect(typeof PLANS[plan].features[gate.feature]).toBe("boolean");
      }
    });
  }

  test("every feature has exactly one named server gate", () => {
    const features = PLAN_GATE_MATRIX.map((row) => row.feature);
    expect(features.sort()).toEqual([...PLAN_FEATURES].sort());
    expect(new Set(features).size).toBe(PLAN_FEATURES.length);
    for (const row of PLAN_GATE_MATRIX) {
      expect(row.serverGate.length).toBeGreaterThan(8);
      expect(row.label.length).toBeGreaterThan(0);
    }
  });

  test("the catalogue matches the customer-facing feature matrix", () => {
    for (const plan of PLAN_IDS) {
      for (const feature of PLAN_FEATURES) {
        expect({ plan, feature, allowed: hasFeature(plan, feature) }).toEqual({
          plan,
          feature,
          allowed: FEATURE_MATRIX[plan][feature],
        });
      }
    }
  });

  test("the matrix has no stale plan ids or feature keys", () => {
    expect(Object.keys(FEATURE_MATRIX).sort()).toEqual([...PLAN_IDS].sort());
    for (const plan of PLAN_IDS) {
      expect(Object.keys(FEATURE_MATRIX[plan]).sort()).toEqual([...PLAN_FEATURES].sort());
      expect(Object.keys(PLANS[plan].features).sort()).toEqual([...PLAN_FEATURES].sort());
    }
  });
});

describe("soft limit warnings", () => {
  test("stays normal below 80 percent", () => {
    expect(usageStatus(0, 10)).toEqual({ level: "ok", percent: 0 });
    expect(usageStatus(7, 10)).toEqual({ level: "ok", percent: 70 });
  });

  test("warns at 80 percent and blocks at the cap", () => {
    expect(usageStatus(8, 10)).toEqual({ level: "warning", percent: 80 });
    expect(usageStatus(9, 10)).toEqual({ level: "warning", percent: 90 });
    expect(usageStatus(10, 10)).toEqual({ level: "limit", percent: 100 });
    expect(usageStatus(12, 10)).toEqual({ level: "limit", percent: 100 });
  });

  test("an unlimited allowance never warns", () => {
    expect(usageStatus(1_000, null)).toEqual({ level: "ok", percent: 0 });
  });
});