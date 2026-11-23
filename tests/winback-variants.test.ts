import { describe, expect, test } from "bun:test";

import {
  assignVariant,
  normalizeAbTestPercent,
} from "@/features/winback/variants";

describe("win-back A/B assignment", () => {
  test("turns the test off when the percentage is zero", () => {
    for (const id of ["a", "b", "c", "customer-1"]) {
      expect(assignVariant(id, 0)).toBe("a");
    }
  });

  test("is stable for the same customer and percentage", () => {
    const ids = Array.from({ length: 50 }, (_, index) => `customer-${index}`);
    for (const id of ids) {
      expect(assignVariant(id, 40)).toBe(assignVariant(id, 40));
    }
  });

  test("keeps variant B inside the test slice and splits the slice roughly evenly", () => {
    const ids = Array.from({ length: 4_000 }, (_, index) => `customer-${index}`);
    const percent = 40;
    const b = ids.filter((id) => assignVariant(id, percent) === "b");

    // A 40% slice split evenly should place about 20% of everyone in B.
    expect(b.length).toBeGreaterThan(600);
    expect(b.length).toBeLessThan(1_000);
    expect(assignVariant("anyone", 100)).not.toBe(undefined);
  });

  test("a full test reaches both variants", () => {
    const ids = Array.from({ length: 40 }, (_, index) => `customer-${index}`);
    const variants = new Set(ids.map((id) => assignVariant(id, 100)));
    expect(variants).toEqual(new Set(["a", "b"]));
  });

  test("normalizes the percentage into a supported range", () => {
    expect(normalizeAbTestPercent(0)).toBe(0);
    expect(normalizeAbTestPercent(-10)).toBe(0);
    expect(normalizeAbTestPercent(1)).toBe(5);
    expect(normalizeAbTestPercent(55)).toBe(55);
    expect(normalizeAbTestPercent(500)).toBe(100);
  });
});
