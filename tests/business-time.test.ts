import { describe, expect, test } from "bun:test";

import { businessMinutesBetween } from "@/features/conversations/business-time";

const WEEKDAYS = [1, 2, 3, 4, 5];
const NINE_TO_FIVE = [
  { days: WEEKDAYS, start: "09:00", end: "17:00" },
];

describe("business-hours SLA clock", () => {
  test("counts only weekday office hours across a weekend", () => {
    const friday = new Date("2026-11-20T16:00:00.000Z");
    const monday = new Date("2026-11-23T10:00:00.000Z");
    expect(businessMinutesBetween(friday, monday, "UTC", NINE_TO_FIVE)).toBe(120);
  });

  test("supports an overnight window that runs into the next day", () => {
    const start = new Date("2026-11-23T23:00:00.000Z");
    const end = new Date("2026-11-24T07:00:00.000Z");
    expect(
      businessMinutesBetween(start, end, "UTC", [
        { days: [1], start: "22:00", end: "06:00" },
      ]),
    ).toBe(7 * 60);
  });

  test("does not double count overlapping windows", () => {
    const start = new Date("2026-11-23T09:00:00.000Z");
    const end = new Date("2026-11-23T12:00:00.000Z");
    expect(
      businessMinutesBetween(start, end, "UTC", [
        { days: [1], start: "09:00", end: "12:00" },
        { days: [1], start: "10:00", end: "11:00" },
      ]),
    ).toBe(180);
  });

  test("uses the configured IANA timezone, not the server zone", () => {
    // 14:00–16:00 UTC is 09:00–11:00 in New York in November.
    expect(
      businessMinutesBetween(
        new Date("2026-11-23T14:00:00.000Z"),
        new Date("2026-11-23T16:00:00.000Z"),
        "America/New_York",
        NINE_TO_FIVE,
      ),
    ).toBe(120);
  });

  test("null means 24/7 and an empty list stops the clock", () => {
    const start = new Date("2026-11-23T00:00:00.000Z");
    const end = new Date("2026-11-23T02:30:00.000Z");
    expect(businessMinutesBetween(start, end, "UTC", null)).toBe(150);
    expect(businessMinutesBetween(start, end, "UTC", [])).toBe(0);
  });

  test("a closed gap adds no time", () => {
    const start = new Date("2026-11-21T00:00:00.000Z");
    const end = new Date("2026-11-23T00:00:00.000Z");
    expect(businessMinutesBetween(start, end, "UTC", NINE_TO_FIVE)).toBe(0);
  });
});
