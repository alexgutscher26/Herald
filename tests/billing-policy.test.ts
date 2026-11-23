import { describe, expect, test } from "bun:test";

import {
  dunningGraceUntil,
  dunningReminderAt,
  isOlderStripeEvent,
  nextTrialEnd,
} from "@/features/billing/policy";

describe("Stripe event ordering", () => {
  test("rejects an event older than the newest applied event", () => {
    const last = new Date("2026-11-21T12:00:00.000Z");
    const lastSeconds = Math.floor(last.getTime() / 1000);
    expect(isOlderStripeEvent(lastSeconds - 1, last)).toBe(true);
    expect(isOlderStripeEvent(lastSeconds, last)).toBe(false);
    expect(isOlderStripeEvent(lastSeconds + 1, last)).toBe(false);
  });

  test("missing timestamps are accepted so a retry is never dropped", () => {
    expect(isOlderStripeEvent(undefined, new Date())).toBe(false);
    expect(isOlderStripeEvent(1_700_000_000, null)).toBe(false);
  });
});

describe("dunning timing", () => {
  test("the first failure owns a seven-day grace window", () => {
    const start = new Date("2026-11-21T00:00:00.000Z");
    expect(dunningGraceUntil(start).toISOString()).toBe("2026-11-28T00:00:00.000Z");
  });

  test("reminders land on day 0, 3 and 6", () => {
    const start = new Date("2026-11-21T00:00:00.000Z");
    expect(dunningReminderAt(start, 1).toISOString()).toBe("2026-11-21T00:00:00.000Z");
    expect(dunningReminderAt(start, 2).toISOString()).toBe("2026-11-24T00:00:00.000Z");
    expect(dunningReminderAt(start, 3).toISOString()).toBe("2026-11-27T00:00:00.000Z");
  });
});

describe("trial extension", () => {
  test("extends from the existing end when the trial is still running", () => {
    const now = new Date("2026-11-21T00:00:00.000Z");
    const current = new Date("2026-11-25T00:00:00.000Z");
    expect(nextTrialEnd(current, now, 7).toISOString()).toBe("2026-12-02T00:00:00.000Z");
  });

  test("starts from now after the trial has lapsed and clamps the request", () => {
    const now = new Date("2026-11-21T00:00:00.000Z");
    const current = new Date("2026-11-01T00:00:00.000Z");
    expect(nextTrialEnd(current, now, 7).toISOString()).toBe("2026-11-28T00:00:00.000Z");
    expect(nextTrialEnd(current, now, 0).toISOString()).toBe("2026-11-22T00:00:00.000Z");
    expect(nextTrialEnd(current, now, 99).toISOString()).toBe("2026-12-21T00:00:00.000Z");
  });
});