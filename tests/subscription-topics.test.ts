import { describe, expect, test } from "bun:test";

import {
  DEFAULT_SUBSCRIPTION_TOPICS,
  PRODUCT_UPDATES_TOPIC,
  WINBACK_TOPIC,
  isSubscriptionTopicKey,
  normalizeTopicKey,
  topicFormSchema,
} from "@/features/subscribers/topics";

describe("subscription topics", () => {
  test("ships the two built-in lists", () => {
    expect(DEFAULT_SUBSCRIPTION_TOPICS.map((topic) => topic.key)).toEqual([
      PRODUCT_UPDATES_TOPIC,
      WINBACK_TOPIC,
    ]);
  });

  test("normalizes display names into stable keys", () => {
    expect(normalizeTopicKey("Survey invitations")).toBe("survey_invitations");
    expect(normalizeTopicKey("  Product news!  ")).toBe("product_news");
    expect(normalizeTopicKey("123")).toBe("");
  });

  test("accepts only lowercase underscore keys", () => {
    expect(isSubscriptionTopicKey("survey_invitations")).toBe(true);
    expect(isSubscriptionTopicKey("Survey invitations")).toBe(false);
    expect(isSubscriptionTopicKey("_hidden")).toBe(false);
    expect(isSubscriptionTopicKey("a")).toBe(false);
  });

  test("new topics default to active and a safe description", () => {
    const parsed = topicFormSchema.parse({ name: "Announcements" });
    expect(parsed.active).toBe(true);
    expect(parsed.description).toBe("");
    expect(parsed.position).toBe(0);
  });
});
