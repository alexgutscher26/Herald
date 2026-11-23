import { describe, expect, test } from "bun:test";

import {
  renderFeedbackReplyEmail,
  renderWeeklyDigestEmail,
} from "@/features/email/templates";
import { effectiveDigestFrequency } from "@/features/subscribers/digest-frequency";
import { emailKey, isValidEmail, normalizeEmail } from "@/lib/email";

describe("normalizeEmail", () => {
  test("trims surrounding whitespace and lowercases", () => {
    expect(normalizeEmail("  Ada@Example.COM  ")).toBe("ada@example.com");
    expect(normalizeEmail("ADA@EXAMPLE.COM")).toBe("ada@example.com");
  });

  test("returns an empty string for blank input", () => {
    expect(normalizeEmail("   ")).toBe("");
  });

  test("is idempotent — the canonical form is a fixed point", () => {
    const once = normalizeEmail("  Mixed.Case@Example.COM ");
    expect(normalizeEmail(once)).toBe(once);
  });

  test("does not strip dots or plus tags (provider-specific behaviour)", () => {
    expect(normalizeEmail("first.last+tag@gmail.com")).toBe("first.last+tag@gmail.com");
  });

  test("preserves internal structure exactly", () => {
    expect(normalizeEmail("o'brien+news@sub.domain.co.uk")).toBe(
      "o'brien+news@sub.domain.co.uk",
    );
  });
});

describe("emailKey", () => {
  test("matches normalizeEmail — one canonical strategy", () => {
    const raw = "  Someone@Example.ORG ";
    expect(emailKey(raw)).toBe(normalizeEmail(raw));
  });
});

describe("notification email templates", () => {
  test("the weekly digest lists releases and escapes customer text", () => {
    const rendered = renderWeeklyDigestEmail({
      productName: "Herald",
      items: [{ title: "Faster <search>", summary: "Search & filters" }],
      url: "https://app.test/p/acme/herald/updates",
      preferencesUrl: "https://app.test/p/acme/herald/preferences?token=abc",
    });

    expect(rendered.subject).toContain("Herald");
    expect(rendered.html).toContain("Faster &lt;search&gt;");
    expect(rendered.html).toContain("Search &amp; filters");
    expect(rendered.html).toContain("Turn off the weekly digest");
    expect(rendered.text).toContain("Faster <search>");
  });

  test("the daily digest uses today's copy and still links preferences", () => {
    const rendered = renderWeeklyDigestEmail({
      productName: "Herald",
      items: [{ title: "Faster search", summary: "Search is quicker." }],
      url: "https://app.test/p/acme/herald/updates",
      preferencesUrl: "https://app.test/p/acme/herald/preferences?token=abc",
      cadence: "daily",
    });
    expect(rendered.subject).toContain("today's updates");
    expect(rendered.html).toContain("Today in product");
    expect(rendered.html).toContain("Turn off the daily digest");
  });

  test("a reply notification names the author without allowing injected markup", () => {
    const rendered = renderFeedbackReplyEmail({
      productName: "Herald",
      requestTitle: "Dark mode",
      authorName: "<script>alert(1)</script>",
      body: "We are on it.",
      url: "https://app.test/p/acme/herald/board/req_1",
    });

    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).toContain("&lt;script&gt;");
    expect(rendered.text).toContain("We are on it.");
  });
});

describe("digest cadence compatibility", () => {
  test("prefers the explicit cadence and falls back to the legacy weekly flag", () => {
    expect(effectiveDigestFrequency("daily", false)).toBe("daily");
    expect(effectiveDigestFrequency("weekly", false)).toBe("weekly");
    expect(effectiveDigestFrequency("off", true)).toBe("weekly");
    expect(effectiveDigestFrequency("off", false)).toBe("off");
    expect(effectiveDigestFrequency(null, true)).toBe("weekly");
  });
});

describe("isValidEmail", () => {
  test("accepts ordinary addresses", () => {
    for (const value of [
      "ada@example.com",
      "first.last@sub.example.co.uk",
      "o'brien+tag@example.org",
      "x@y.io",
    ]) {
      expect(isValidEmail(value)).toBe(true);
    }
  });

  test("rejects malformed addresses", () => {
    for (const value of [
      "",
      "   ",
      "no-at-sign",
      "@example.com",
      "ada@",
      "ada@example",
      "ada@.example.com",
      "ada@example..com",
      "ada@-example.com",
      "ada@example.com.",
      ".ada@example.com",
      "ada..case@example.com",
      "ada example@example.com",
      "ada@example.com extra",
      `${"a".repeat(65)}@example.com`,
    ]) {
      expect(isValidEmail(value)).toBe(false);
    }
  });

  test("is case-insensitive because it normalizes first", () => {
    expect(isValidEmail("ADA@EXAMPLE.COM")).toBe(true);
  });

  test("rejects over-long addresses", () => {
    expect(isValidEmail(`${"a".repeat(250)}@example.com`)).toBe(false);
  });
});