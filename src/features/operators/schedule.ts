import type { OperatorScheduleWindow } from "@/db/schema/support";

/**
 * Operator availability.
 *
 * A schedule is a list of weekly windows in the operator's own timezone.
 * `null` means always available; an empty list means never. Windows are
 * half-open (`start <= time < end`) and may span midnight.
 *
 * Pure and unit-tested: the presence query must not depend on the server's
 * timezone or locale.
 */

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function normalizeSchedule(
  value: unknown,
): { ok: true; schedule: OperatorScheduleWindow[] | null } | { ok: false; error: string } {
  if (value === null || value === undefined) return { ok: true, schedule: null };
  if (!Array.isArray(value)) {
    return { ok: false, error: "The schedule must be a list of weekly windows." };
  }
  if (value.length > 14) {
    return { ok: false, error: "Use at most 14 weekly windows." };
  }

  const windows: OperatorScheduleWindow[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      return { ok: false, error: "Each window needs days, a start and an end." };
    }
    const candidate = entry as {
      days?: unknown;
      start?: unknown;
      end?: unknown;
    };
    if (
      !Array.isArray(candidate.days) ||
      candidate.days.length === 0 ||
      !candidate.days.every(
        (day) => typeof day === "number" && Number.isInteger(day) && day >= 0 && day <= 6,
      )
    ) {
      return { ok: false, error: "Choose at least one weekday for each window." };
    }
    if (typeof candidate.start !== "string" || !TIME.test(candidate.start)) {
      return { ok: false, error: "Start times look like 09:30." };
    }
    if (typeof candidate.end !== "string" || !TIME.test(candidate.end)) {
      return { ok: false, error: "End times look like 17:00." };
    }
    if (candidate.start === candidate.end) {
      return { ok: false, error: "A window cannot start and end at the same time." };
    }
    windows.push({
      days: [...new Set(candidate.days as number[])].sort((a, b) => a - b),
      start: candidate.start,
      end: candidate.end,
    });
  }

  return { ok: true, schedule: windows };
}

export function isWithinSchedule(
  now: Date,
  timezone: string,
  schedule: OperatorScheduleWindow[] | null,
): boolean {
  if (schedule === null) return true;
  if (schedule.length === 0) return false;

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);

  const weekdayLabel = parts.find((part) => part.type === "weekday")?.value ?? "";
  const weekday = WEEKDAYS.indexOf(weekdayLabel);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  if (weekday < 0 || Number.isNaN(hour) || Number.isNaN(minute)) return false;

  const current = hour * 60 + minute;
  return schedule.some((window) => {
    if (!window.days.includes(weekday)) return false;
    const start = minutesOf(window.start);
    const end = minutesOf(window.end);
    return start <= end
      ? current >= start && current < end
      : current >= start || current < end;
  });
}

function minutesOf(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
}
