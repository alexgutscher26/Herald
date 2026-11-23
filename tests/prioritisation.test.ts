import { describe, expect, test } from "bun:test";

import {
  companyArr,
  companyRevenue,
  comparePostsBySignal,
  compareSignals,
  computePriorityScore,
  computeSignals,
  distinctRequesters,
  normalizeScaleValue,
  REVENUE_WEIGHT_UNIT,
  requesterWeight,
  sumKnownRevenue,
  TOP_UNMET_MIN_SCORE,
  topUnmetDemand,
  valuePerEffort,
} from "@/features/feedback/prioritisation";
import type { CustomerRevenue, FeedbackPost } from "@/types";

function post(
  id: string,
  createdAt: string,
  overrides: Partial<FeedbackPost> = {},
): FeedbackPost {
  return {
    id,
    productId: "product-1",
    boardId: "board-1",
    title: id,
    description: "",
    category: "feature_request",
    status: "new",
    privacy: "public",
    authorName: "Ada",
    authorEmail: null,
    authorCustomerId: null,
    company: null,
    createdAt,
    updatedAt: createdAt,
    voteCount: 0,
    commentCount: 0,
    releaseId: null,
    mergedIntoId: null,
    hiddenAt: null,
    authorBanned: false,
    ...overrides,
  } as FeedbackPost;
}

function revenue(
  customerId: string,
  companyId: string,
  values: Partial<CustomerRevenue> = {},
): CustomerRevenue {
  return {
    customerId,
    companyId,
    companyName: companyId,
    annualRevenue: null,
    openDealValue: null,
    weightBasis: null,
    ...values,
  };
}

describe("prioritisation inputs", () => {
  test("narrows stored numbers to the 1–5 scale", () => {
    expect(normalizeScaleValue(3)).toBe(3);
    expect(normalizeScaleValue("5")).toBe(5);
    expect(normalizeScaleValue(0)).toBeNull();
    expect(normalizeScaleValue(6)).toBeNull();
    expect(normalizeScaleValue("")).toBeNull();
    expect(normalizeScaleValue(null)).toBeNull();
  });

  test("derives value per effort only when both inputs exist", () => {
    expect(valuePerEffort(4, 2)).toBe(2);
    expect(valuePerEffort(3, 2)).toBe(1.5);
    expect(valuePerEffort(null, 2)).toBeNull();
    expect(valuePerEffort(4, null)).toBeNull();
    expect(valuePerEffort(4, 0)).toBeNull();
  });

  test("weights each requester once and adds known revenue units", () => {
    expect(requesterWeight(3, null)).toBe(3);
    expect(requesterWeight(3, 0)).toBe(3);
    expect(requesterWeight(3, REVENUE_WEIGHT_UNIT * 2 + 999)).toBe(5);
  });

  test("computes impact per effort multiplied by demand", () => {
    expect(computePriorityScore(4, 2, 3)).toBe(6);
    expect(computePriorityScore(5, 1, 1)).toBe(5);
    expect(computePriorityScore(4, 2, 0)).toBe(2);
    expect(computePriorityScore(null, 2, 3)).toBeNull();
    expect(computePriorityScore(4, null, 3)).toBeNull();
    expect(computePriorityScore(4, 0, 3)).toBeNull();
  });

  test("keeps unknown values null instead of zero", () => {
    const signals = computeSignals({
      impact: null,
      businessValue: null,
      effort: null,
      requesterCount: 0,
      knownArr: null,
    });
    expect(signals.impact).toBeNull();
    expect(signals.valuePerEffort).toBeNull();
    expect(signals.knownArr).toBeNull();
    expect(signals.knownOpenDealValue).toBeNull();
    expect(signals.requesterWeight).toBe(0);
    expect(signals.priorityScore).toBeNull();
  });

  test("puts demand and the score together from stored inputs", () => {
    const signals = computeSignals({
      impact: 4,
      businessValue: 3,
      effort: 2,
      requesterCount: 3,
      knownArr: 25_000,
      knownOpenDealValue: 80_000,
      knownWeightBasis: 25_000,
    });

    expect(signals.requesterWeight).toBe(5);
    expect(signals.priorityScore).toBe(10);
    expect(signals.knownOpenDealValue).toBe(80_000);
  });
});

