import type { OperatorScheduleWindow } from "@/db/schema/support";

/**
 * Business-hours arithmetic for the support SLA.
 *
 * A window belongs to the day it starts on. Overnight windows (22:00–06:00)
 * therefore run into the next local day, and the returned intervals are merged
 * so two overlapping windows are never counted twice. `null` means 24/7; an
 * empty list means the clock never runs.
 *
 * This is intentionally pure: the dashboard and the cron sweep must agree on
 * "how many business minutes is this thread waiting", independent of the
 * server's own timezone.
 */

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

type LocalParts = {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function partsAt(date: Date, timezone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const value = (type: string): string =>
    parts.find((part) => part.type === type)?.value ?? "";

  return {
    year: Number(value("year")),
    month: Number(value("month")),
    day: Number(value("day")),
    weekday: WEEKDAYS.indexOf(value("weekday")),
    hour: Number(value("hour")),
    minute: Number(value("minute")),
  };
}

/**
 * Convert a local wall-clock time to an instant.
 *
 * The first guess treats the wall-clock values as UTC; reading them back in the
 * target zone gives the offset, which is then corrected. Two or three passes
 * are enough around ordinary DST changes. A nonexistent spring-forward time
 * resolves to the nearest real instant, which is what a human would expect.
 */
function localToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string,
): number {
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wanted;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const local = partsAt(new Date(guess), timezone);
    const actual = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
    );
    const delta = wanted - actual;
    if (delta === 0) break;
    guess += delta;
  }
  return guess;
}

function minutesOf(value: string): { hour: number; minute: number } {
  const [hour, minute] = value.split(":").map(Number);
  return { hour: hour ?? 0, minute: minute ?? 0 };
}

export function businessMinutesBetween(
  start: Date,
  end: Date,
  timezone: string,
  windows: OperatorScheduleWindow[] | null,
): number {
  if (end.getTime() <= start.getTime()) return 0;
  if (windows === null) return Math.floor((end.getTime() - start.getTime()) / MINUTE_MS);
  if (windows.length === 0) return 0;

  const first = partsAt(start, timezone);
  const last = partsAt(end, timezone);
  const intervals: Array<[number, number]> = [];

  // Iterate local calendar dates. `Date.UTC` is only a calendar here; it is not
  // used as an instant, so month/day overflow is exactly what we want.
  let cursor = Date.UTC(first.year, first.month - 1, first.day);
  const finalDay = Date.UTC(last.year, last.month - 1, last.day);

  while (cursor <= finalDay) {
    const calendar = new Date(cursor);
    const year = calendar.getUTCFullYear();
    const month = calendar.getUTCMonth() + 1;
    const day = calendar.getUTCDate();
    const weekday = calendar.getUTCDay();

    for (const window of windows) {
      if (!window.days.includes(weekday)) continue;
      const from = minutesOf(window.start);
      const to = minutesOf(window.end);
      const startMinutes = from.hour * 60 + from.minute;
      const endMinutes = to.hour * 60 + to.minute;

      const intervalStart = localToInstant(
        year,
        month,
        day,
        from.hour,
        from.minute,
        timezone,
      );

      if (startMinutes < endMinutes) {
        intervals.push([
          intervalStart,
          localToInstant(year, month, day, to.hour, to.minute, timezone),
        ]);
      } else {
        // Overnight: the first part ends at local midnight, the second runs
        // from midnight on the following calendar day.
        const nextMidnight = localToInstant(year, month, day + 1, 0, 0, timezone);
        intervals.push([intervalStart, nextMidnight]);
        intervals.push([
          nextMidnight,
          localToInstant(year, month, day + 1, to.hour, to.minute, timezone),
        ]);
      }
    }

    cursor += DAY_MS;
  }

  if (intervals.length === 0) return 0;

  intervals.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const interval of intervals) {
    const previous = merged[merged.length - 1];
    if (previous && interval[0] <= previous[1]) {
      previous[1] = Math.max(previous[1], interval[1]);
    } else {
      merged.push([interval[0], interval[1]]);
    }
  }

  const from = start.getTime();
  const to = end.getTime();
  let total = 0;
  for (const [intervalStart, intervalEnd] of merged) {
    const overlap = Math.min(to, intervalEnd) - Math.max(from, intervalStart);
    if (overlap > 0) total += overlap;
  }
  return Math.floor(total / MINUTE_MS);
}

/** Remaining clock time in minutes; negative once the target is exceeded. */
export function slaRemainingMinutes(input: {
  start: Date;
  now: Date;
  targetMinutes: number;
  timezone: string;
  windows: OperatorScheduleWindow[] | null;
}): number {
  return (
    input.targetMinutes -
    businessMinutesBetween(input.start, input.now, input.timezone, input.windows)
  );
}
