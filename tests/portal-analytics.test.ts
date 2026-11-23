import { describe, expect, test } from "bun:test";

import { buildPortalFunnel } from "@/features/analytics/portal-funnel";
import { FEATUREBASE_BENCHMARK, PLANS } from "@/features/entitlements/plans";

describe("portal analytics", () => {
  test("builds a page-view to submission funnel with step rates", () => {
    const funnel = buildPortalFunnel({ views: 200, submitStarts: 50, submissions: 10 });
    expect(funnel.map((step) => step.count)).toEqual([200, 50, 10]);
    expect(funnel[0]?.rate).toBeNull();
    expect(funnel[1]?.rate).toBeCloseTo(0.25);
    expect(funnel[2]?.rate).toBeCloseTo(0.2);
  });

  test("a zero baseline produces no misleading rate", () => {
    expect(buildPortalFunnel({ views: 0, submitStarts: 4, submissions: 1 })[1]?.rate).toBeNull();
    expect(buildPortalFunnel({ views: 0, submitStarts: 0, submissions: 0 })[2]?.rate).toBeNull();
  });
});

describe("Featurebase benchmark", () => {
  test("records the published limits and a reason for every difference", () => {
    expect(FEATUREBASE_BENCHMARK.plans.free.boards).toBe(1);
    expect(FEATUREBASE_BENCHMARK.plans.professional.boards).toBe(10);
    expect(FEATUREBASE_BENCHMARK.plans.enterprise.boards).toBeNull();
    expect(FEATUREBASE_BENCHMARK.plans.professional.trialDays).toBe(10);
    expect(FEATUREBASE_BENCHMARK.differences.length).toBeGreaterThan(0);
    for (const difference of FEATUREBASE_BENCHMARK.differences) {
      expect(difference.reason.trim().length).toBeGreaterThan(10);
    }
  });

  test("benchmark does not silently change Herald's plan limits", () => {
    expect(PLANS.free.limits.boardsPerProduct).toBe(2);
    expect(PLANS.starter.limits.boardsPerProduct).toBe(5);
    expect(PLANS.pro.limits.boardsPerProduct).toBeNull();
    expect(FEATUREBASE_BENCHMARK.herald.free.products).toBe(1);
    expect(FEATUREBASE_BENCHMARK.herald.starter.products).toBe(5);
    expect(FEATUREBASE_BENCHMARK.herald.pro.products).toBeNull();
    expect(PLANS.starter.name).toBe("Indie");
  });
});
