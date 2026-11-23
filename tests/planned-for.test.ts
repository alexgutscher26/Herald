import { describe, expect, test } from "bun:test";

import {
  normalizePlannedFor,
  plannedForLabel,
} from "@/features/feedback/planned-for";

/**
 * A planned-for value is shown to customers by policy, so the shape is
 * validated once and rendered the same everywhere.
 */

describe("normalizePlannedFor", () => {
  test("accepts a quarter and a date, trimming the edges", () => {
    expect(normalizePlannedFor(" 2027-Q1 ")).toEqual({ ok: true, value: "2027-Q1" });
    expect(normalizePlannedFor("2027-03-31")).toEqual({
      ok: true,
      value: "2027-03-31",
    });
  });

  test("treats an empty value as clearing the field", () => {
    expect(normalizePlannedFor("")).toEqual({ ok: true, value: null });
    expect(normalizePlannedFor("   ")).toEqual({ ok: true, value: null });
    expect(normalizePlannedFor(null)).toEqual({ ok: true, value: null });
  });

  test("rejects a quarter outside Q1–Q4 and malformed text", () => {
    for (const input of ["2027-Q0", "2027-Q5", "2027Q1", "Q1 2027", "soon"]) {
      const result = normalizePlannedFor(input);
      expect(result.ok).toBe(false);
    }
  });

  test("rejects impossible calendar dates", () => {
    for (const input of ["2027-02-30", "2027-13-01", "2027-04-31", "1899-01-01"]) {
      const result = normalizePlannedFor(input);
      expect(result.ok).toBe(false);
    }
  });

  test("accepts a leap day and rejects a non-leap one", () => {
    expect(normalizePlannedFor("2028-02-29").ok).toBe(true);
    expect(normalizePlannedFor("2027-02-29").ok).toBe(false);
  });
});

describe("plannedForLabel", () => {
  test("formats quarters and dates", () => {
    expect(plannedForLabel("2027-Q1")).toBe("Q1 2027");
    expect(plannedForLabel("2027-03-31")).toBe("Mar 31, 2027");
  });

  test("falls back to the stored text for an unknown shape", () => {
    expect(plannedForLabel("next quarter")).toBe("next quarter");
  });
});
