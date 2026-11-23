import { describe, expect, test } from "bun:test";

import {
  buildSegmentFacets,
  MAX_SEGMENT_FACETS,
  requestMatchesSegment,
  segmentMatchesFilter,
  traitMatchesValue,
} from "@/features/public/segments";
import type { CustomerSegment } from "@/features/public/segments";

function segment(
  customerId: string,
  customerTraits: Record<string, unknown>,
  companyTraits: Record<string, unknown>[] = [],
): CustomerSegment {
  return {
    customerId,
    emailDomain: "example.test",
    customerTraits,
    companyTraits,
  };
}

describe("trait matching", () => {
  test("matches strings case-insensitively, numbers and booleans", () => {
    const traits = { plan: " Pro ", seats: 25, churn_risk: false };
    expect(traitMatchesValue(traits, "plan", "pro")).toBe(true);
    expect(traitMatchesValue(traits, "seats", "25")).toBe(true);
    expect(traitMatchesValue(traits, "churn_risk", "false")).toBe(true);
    expect(traitMatchesValue(traits, "plan", "enterprise")).toBe(false);
    expect(traitMatchesValue(traits, "missing", "pro")).toBe(false);
  });

  test("checks a customer trait and every company trait", () => {
    const row = segment("a", { plan: "pro" }, [
      { company_size: "50-200" },
      { industry: "saas" },
    ]);

    expect(segmentMatchesFilter(row, { key: "plan", value: "pro" })).toBe(true);
    expect(
      segmentMatchesFilter(row, { key: "company_size", value: "50-200" }),
    ).toBe(true);
    expect(segmentMatchesFilter(row, { key: "industry", value: "saas" })).toBe(true);
    expect(segmentMatchesFilter(row, { key: "industry", value: "retail" })).toBe(
      false,
    );
  });
});

describe("request segment filters", () => {
  const requesters = [
    segment("a", { plan: "free" }, [{ company_size: "1-10" }]),
    segment("b", { plan: "pro" }, [{ company_size: "200+" }]),
  ];

  test("an absent filter matches every request", () => {
    expect(requestMatchesSegment(null, requesters)).toBe(true);
    expect(requestMatchesSegment(null, [])).toBe(true);
  });

  test("matches when at least one requester is in the segment", () => {
    expect(
      requestMatchesSegment({ key: "plan", value: "pro" }, requesters),
    ).toBe(true);
    expect(
      requestMatchesSegment({ key: "company_size", value: "1-10" }, requesters),
    ).toBe(true);
  });

  test("a request without identified requesters never matches", () => {
    expect(
      requestMatchesSegment({ key: "plan", value: "pro" }, []),
    ).toBe(false);
  });
});

describe("segment facets", () => {
  test("lists distinct stored values with plan and company size labelled", () => {
    const facets = buildSegmentFacets([
      segment("a", { plan: "pro" }, [{ company_size: "50-200" }]),
      segment("b", { plan: "pro" }, [
        { company_size: "50-200" },
        { industry: "saas" },
      ]),
    ]);

    expect(facets).toEqual([
      { key: "plan", value: "pro", kind: "plan" },
      { key: "company_size", value: "50-200", kind: "company_size" },
      { key: "industry", value: "saas", kind: "trait" },
    ]);
  });

  test("skips object values and caps a noisy trait list", () => {
    const noisy = Array.from({ length: MAX_SEGMENT_FACETS + 20 }, (_, index) =>
      segment(`c${index}`, {
        note: { nested: true },
        region: `r${index}`,
      }),
    );

    const facets = buildSegmentFacets(noisy);
    expect(facets).toHaveLength(MAX_SEGMENT_FACETS);
    expect(facets.every((facet) => facet.key === "region")).toBe(true);
  });
});
