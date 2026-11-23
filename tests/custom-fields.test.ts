import { describe, expect, test } from "bun:test";

import {
  compareCustomFieldValues,
  customFieldKeyFromLabel,
  customFieldValueFor,
  formatCustomFieldValue,
  isCalendarDate,
  isValidCustomFieldKey,
  matchesCustomFieldFilters,
  normalizeCustomFieldOptions,
  parseCustomFieldValue,
  parseCustomFieldValues,
} from "@/features/feedback/custom-fields";
import type {
  CustomFieldDefinition,
  CustomFieldType,
  CustomFieldValue,
} from "@/types";

function field(
  key: string,
  type: CustomFieldType,
  overrides: Partial<CustomFieldDefinition> = {},
): CustomFieldDefinition {
  return {
    id: `field-${key}`,
    productId: "product-1",
    key,
    label: key,
    description: null,
    type,
    options: type === "select" ? ["Free", "Pro"] : [],
    required: false,
    position: 0,
    archivedAt: null,
    ...overrides,
  };
}

function value(
  postId: string,
  fieldId: string,
  entry: string | number,
): CustomFieldValue {
  return { postId, fieldId, value: entry };
}

describe("custom field definitions", () => {
  test("derives stable keys from labels without rewriting valid ones", () => {
    expect(customFieldKeyFromLabel("Plan")).toBe("plan");
    expect(customFieldKeyFromLabel("Account size (employees)")).toBe(
      "account_size_employees",
    );
    expect(customFieldKeyFromLabel("2026 renewal")).toBe("f_2026_renewal");
    expect(customFieldKeyFromLabel("  —  ")).toBe("field");
    expect(isValidCustomFieldKey("plan")).toBe(true);
    expect(isValidCustomFieldKey("Plan")).toBe(false);
    expect(isValidCustomFieldKey("2plan")).toBe(false);
  });

  test("normalises options by trimming, de-duplicating and bounding", () => {
    expect(normalizeCustomFieldOptions([" Free ", "Pro", "Free", 3, ""])).toEqual([
      "Free",
      "Pro",
    ]);
    expect(normalizeCustomFieldOptions("Free")).toEqual([]);
  });

  test("rejects impossible calendar dates", () => {
    expect(isCalendarDate("2026-02-28")).toBe(true);
    expect(isCalendarDate("2026-02-31")).toBe(false);
    expect(isCalendarDate("2026-2-3")).toBe(false);
  });
});

describe("custom field values", () => {
  test("coerces each type and treats blank input as unset", () => {
    expect(parseCustomFieldValue(field("notes", "text"), "  hello  ")).toEqual({
      ok: true,
      value: "hello",
    });
    expect(parseCustomFieldValue(field("seats", "number"), "42")).toEqual({
      ok: true,
      value: 42,
    });
    expect(parseCustomFieldValue(field("plan", "select"), "Pro")).toEqual({
      ok: true,
      value: "Pro",
    });
    expect(parseCustomFieldValue(field("renewal", "date"), "2026-05-01")).toEqual({
      ok: true,
      value: "2026-05-01",
    });
    expect(parseCustomFieldValue(field("notes", "text"), "   ")).toEqual({
      ok: true,
      value: null,
    });
    expect(parseCustomFieldValue(field("seats", "number"), "many").ok).toBe(false);
    expect(parseCustomFieldValue(field("plan", "select"), "Enterprise").ok).toBe(false);
    expect(parseCustomFieldValue(field("renewal", "date"), "2026-02-31").ok).toBe(false);
  });

  test("requires required fields and rejects unknown keys", () => {
    const required = field("plan", "select", { required: true });
    expect(parseCustomFieldValues([required], {})).toEqual({
      ok: false,
      errors: { plan: "plan is required." },
    });
    expect(parseCustomFieldValues([required], { plan: "Pro" })).toEqual({
      ok: true,
      values: new Map([["field-plan", "Pro"]]),
    });
    expect(parseCustomFieldValues([field("plan", "text")], { pln: "Pro" })).toEqual({
      ok: false,
      errors: { pln: "There is no custom field named “pln”." },
    });
  });

  test("finds a stored value by post and field", () => {
    const values = [value("post-1", "field-plan", "Pro")];
    expect(customFieldValueFor(values, "post-1", "field-plan")).toBe("Pro");
    expect(customFieldValueFor(values, "post-2", "field-plan")).toBeUndefined();
  });

  test("formats numbers without inventing precision", () => {
    expect(formatCustomFieldValue("number", 1200.5)).toBe("1,200.5");
    expect(formatCustomFieldValue("date", "2026-05-01")).toBe("2026-05-01");
  });
});

describe("custom field filters", () => {
  const fields = [field("plan", "select"), field("seats", "number"), field("notes", "text")];
  const values = [
    value("post-1", "field-plan", "Pro"),
    value("post-1", "field-seats", 42),
    value("post-1", "field-notes", "Wants SSO"),
  ];

  test("matches every supplied filter and no filter matches everything", () => {
    expect(matchesCustomFieldFilters(fields, values, "post-1", {})).toBe(true);
    expect(
      matchesCustomFieldFilters(fields, values, "post-1", {
        plan: "Pro",
        seats: "42",
        notes: "sso",
      }),
    ).toBe(true);
    expect(
      matchesCustomFieldFilters(fields, values, "post-1", { plan: "Free" }),
    ).toBe(false);
    expect(
      matchesCustomFieldFilters(fields, values, "post-2", { plan: "Pro" }),
    ).toBe(false);
  });

  test("an unknown key is a non-match rather than a silent pass", () => {
    expect(matchesCustomFieldFilters(fields, values, "post-1", { nope: "x" })).toBe(false);
  });
});

describe("custom field sorting", () => {
  test("numbers compare numerically instead of lexically", () => {
    expect(compareCustomFieldValues("number", 2, 10)).toBeLessThan(0);
    expect(compareCustomFieldValues("number", 10, 2)).toBeGreaterThan(0);
    expect(compareCustomFieldValues("number", 4, 4)).toBe(0);
  });

  test("text, select and date compare as stable strings", () => {
    expect(compareCustomFieldValues("text", "alpha", "beta")).toBeLessThan(0);
    expect(compareCustomFieldValues("select", "Pro", "pro")).toBe(0);
    expect(compareCustomFieldValues("date", "2026-01-02", "2026-02-01")).toBeLessThan(0);
  });
});
