import { describe, expect, test } from "bun:test";

import {
  analyzeText,
  MODERATION_REASON_DETAILS,
  reasonLabel,
} from "@/features/moderation/analyze";

describe("analyzeText", () => {
  test("leaves ordinary feedback unflagged", () => {
    const result = analyzeText({
      title: "Dark mode",
      body: "Please add a dark theme. I use the editor at night and the white background is hard on my eyes.",
    });

    expect(result.reasons).toEqual([]);
    expect(result.spamSignals).toEqual([]);
    expect(result.abuseSignals).toEqual([]);
  });

  test("detects a payment card number without returning it", () => {
    const result = analyzeText({
      body: "My card is 4111 1111 1111 1111 and the charge failed.",
    });

    expect(result.reasons).toEqual(["sensitive_info"]);
    expect(result.sensitiveFindings).toEqual(["payment_card"]);
    expect(JSON.stringify(result)).not.toContain("4111 1111 1111 1111");
  });

  test("detects credentials and private keys", () => {
    expect(
      analyzeText({ body: "password = hunter2hunter2" }).reasons,
    ).toContain("sensitive_info");
    expect(
      analyzeText({ body: "-----BEGIN PRIVATE KEY-----\nabc" }).reasons,
    ).toContain("sensitive_info");
  });

  test("flags promotional spam phrases and many links", () => {
    const result = analyzeText({
      body: "Buy now! https://a.example https://b.example https://c.example https://d.example",
    });

    expect(result.reasons).toContain("spam");
    expect(result.spamSignals).toContain("known_phrase");
    expect(result.spamSignals).toContain("many_links");
  });

  test("flags link shorteners", () => {
    expect(analyzeText({ body: "see https://bit.ly/abc" }).spamSignals).toContain(
      "link_shortener",
    );
  });

  test("flags shouted text and repeated lines", () => {
    expect(
      analyzeText({
        body: "THIS IS THE BEST THING EVER AND EVERYONE SHOULD USE IT RIGHT NOW WITHOUT DELAY BECAUSE IT IS ABSOLUTELY INCREDIBLE AND LIFE CHANGING",
      }).reasons,
    ).toContain("spam");

    expect(
      analyzeText({ body: Array(5).fill("same line repeated").join("\n") }).reasons,
    ).toContain("spam");
  });

  test("flags abusive language but not quoted error text", () => {
    expect(analyzeText({ body: "You are an asshole." }).reasons).toContain("abuse");
    expect(
      analyzeText({ body: "The request failed with status 500." }).reasons,
    ).toEqual([]);
  });
});

describe("reason labels", () => {
  test("maps known reasons and humanizes unknown ones", () => {
    expect(reasonLabel("scan_unavailable")).toBe("Image scan unavailable");
    expect(reasonLabel("custom_reason")).toBe("custom reason");
    expect(MODERATION_REASON_DETAILS.spam).toContain("promotional");
  });
});
