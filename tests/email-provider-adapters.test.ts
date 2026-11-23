import { createHmac } from "node:crypto";

import { describe, expect, test } from "bun:test";

import {
  deliveryEventsFromResend,
  htmlToText,
  normalizeResendInboundEmail,
  parseResendInboundEvent,
  resendReceivedEmailUrl,
  verifyResendWebhookSignature,
} from "@/features/email/resend-events";
import { listUnsubscribeHeaders } from "@/features/email/unsubscribe";
import {
  createSenderVerificationToken,
  hashSenderVerificationToken,
  isSenderVerificationToken,
} from "@/features/email/verification-token";

function signedHeaders(input: {
  secret: string;
  id: string;
  timestamp: string;
  payload: string;
}) {
  const key = Buffer.from(input.secret.slice("whsec_".length), "base64");
  const signature = createHmac("sha256", key)
    .update(`${input.id}.${input.timestamp}.${input.payload}`)
    .digest("base64");
  return new Headers({
    "svix-id": input.id,
    "svix-timestamp": input.timestamp,
    "svix-signature": `v1,${signature}`,
  });
}

describe("Resend webhook signatures", () => {
  const secret = `whsec_${Buffer.from("a-test-signing-key-with-32-bytes!!").toString("base64")}`;
  const payload = JSON.stringify({ type: "email.received", data: { email_id: "em_1" } });
  const now = new Date("2026-01-08T12:00:00.000Z");
  const timestamp = String(Math.floor(now.getTime() / 1000));

  test("accepts a valid V1 signature over the raw body", () => {
    const headers = signedHeaders({ secret, id: "msg_1", timestamp, payload });
    expect(
      verifyResendWebhookSignature({ headers, payload, secret, now }),
    ).toBe(true);
  });

  test("rejects a tampered body, a stale timestamp and a malformed secret", () => {
    const headers = signedHeaders({ secret, id: "msg_1", timestamp, payload });
    expect(
      verifyResendWebhookSignature({
        headers,
        payload: `${payload} `,
        secret,
        now,
      }),
    ).toBe(false);
    expect(
      verifyResendWebhookSignature({
        headers,
        payload,
        secret,
        now: new Date("2026-01-08T13:00:00.000Z"),
      }),
    ).toBe(false);
    expect(
      verifyResendWebhookSignature({ headers, payload, secret: "not-a-secret", now }),
    ).toBe(false);
  });
});

describe("Resend inbound adapter", () => {
  test("reads the event id and normalizes HTML-only content", () => {
    const event = parseResendInboundEvent({
      type: "email.received",
      data: {
        email_id: "em_123",
        to: ["support+abc@inbound.example.test"],
        from: "ada@example.test",
        subject: "Checkout",
      },
    });
    expect(event?.emailId).toBe("em_123");

    const normalized = normalizeResendInboundEmail({
      event: event!,
      email: {
        to: ["support+abc@inbound.example.test"],
        from: "ada@example.test",
        subject: "Checkout",
        text: "",
        html: "<p>Hello &amp; welcome</p><p>Second line</p>",
        headers: { from: "Ada <ada@example.test>", "auto-submitted": "no" },
        message_id: "<rfc@example.test>",
      },
    });

    expect(normalized).toMatchObject({
      to: "support+abc@inbound.example.test",
      from: "ada@example.test",
      fromName: "Ada",
      subject: "Checkout",
      messageId: "<rfc@example.test>",
      headers: { from: "Ada <ada@example.test>", "auto-submitted": "no" },
    });
    expect(normalized?.text).toContain("Hello & welcome");
    expect(normalized?.text).toContain("Second line");
  });

  test("ignores unsupported events and strips script text", () => {
    expect(parseResendInboundEvent({ type: "email.delivered", data: {} })).toBeNull();
    expect(htmlToText("<script>alert(1)</script><p>Safe</p>")).toContain("Safe");
    expect(htmlToText("<script>alert(1)</script><p>Safe</p>")).not.toContain("alert");
  });

  test("builds the receiving endpoint from the send endpoint", () => {
    expect(resendReceivedEmailUrl("em_1")).toBe(
      "https://api.resend.com/emails/receiving/em_1?html_format=cid",
    );
    expect(resendReceivedEmailUrl("em_1", "https://mail.test/v1/emails")).toBe(
      "https://mail.test/v1/emails/receiving/em_1?html_format=cid",
    );
  });
});

describe("Resend delivery adapter", () => {
  test("maps delivered, bounced and complained using email_id", () => {
    const events = deliveryEventsFromResend({
      type: "email.bounced",
      data: {
        email_id: "em_1",
        bounce: { message: "Mailbox does not exist" },
      },
    });
    expect(events).toEqual([
      { type: "bounced", messageId: "em_1", reason: "Mailbox does not exist" },
    ]);
    expect(
      deliveryEventsFromResend({
        type: "email.complained",
        data: { email_id: "em_2" },
      }),
    ).toEqual([{ type: "complained", messageId: "em_2", reason: null }]);
    expect(
      deliveryEventsFromResend({
        type: "email.delivered",
        data: { email_id: "em_3" },
      }),
    ).toEqual([{ type: "delivered", messageId: "em_3", reason: null }]);
  });

  test("ignores unknown event types", () => {
    expect(
      deliveryEventsFromResend({ type: "email.opened", data: { email_id: "em_1" } }),
    ).toEqual([]);
  });
});

describe("sender verification tokens", () => {
  test("are random, recognisable and stored only as a hash", () => {
    const first = createSenderVerificationToken();
    const second = createSenderVerificationToken();
    expect(first).not.toBe(second);
    expect(isSenderVerificationToken(first)).toBe(true);
    expect(hashSenderVerificationToken(first)).toHaveLength(64);
    expect(hashSenderVerificationToken(first)).not.toContain(first);
  });
});

describe("List-Unsubscribe headers", () => {
  test("emit the one-click URL and required POST value", () => {
    const headers = listUnsubscribeHeaders(
      "https://app.example.test",
      "abcdefghijklmnopqrstuvwxyz0123456789ABCD",
    );
    expect(headers["List-Unsubscribe"]).toBe(
      "<https://app.example.test/api/public/email-preferences/unsubscribe?token=abcdefghijklmnopqrstuvwxyz0123456789ABCD>",
    );
    expect(headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });
});
