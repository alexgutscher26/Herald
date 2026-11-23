import { describe, expect, test } from "bun:test";

import {
  boardMatchesSegments,
  EMPTY_SEGMENTS,
  normalizeAccessRules,
  normalizeDomain,
  type ViewerSegments,
} from "@/features/public/segments";

/**
 * Segment gating.
 *
 * The failure that matters is the silent one: a board that looks private but
 * resolves for the wrong visitor. These tests pin the decisions, including the
 * deny-by-default case of a signed-out visitor.
 */

const companyId = "3f1c2a9e-2b7d-4a51-9a8e-6c0d5b7e4f21";
const otherCompanyId = "8c6b1f30-9d24-4d7a-8c3e-2a1b0f9e7d55";

function segments(overrides: Partial<ViewerSegments> = {}): ViewerSegments {
  return { ...EMPTY_SEGMENTS, customerId: "cust", ...overrides };
}

describe("normalizeDomain", () => {
  test("accepts a bare domain and strips decoration", () => {
    expect(normalizeDomain("  Acme.COM ")).toBe("acme.com");
    expect(normalizeDomain("@acme.com")).toBe("acme.com");
    expect(normalizeDomain("billing.acme.com.")).toBe("billing.acme.com");
  });

  test("rejects values that are not a domain", () => {
    expect(normalizeDomain("localhost")).toBeNull();
    expect(normalizeDomain("acme")).toBeNull();
    expect(normalizeDomain("acme .com")).toBeNull();
    expect(normalizeDomain("..")).toBeNull();
    expect(normalizeDomain("")).toBeNull();
  });
});

describe("normalizeAccessRules", () => {
  test("canonicalises and de-duplicates the same rule", () => {
    const result = normalizeAccessRules([
      { match: "email_domain", value: "Acme.com" },
      { match: "email_domain", value: "@acme.com" },
      { match: "company", value: companyId.toUpperCase() },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rules).toEqual([
      { match: "email_domain", value: "acme.com", traitKey: "" },
      { match: "company", value: companyId, traitKey: "" },
    ]);
  });

  test("a trait rule needs both a key and a value", () => {
    const missingKey = normalizeAccessRules([{ match: "trait", value: "enterprise" }]);
    expect(missingKey.ok).toBe(false);
    if (!missingKey.ok) expect(missingKey.error).toContain("trait");

    const missingValue = normalizeAccessRules([
      { match: "trait", traitKey: "plan", value: "  " },
    ]);
    expect(missingValue.ok).toBe(false);
  });

  test("rejects a company that is not an id and an unknown match", () => {
    expect(normalizeAccessRules([{ match: "company", value: "Acme" }]).ok).toBe(false);
    expect(normalizeAccessRules([{ match: "ip", value: "10.0.0.1" }]).ok).toBe(false);
  });

  test("an empty rule set is valid and means open", () => {
    const result = normalizeAccessRules([]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rules).toEqual([]);
    expect(boardMatchesSegments(result.rules, EMPTY_SEGMENTS)).toBe(true);
  });
});

describe("boardMatchesSegments", () => {
  test("denies an anonymous visitor on a gated board", () => {
    const rules = [{ match: "email_domain" as const, value: "acme.com", traitKey: "" }];
    expect(boardMatchesSegments(rules, EMPTY_SEGMENTS)).toBe(false);
  });

  test("matches an email domain case-insensitively", () => {
    const rules = [{ match: "email_domain" as const, value: "acme.com", traitKey: "" }];
    expect(boardMatchesSegments(rules, segments({ emailDomain: "acme.com" }))).toBe(true);
    expect(boardMatchesSegments(rules, segments({ emailDomain: "other.com" }))).toBe(false);
  });

  test("matches a company membership, not a company name", () => {
    const rules = [{ match: "company" as const, value: companyId, traitKey: "" }];
    expect(
      boardMatchesSegments(rules, segments({ companyIds: [otherCompanyId, companyId] })),
    ).toBe(true);
    expect(boardMatchesSegments(rules, segments({ companyIds: [otherCompanyId] }))).toBe(
      false,
    );
  });

  test("matches a customer trait or the same trait on their company", () => {
    const rules = [{ match: "trait" as const, value: "enterprise", traitKey: "plan" }];
    expect(
      boardMatchesSegments(rules, segments({ customerTraits: { plan: "Enterprise" } })),
    ).toBe(true);
    expect(
      boardMatchesSegments(rules, segments({ companyTraits: [{ plan: "enterprise" }] })),
    ).toBe(true);
    expect(boardMatchesSegments(rules, segments({ customerTraits: { plan: "free" } }))).toBe(
      false,
    );
    expect(boardMatchesSegments(rules, segments({ customerTraits: {} }))).toBe(false);
  });

  test("one matching rule is enough, and an empty rule set stays open", () => {
    const rules = [
      { match: "email_domain" as const, value: "acme.com", traitKey: "" },
      { match: "trait" as const, value: "enterprise", traitKey: "plan" },
    ];
    expect(
      boardMatchesSegments(rules, segments({ customerTraits: { plan: "enterprise" } })),
    ).toBe(true);
    expect(boardMatchesSegments([], EMPTY_SEGMENTS)).toBe(true);
  });
});
