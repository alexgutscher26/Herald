import { describe, expect, test } from "bun:test";

import {
  buildWidgetSourceContext,
  normalizeSourceUrl,
  normalizeTimezone,
} from "@/features/conversations/visitor";

/**
 * Visitor context is context, not identity: only http(s) pages survive, the
 * timezone must be a real IANA zone, and the user agent is truncated instead
 * of stored whole.
 */

describe("normalizeSourceUrl", () => {
  test("keeps an absolute http(s) page and trims surrounding whitespace", () => {
    expect(normalizeSourceUrl("https://shop.example.test/checkout?step=2")).toBe(
      "https://shop.example.test/checkout?step=2",
    );
    expect(normalizeSourceUrl("  http://shop.example.test/pricing  ")).toBe(
      "http://shop.example.test/pricing",
    );
  });

  test("rejects other schemes, relative values and oversized urls", () => {
    expect(normalizeSourceUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeSourceUrl("data:text/html,hi")).toBeNull();
    expect(normalizeSourceUrl("/checkout")).toBeNull();
    expect(normalizeSourceUrl("not a url")).toBeNull();
    expect(normalizeSourceUrl("")).toBeNull();
    expect(normalizeSourceUrl(null)).toBeNull();
    expect(
      normalizeSourceUrl(`https://example.test/${"a".repeat(2048)}`),
    ).toBeNull();
  });
});

describe("normalizeTimezone", () => {
  test("keeps a valid IANA zone and rejects anything Intl refuses", () => {
    expect(normalizeTimezone("Europe/Berlin")).toBe("Europe/Berlin");
    expect(normalizeTimezone("UTC")).toBe("UTC");
    expect(normalizeTimezone("Mars/Olympus")).toBeNull();
    expect(normalizeTimezone("")).toBeNull();
    expect(normalizeTimezone(null)).toBeNull();
    expect(normalizeTimezone(`${"x".repeat(65)}`)).toBeNull();
  });
});

describe("buildWidgetSourceContext", () => {
  test("records the widget channel plus the accepted fields", () => {
    const context = buildWidgetSourceContext({
      sourceUrl: "https://shop.example.test/checkout",
      locale: "de-DE,de;q=0.9",
      timezone: "Europe/Berlin",
      userAgent: "Mozilla/5.0",
    });

    expect(context).toEqual({
      channel: "widget",
      referrer: "https://shop.example.test/checkout",
      locale: "de-DE,de;q=0.9",
      timezone: "Europe/Berlin",
      userAgent: "Mozilla/5.0",
    });
  });

  test("omits rejected values rather than storing empty keys", () => {
    const context = buildWidgetSourceContext({
      sourceUrl: "javascript:alert(1)",
      timezone: "Mars/Olympus",
      locale: "   ",
      userAgent: "",
    });

    expect(context).toEqual({ channel: "widget" });
    expect(Object.keys(context)).toEqual(["channel"]);
  });

  test("truncates a long user agent and locale instead of rejecting them", () => {
    const context = buildWidgetSourceContext({
      locale: "a".repeat(200),
      userAgent: "b".repeat(600),
    });

    expect(context.locale?.length).toBe(120);
    expect(context.userAgent?.length).toBe(500);
  });
});