describe("requesters and revenue", () => {
  test("counts each customer once across votes, comments and follows", () => {
    expect(
      distinctRequesters({
        authorCustomerId: "a",
        customerVoteIds: ["a", "b", null],
        commentCustomerIds: ["b", "c"],
        followerCustomerIds: ["c", "d"],
      }),
    ).toEqual(["a", "b", "c", "d"]);
  });

  test("reads ARR directly or annualises MRR, ignoring strings", () => {
    expect(companyArr({ arr: 40_000 })).toBe(40_000);
    expect(companyArr({ mrr: 2_500 })).toBe(30_000);
    expect(companyArr({ arr: "$40k" })).toBeNull();
    expect(companyArr(null)).toBeNull();
  });

  test("prefers a stored ARR trait, then CRM annual revenue, then open deal value", () => {
    expect(
      companyRevenue({
        traits: { arr: 40_000 },
        crmAnnualRevenueCents: 9_000_000,
        crmOpenDealValueCents: 12_000_000,
      }),
    ).toEqual({
      annualRevenue: 40_000,
      openDealValue: 120_000,
      weightBasis: 40_000,
    });

    expect(
      companyRevenue({
        traits: {},
        crmAnnualRevenueCents: 9_000_000,
        crmOpenDealValueCents: 12_000_000,
      }),
    ).toEqual({
      annualRevenue: 90_000,
      openDealValue: 120_000,
      weightBasis: 90_000,
    });

    expect(
      companyRevenue({
        traits: {},
        crmAnnualRevenueCents: null,
        crmOpenDealValueCents: 5_000_000,
      }),
    ).toEqual({
      annualRevenue: null,
      openDealValue: 50_000,
      weightBasis: 50_000,
    });
  });

  test("sums each source once per shared company and keeps pipeline separate", () => {
    expect(
      sumKnownRevenue(["a", "b"], [
        revenue("a", "acme", {
          annualRevenue: 40_000,
          openDealValue: 100_000,
          weightBasis: 40_000,
        }),
        revenue("b", "acme", {
          annualRevenue: 40_000,
          openDealValue: 100_000,
          weightBasis: 40_000,
        }),
        revenue("c", "other", {
          annualRevenue: 99_000,
          weightBasis: 99_000,
        }),
      ]),
    ).toEqual({
      annualRevenue: 40_000,
      openDealValue: 100_000,
      weightBasis: 40_000,
    });

    expect(sumKnownRevenue(["a"], [])).toEqual({
      annualRevenue: null,
      openDealValue: null,
      weightBasis: null,
    });
  });
});

describe("signal sorting", () => {
  test("sorts descending with unset values last", () => {
    const high = computeSignals({
      impact: 5,
      businessValue: 4,
      effort: 2,
      requesterCount: 2,
      knownArr: 50_000,
    });
    const unset = computeSignals({
      impact: null,
      businessValue: null,
      effort: null,
      requesterCount: 1,
      knownArr: null,
    });

    expect(
      compareSignals({ signals: high, votes: 2 }, { signals: unset, votes: 9 }, "impact"),
    ).toBeLessThan(0);
    expect(
      compareSignals({ signals: unset, votes: 9 }, { signals: high, votes: 2 }, "impact"),
    ).toBeGreaterThan(0);
  });

  test("sorts by the computed priority score", () => {
    const higher = computeSignals({
      impact: 5,
      businessValue: 3,
      effort: 1,
      requesterCount: 4,
      knownArr: null,
    });
    const lower = computeSignals({
      impact: 3,
      businessValue: 3,
      effort: 2,
      requesterCount: 1,
      knownArr: null,
    });

    expect(
      compareSignals(
        { signals: higher, votes: 0 },
        { signals: lower, votes: 0 },
        "priority",
      ),
    ).toBeLessThan(0);
  });

  test("falls back to newest when the signal ties", () => {
    const older = post("older", "2026-01-01T00:00:00Z");
    const newer = post("newer", "2026-02-01T00:00:00Z");
    const signals = () =>
      computeSignals({
        impact: 3,
        businessValue: 3,
        effort: 3,
        requesterCount: 1,
        knownArr: null,
      });

    expect(
      comparePostsBySignal(older, newer, signals, () => 0, "impact"),
    ).toBeGreaterThan(0);
  });
});

describe("top unmet demand", () => {
  const high = () =>
    computeSignals({
      impact: TOP_UNMET_MIN_SCORE,
      businessValue: 3,
      effort: 1,
      requesterCount: 0,
      knownArr: null,
    });
  const low = () =>
    computeSignals({
      impact: 2,
      businessValue: 3,
      effort: 1,
      requesterCount: 0,
      knownArr: null,
    });

  test("keeps high-score unlinked requests and lists the oldest first", () => {
    const entries = [
      { post: post("newer", "2026-02-01T00:00:00Z"), signals: high() },
      { post: post("older", "2026-01-01T00:00:00Z"), signals: high() },
    ];

    expect(topUnmetDemand(entries).map((entry) => entry.post.id)).toEqual([
      "older",
      "newer",
    ]);
  });

  test("excludes linked, shipped, hidden, merged and low-score requests", () => {
    const entries = [
      {
        post: post("linked", "2026-01-01T00:00:00Z", { releaseId: "release-1" }),
        signals: high(),
      },
      {
        post: post("shipped", "2026-01-02T00:00:00Z", { status: "shipped" }),
        signals: high(),
      },
      {
        post: post("hidden", "2026-01-03T00:00:00Z", {
          hiddenAt: "2026-01-04T00:00:00Z",
        }),
        signals: high(),
      },
      {
        post: post("merged", "2026-01-05T00:00:00Z", {
          mergedIntoId: "canonical",
        }),
        signals: high(),
      },
      { post: post("low", "2026-01-06T00:00:00Z"), signals: low() },
      { post: post("kept", "2026-01-07T00:00:00Z"), signals: high() },
    ];

    expect(topUnmetDemand(entries).map((entry) => entry.post.id)).toEqual(["kept"]);
  });
});
