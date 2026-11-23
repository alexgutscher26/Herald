import { describe, expect, test } from "bun:test";

import { parseSupportCapture } from "@/features/support-tools/capture";

describe("support-tool capture", () => {
  test("maps a Zendesk ticket to a request", () => {
    const captured = parseSupportCapture("zendesk", {
      type: "ticket.created",
      ticket: {
        id: 4821,
        subject: "Invoice shows the wrong VAT",
        description: "<p>Our invoice lists 0% VAT.</p><p>Please fix it.</p>",
        requester: { name: "Ada Lovelace", email: "ada@example.com" },
        created_at: "2026-11-20T10:00:00Z",
      },
    });

    expect(captured).toMatchObject({
      externalId: "zendesk:4821",
      title: "Invoice shows the wrong VAT",
      authorName: "Ada Lovelace",
      authorEmail: "ada@example.com",
    });
    expect(captured?.body).toContain("Our invoice lists 0% VAT.");
    expect(captured?.body).toContain("Please fix it.");
    expect(captured?.occurredAt?.toISOString()).toBe("2026-11-20T10:00:00.000Z");
  });

  test("maps an Intercom conversation with parts", () => {
    const captured = parseSupportCapture("intercom", {
      type: "conversation.user.created",
      data: {
        item: {
          id: "conv_123",
          created_at: 1_700_000_000,
          source: {
            subject: "Cannot export",
            body: "<p>The export button does nothing.</p>",
            author: { name: "Grace Hopper", email: "grace@example.com" },
          },
          conversation_parts: {
            conversation_parts: [
              { body: "<p>It happens in Chrome.</p>" },
              { body: "It happens in Safari too." },
            ],
          },
        },
      },
    });

    expect(captured).toMatchObject({
      externalId: "intercom:conv_123",
      title: "Cannot export",
      authorName: "Grace Hopper",
      authorEmail: "grace@example.com",
    });
    expect(captured?.body).toContain("The export button does nothing.");
    expect(captured?.body).toContain("It happens in Chrome.");
    expect(captured?.body).toContain("It happens in Safari too.");
  });

  test("rejects a payload without identity or content", () => {
    expect(parseSupportCapture("zendesk", { ticket: { id: 1 } })).toBeNull();
    expect(parseSupportCapture("intercom", { data: { item: { id: "conv_1" } } })).toBeNull();
    expect(parseSupportCapture("zendesk", null)).toBeNull();
  });

  test("uses a fallback title and decodes common entities", () => {
    const captured = parseSupportCapture("zendesk", {
      ticket: {
        id: 9,
        description: "<p>Fish &amp; chips</p>",
        requester: { email: "customer@example.com" },
      },
    });
    expect(captured?.title).toBe("Fish & chips");
    expect(captured?.authorName).toBeNull();
    expect(captured?.authorEmail).toBe("customer@example.com");
  });
});
