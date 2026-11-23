import { describe, expect, test } from "bun:test";

import {
  isInSendWindow,
  normalizeTimeZone,
  recurrenceKey,
  sendWindowProblem,
} from "@/features/engagement/cadence";

describe("outbound send windows", () => {
  test("uses the message timezone rather than UTC", () => {
    const noonUtc = new Date("2026-01-15T12:00:00.000Z");
    expect(isInSendWindow(noonUtc, "09:00", "17:00", "UTC")).toBe(true);
    expect(isInSendWindow(noonUtc, "09:00", "17:00", "America/New_York")).toBe(false);
    expect(isInSendWindow(noonUtc, "06:00", "09:00", "America/New_York")).toBe(true);
  });

  test("supports windows that cross midnight", () => {
    const late = new Date("2026-01-15T23:30:00.000Z");
    const morning = new Date("2026-01-15T06:00:00.000Z");
    expect(isInSendWindow(late, "22:00", "07:00", "UTC")).toBe(true);
    expect(isInSendWindow(morning, "22:00", "07:00", "UTC")).toBe(true);
    expect(isInSendWindow(new Date("2026-01-15T12:00:00.000Z"), "22:00", "07:00", "UTC")).toBe(
      false,
    );
  });

  test("start equal to end means all day", () => {
    expect(isInSendWindow(new Date("2026-01-15T12:00:00.000Z"), "09:00", "09:00")).toBe(true);
  });

  test("rejects malformed windows and falls back to UTC for bad zones", () => {
    expect(sendWindowProblem("9:00", "17:00")).not.toBeNull();
    expect(sendWindowProblem("09:00", "25:00")).not.toBeNull();
    expect(sendWindowProblem("09:00", "17:00")).toBeNull();
    expect(normalizeTimeZone("Not/AZone")).toBe("UTC");
    expect(normalizeTimeZone("Europe/Berlin")).toBe("Europe/Berlin");
  });

  test("recurrence keys are stable per period", () => {
    const now = new Date("2026-01-15T12:00:00.000Z");
    expect(recurrenceKey("one_shot", now)).toBe("one-shot");
    expect(recurrenceKey("daily", now)).toBe("2026-01-15");
    expect(recurrenceKey("weekly", now)).toBe(recurrenceKey("weekly", now));
  });
});
