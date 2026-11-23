import { describe, expect, test } from "bun:test";

import { RESERVED_SLUGS, SLUG_MAX_LENGTH, slugExists, slugify, validateSlug } from "@/lib/slug";

describe("slugify", () => {
  test("lowercases and separates words", () => {
    expect(slugify("Hello World")).toBe("hello-world");
    expect(slugify("Acme Inc.")).toBe("acme-inc");
  });

  test("collapses runs of separators and trims hyphens", () => {
    expect(slugify("  ---Multiple   dashes---  ")).toBe("multiple-dashes");
    expect(slugify("a__b__c")).toBe("a-b-c");
  });

  test("strips diacritics rather than dropping the whole word", () => {
    expect(slugify("Café Münster")).toBe("cafe-munster");
  });

  test("returns an empty string when nothing usable remains", () => {
    expect(slugify("日本語")).toBe("");
    expect(slugify("   ")).toBe("");
    expect(slugify("!!!")).toBe("");
  });

  test("caps length at the maximum without leaving a trailing hyphen", () => {
    const slug = slugify(`${"a".repeat(60)} end`);
    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    expect(slug.endsWith("-")).toBe(false);
  });

  test("is idempotent", () => {
    const once = slugify("Some Product Name");
    expect(slugify(once)).toBe(once);
  });
});

describe("validateSlug", () => {
  test("accepts a well-formed slug", () => {
    const result = validateSlug("my-product-2");
    expect(result).toEqual({ ok: true, slug: "my-product-2" });
  });

  test("rejects empty and whitespace-padded input", () => {
    expect(validateSlug("").ok).toBe(false);
    expect(validateSlug("   ").ok).toBe(false);

    const padded = validateSlug(" my-product ");
    expect(padded.ok).toBe(false);
    if (!padded.ok) expect(padded.reason).toContain("whitespace");
  });

  test("rejects values that are too short or too long", () => {
    expect(validateSlug("ab").ok).toBe(false);
    expect(validateSlug("a".repeat(SLUG_MAX_LENGTH + 1)).ok).toBe(false);
    expect(validateSlug("abc").ok).toBe(true);
  });

  test("rejects uppercase, underscores and other unsafe characters", () => {
    for (const bad of ["My-Product", "my_product", "my product", "my.product", "my--product", "-lead", "trail-"]) {
      const result = validateSlug(bad);
      expect(result.ok).toBe(false);
    }
  });

  test("rejects reserved application segments", () => {
    for (const reserved of RESERVED_SLUGS.slice(0, 6)) {
      const result = validateSlug(reserved);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain("reserved");
    }
  });

  test("returns the trimmed slug on success", () => {
    const result = validateSlug("ok-slug");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.slug).toBe("ok-slug");
  });
});

describe("slugExists", () => {
  test("matches case-insensitively", () => {
    expect(slugExists("acme", ["ACME", "other"])).toBe(true);
    expect(slugExists("other", ["ACME"])).toBe(false);
    expect(slugExists("  acme ", ["Acme"])).toBe(true);
  });
});