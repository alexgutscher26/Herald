import { describe, expect, test } from "bun:test";

import { renderConversationReplyEmail } from "@/features/email/templates";
import {
  classifyInboundEmail,
  conversationReplyAddress,
  parseInboundRecipient,
  productInboundAddress,
} from "@/features/email/inbound-address";
import {
  isWithinSchedule,
  normalizeSchedule,
} from "@/features/operators/schedule";

/**
 * Pure rules behind the support channels: address routing, junk filtering and
 * operator availability. No database is involved, so these run in the ordinary
 * unit suite.
 */

describe("inbound addressing", () => {
  const token = "abcDEF1234567890_-xyz";

  test("routes product and conversation plus-addresses", () => {
    expect(parseInboundRecipient(productInboundAddress(token))).toEqual({
      kind: "product",
      token,
    });
    expect(
      parseInboundRecipient(`"Support" <${conversationReplyAddress(token)}>`),
    ).toEqual({ kind: "conversation", token });
  });

  test("rejects another domain, an unknown prefix and a short token", () => {
    expect(parseInboundRecipient(`support+${token}@evil.test`)).toBeNull();
    expect(parseInboundRecipient(`billing+${token}@inbound.herald.local`)).toBeNull();
    expect(parseInboundRecipient("support+short@inbound.herald.local")).toBeNull();
    expect(parseInboundRecipient("not-an-address")).toBeNull();
  });

  test("uses the configured domain", () => {
    const previous = process.env.EMAIL_INBOUND_DOMAIN;
    process.env.EMAIL_INBOUND_DOMAIN = "Mail.Example.test";
    try {
      expect(productInboundAddress(token)).toBe(
        `support+${token}@mail.example.test`,
      );
      expect(parseInboundRecipient(`support+${token}@mail.example.test`)).toEqual({
        kind: "product",
        token,
      });
    } finally {
      if (previous === undefined) delete process.env.EMAIL_INBOUND_DOMAIN;
      else process.env.EMAIL_INBOUND_DOMAIN = previous;
    }
  });
});

describe("inbound junk filtering", () => {
  test("drops bounces, auto-replies and marketing", () => {
    expect(classifyInboundEmail({ from: "MAILER-DAEMON@example.test" })).toBe(
      "bounce",
    );
    expect(
      classifyInboundEmail({
        from: "ada@example.test",
        headers: { "content-type": "multipart/report; boundary=x" },
      }),
    ).toBe("bounce");
    expect(
      classifyInboundEmail({
        from: "ada@example.test",
        headers: { "auto-submitted": "auto-replied" },
      }),
    ).toBe("auto_reply");
    expect(
      classifyInboundEmail({
        from: "ada@example.test",
        subject: "Out of office until Monday",
      }),
    ).toBe("auto_reply");
    expect(
      classifyInboundEmail({
        from: "news@example.test",
        headers: { "list-unsubscribe": "<mailto:unsubscribe@example.test>" },
      }),
    ).toBe("marketing");
    expect(
      classifyInboundEmail({
        from: "news@example.test",
        headers: { precedence: "bulk" },
      }),
    ).toBe("marketing");
  });

  test("keeps a human message, even one mentioning an automatic reply", () => {
    expect(
      classifyInboundEmail({
        from: "ada@example.test",
        subject: "Automatic reply needed for the export",
        headers: { "auto-submitted": "no" },
      }),
    ).toBeNull();
  });
});

describe("conversation reply template", () => {
  test("keeps the reply address in the text and strips header newlines", () => {
    const rendered = renderConversationReplyEmail({
      productName: "Herald",
      subject: "Cannot export\nBcc: evil@example.test",
      body: "We fixed it.",
      replyTo: "reply+token12345678@inbound.herald.local",
    });

    expect(rendered.subject).toBe("Re: Cannot export Bcc: evil@example.test");
    expect(rendered.text).toContain("We fixed it.");
    expect(rendered.text).toContain("reply+token12345678@inbound.herald.local");
    expect(rendered.html).not.toContain("<Bcc");
  });
});

describe("operator schedule", () => {
  test("validates windows", () => {
    expect(normalizeSchedule(null)).toEqual({ ok: true, schedule: null });
    expect(
      normalizeSchedule([{ days: [1, 2], start: "09:00", end: "17:00" }]),
    ).toEqual({
      ok: true,
      schedule: [{ days: [1, 2], start: "09:00", end: "17:00" }],
    });
    expect(normalizeSchedule([{ days: [], start: "09:00", end: "17:00" }]).ok).toBe(
      false,
    );
    expect(normalizeSchedule([{ days: [1], start: "9:00", end: "17:00" }]).ok).toBe(
      false,
    );
    expect(normalizeSchedule([{ days: [1], start: "09:00", end: "09:00" }]).ok).toBe(
      false,
    );
  });

  test("evaluates the window in the operator timezone", () => {
    const monday = new Date("2026-01-05T14:00:00.000Z");
    expect(
      isWithinSchedule(monday, "UTC", [{ days: [1], start: "09:00", end: "17:00" }]),
    ).toBe(true);
    expect(
      isWithinSchedule(monday, "UTC", [{ days: [1], start: "14:00", end: "14:00" }]),
    ).toBe(false);
    // 14:00 UTC is 09:00 in New York in January.
    expect(
      isWithinSchedule(monday, "America/New_York", [
        { days: [1], start: "09:00", end: "10:00" },
      ]),
    ).toBe(true);
    expect(
      isWithinSchedule(monday, "America/New_York", [
        { days: [1], start: "10:00", end: "11:00" },
      ]),
    ).toBe(false);
  });

  test("null is always, an empty list is never", () => {
    const now = new Date("2026-01-05T14:00:00.000Z");
    expect(isWithinSchedule(now, "UTC", null)).toBe(true);
    expect(isWithinSchedule(now, "UTC", [])).toBe(false);
  });
});
