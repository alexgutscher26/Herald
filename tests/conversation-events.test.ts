import { describe, expect, test } from "bun:test";

import { parseConversationEvent } from "@/features/live/conversation-event";

describe("conversation event wire format", () => {
  test("parses a message event from the database trigger", () => {
    expect(
      parseConversationEvent({
        type: "conversation",
        event: "message",
        productId: "product-1",
        conversationId: "conversation-1",
        authorType: "customer",
        at: 1_700_000_000_000,
      }),
    ).toEqual({
      type: "conversation",
      event: "message",
      productId: "product-1",
      conversationId: "conversation-1",
      authorType: "customer",
      at: 1_700_000_000_000,
    });
  });

  test("parses typing and presence, ignoring the sender name if absent", () => {
    expect(
      parseConversationEvent({
        type: "typing",
        productId: "p",
        conversationId: "c",
        userId: "u",
        name: "Alex",
        at: 1,
      }),
    ).toMatchObject({ type: "typing", userId: "u", name: "Alex" });

    expect(
      parseConversationEvent({
        type: "presence",
        productId: "p",
        userId: "u",
        name: "Alex",
        at: 1,
      }),
    ).toMatchObject({ type: "presence", userId: "u" });
  });

  test("rejects unknown, malformed and oversized payloads", () => {
    expect(parseConversationEvent(null)).toBeNull();
    expect(parseConversationEvent("message")).toBeNull();
    expect(parseConversationEvent({ type: "typing", productId: "p" })).toBeNull();
    expect(
      parseConversationEvent({
        type: "conversation",
        event: "deleted",
        productId: "p",
        conversationId: "c",
      }),
    ).toBeNull();
    expect(
      parseConversationEvent({
        type: "presence",
        productId: "p",
        userId: "u",
        name: "x".repeat(121),
      }),
    ).toBeNull();
  });

  test("defaults a missing timestamp instead of losing the event", () => {
    const before = Date.now();
    const parsed = parseConversationEvent({
      type: "conversation",
      event: "update",
      productId: "p",
      conversationId: "c",
    });
    expect(parsed?.at).toBeGreaterThanOrEqual(before);
  });
});
