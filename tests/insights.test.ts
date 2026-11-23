import { describe, expect, test } from "bun:test";

import {
  MAX_INSIGHT_LENGTH,
  normalizeInsightDraft,
  summarizeRequestDemand,
} from "@/features/feedback/insight-rules";

/**
 * Evidence rules.
 *
 * An insight is what a roadmap decision points at later, so the rules that keep
 * it honest — real words, a known source, a timestamp that is not in the future
 * — are worth pinning down without a database in the way.
 */

const now = new Date("2026-11-06T10:00:00.000Z");

describe("summarizeRequestDemand", () => {
  test("counts a customer once however often they wrote in", () => {
    const demand = summarizeRequestDemand([
      { id: "a", authorCustomerId: "cust_1", sourceRef: "conv_1" },
      { id: "b", authorCustomerId: "cust_1", sourceRef: "conv_2" },
      { id: "c", authorCustomerId: "cust_2", sourceRef: "conv_3" },
    ]);

    expect(demand).toEqual({ customers: 2, sources: 3 });
  });

  test("counts one conversation once even with several messages", () => {
    const demand = summarizeRequestDemand([
      { id: "a", authorCustomerId: "cust_1", sourceRef: "conv_1" },
      { id: "b", authorCustomerId: "cust_1", sourceRef: " conv_1 " },
    ]);

    expect(demand).toEqual({ customers: 1, sources: 1 });
  });

  test("falls back to a named author when no customer row is attached", () => {
    const demand = summarizeRequestDemand([
      { id: "a", authorLabel: "  Ada Lovelace " },
      { id: "b", authorLabel: "ada lovelace" },
      { id: "c" },
    ]);

    // Two spellings of one name are one customer; an unlabelled row still
    // counts as its own source.
    expect(demand).toEqual({ customers: 1, sources: 3 });
  });

  test("is empty for a request with no evidence", () => {
    expect(summarizeRequestDemand([])).toEqual({ customers: 0, sources: 0 });
  });
});

describe("normalizeInsightDraft", () => {
  test("keeps the customer's wording and trims the edges", () => {
    const result = normalizeInsightDraft({
      quote: "  We would pay for SSO today.\r\nPlease ship it.  ",
      source: "call",
      sourceRef: "  call_123  ",
      authorLabel: "  Ada Lovelace ",
      now,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.quote).toBe("We would pay for SSO today.\nPlease ship it.");
    expect(result.value.source).toBe("call");
    expect(result.value.sourceRef).toBe("call_123");
    expect(result.value.authorLabel).toBe("Ada Lovelace");
    expect(result.value.occurredAt.toISOString()).toBe(now.toISOString());
  });

  test("rejects a quote too short to be evidence", () => {
    const result = normalizeInsightDraft({ quote: " ok ", source: "note", now });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.field).toBe("quote");
  });

  test("caps the quote at the stored length", () => {
    const result = normalizeInsightDraft({
      quote: "a".repeat(MAX_INSIGHT_LENGTH + 1),
      source: "note",
      now,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.field).toBe("quote");
    expect(result.error).toContain(MAX_INSIGHT_LENGTH.toLocaleString("en-US"));
  });

  test("rejects a source the product does not support", () => {
    const result = normalizeInsightDraft({ quote: "Worth recording.", source: "pigeon", now });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.field).toBe("source");
  });

  test("rejects an invalid or future timestamp", () => {
    const invalid = normalizeInsightDraft({
      quote: "Worth recording.",
      source: "note",
      occurredAt: new Date(Number.NaN),
      now,
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.field).toBe("occurredAt");

    const future = normalizeInsightDraft({
      quote: "Worth recording.",
      source: "note",
      occurredAt: new Date(now.getTime() + 10 * 60_000),
      now,
    });
    expect(future.ok).toBe(false);
    if (!future.ok) expect(future.field).toBe("occurredAt");
  });

  test("accepts a timestamp inside the clock-skew grace", () => {
    const result = normalizeInsightDraft({
      quote: "Worth recording.",
      source: "email",
      occurredAt: new Date(now.getTime() + 30_000),
      now,
    });
    expect(result.ok).toBe(true);
  });

  test("drops blank optional pointers instead of storing empty strings", () => {
    const result = normalizeInsightDraft({
      quote: "Worth recording.",
      source: "api",
      sourceRef: "   ",
      authorLabel: "",
      now,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sourceRef).toBeNull();
    expect(result.value.authorLabel).toBeNull();
  });
});
