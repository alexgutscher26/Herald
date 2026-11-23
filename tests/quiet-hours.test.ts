import { describe, expect, test } from "bun:test";

import {
  formatTimeOfDay,
  isWithinQuietHours,
  parseQuietHours,
  parseTimeOfDay,
  quietHoursDeferral,
  quietHoursWindowFromFields,
} from "@/features/subscribers/quiet-hours";

describe("quiet hours", () => {
  test("parses a valid overnight window", () => {
    const result = parseQuietHours({
      start: "22:00",
      end: "07:00",
      timezone: "Europe/Madrid",
    });
    expect(result).toEqual({
      ok: true,
      window: { startMinute: 1320, endMinute: 420, timezone: "Europe/Madrid" },
    });
  });

  test("rejects equal times, malformed times and unknown timezones", () => {
    expect(
      parseQuietHours({ start: "09:00", end: "09:00", timezone: "UTC" }).ok,
    ).toBe(false);
    expect(
      parseQuietHours({ start: "25:00", end: "07:00", timezone: "UTC" }).ok,
    ).toBe(false);
    expect(
      parseQuietHours({ start: "22:00", end: "07:00", timezone: "Mars/Olympus" }).ok,
    ).toBe(false);
  });

  test("formats and parses minutes past midnight", () => {
    expect(parseTimeOfDay("00:00")).toBe(0);
    expect(parseTimeOfDay("23:59")).toBe(1439);
    expect(formatTimeOfDay(420)).toBe("07:00");
  });

  test("handles windows that wrap midnight and windows that do not", () => {
    const overnight = {
      startMinute: 22 * 60,
      endMinute: 7 * 60,
      timezone: "UTC",
    };
    expect(isWithinQuietHours(overnight, new Date("2026-11-21T23:30:00Z"))).toBe(true);
    expect(isWithinQuietHours(overnight, new Date("2026-11-21T06:59:00Z"))).toBe(true);
    expect(isWithinQuietHours(overnight, new Date("2026-11-21T07:00:00Z"))).toBe(false);

    const daytime = {
      startMinute: 9 * 60,
      endMinute: 17 * 60,
      timezone: "UTC",
    };
    expect(isWithinQuietHours(daytime, new Date("2026-11-21T12:00:00Z"))).toBe(true);
    expect(isWithinQuietHours(daytime, new Date("2026-11-21T17:00:00Z"))).toBe(false);
  });

  test("uses the subscriber's timezone, not the server's", () => {
    const daytime = {
      startMinute: 9 * 60,
      endMinute: 17 * 60,
      timezone: "Asia/Tokyo",
    };
    // 23:30 UTC is 08:30 the next day in Tokyo, before the window opens.
    expect(isWithinQuietHours(daytime, new Date("2026-11-21T23:30:00Z"))).toBe(false);
    expect(isWithinQuietHours(daytime, new Date("2026-11-22T00:30:00Z"))).toBe(true);
  });

  test("returns null for incomplete or malformed stored fields", () => {
    expect(
      quietHoursWindowFromFields({
        quietHoursStart: null,
        quietHoursEnd: null,
        quietHoursTimezone: null,
      }),
    ).toBeNull();
    expect(
      quietHoursWindowFromFields({
        quietHoursStart: 1320,
        quietHoursEnd: 420,
        quietHoursTimezone: "Not/AZone",
      }),
    ).toBeNull();
  });

  test("defers by a short fixed interval", () => {
    const now = new Date("2026-11-21T12:00:00Z");
    expect(quietHoursDeferral(now).toISOString()).toBe("2026-11-21T12:15:00.000Z");
  });
});
