import { describe, expect, test } from "bun:test";

import { classifyConversationSpam } from "@/features/conversations/spam";

/**
 * The pre-inbox filter is deliberately conservative: one weak signal is not
 * enough, and an ordinary support message with a link must stay in Queue.
 */

describe("classifyConversationSpam", () => {
  test("keeps an ordinary support message clean", () => {
    const verdict = classifyConversationSpam({
      subject: "Export fails on Mondays",
      body: "The CSV export returns an empty file. I tried Chrome and Safari.",
    });
    expect(verdict.spam).toBe(false);
    expect(verdict.reason).toBeNull();
    expect(verdict.score).toBe(0);
  });

  test("allows a normal message that links to a screenshot", () => {
    const verdict = classifyConversationSpam({
      body: "Here is the error I see: https://example.test/screenshot.png",
    });
    expect(verdict.spam).toBe(false);
  });

  test("flags a message stuffed with links", () => {
    const verdict = classifyConversationSpam({
      subject: "Great offer",
      body: "See https://a.test https://b.test https://c.test https://d.test now",
    });
    expect(verdict.spam).toBe(true);
    expect(verdict.reason).toContain("many_links");
  });

  test("flags high-signal spam keywords", () => {
    const verdict = classifyConversationSpam({
      body: "We sell guaranteed loan approvals and buy backlinks cheaply.",
    });
    expect(verdict.spam).toBe(true);
    expect(verdict.reason).toContain("spam_keywords");
  });

  test("a single weak signal stays below the threshold", () => {
    const verdict = classifyConversationSpam({
      body: "Two links: https://one.test and https://two.test",
    });
    expect(verdict.reason).toContain("several_links");
    expect(verdict.spam).toBe(false);
  });

  test("combines shouting and repetition into one verdict", () => {
    const verdict = classifyConversationSpam({
      body: `BUY THIS RIGHT NOW IT IS AMAZING AND CHEAP FOREVER ${"!".repeat(20)}`,
    });
    expect(verdict.spam).toBe(true);
    expect(verdict.reason).toContain("shouting");
    expect(verdict.reason).toContain("repetition");
  });

  test("a product can turn screening off or add its own phrase", () => {
    expect(
      classifyConversationSpam(
        { body: "guaranteed loan" },
        {
          enabled: false,
          minimumScore: 2,
          linkThreshold: 4,
          keywords: ["guaranteed loan"],
          shouting: true,
          repetition: true,
          moneyPromise: true,
        },
      ).spam,
    ).toBe(false);

    const custom = classifyConversationSpam(
      { body: "we sell organic widgets" },
      {
        enabled: true,
        minimumScore: 2,
        linkThreshold: 4,
        keywords: ["organic widgets"],
        shouting: false,
        repetition: false,
        moneyPromise: false,
      },
    );
    expect(custom.spam).toBe(true);
    expect(custom.reason).toContain("spam_keywords");
  });
});
