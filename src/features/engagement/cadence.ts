/**
 * Pure cadence helpers for recurring outbound messages. Kept free of database
 * imports so the window rules can be unit tested and reused by the scheduler.
 */

export type OutboundRecurrence = "one_shot" | "daily" | "weekly";

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function normalizeTimeZone(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  return trimmed && isValidTimeZone(trimmed) ? trimmed : "UTC";
}

export function sendWindowProblem(start: string, end: string): string | null {
  const pattern = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!pattern.test(start) || !pattern.test(end)) {
    return "Use a 24-hour time for both window ends, such as 09:00.";
  }
  return null;
}

function minutesInTimeZone(now: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
    const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
    return hour * 60 + minute;
  } catch {
    return now.getUTCHours() * 60 + now.getUTCMinutes();
  }
}

function parseWindow(value: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
}

/** A local delivery window; start == end means the whole day. */
export function isInSendWindow(
  now: Date,
  start: string,
  end: string,
  timeZone = "UTC",
): boolean {
  const minutes = minutesInTimeZone(now, timeZone);
  const left = parseWindow(start);
  const right = parseWindow(end);
  if (left === right) return true;
  return left < right
    ? minutes >= left && minutes < right
    : minutes >= left || minutes < right;
}

export function recurrenceKey(recurrence: OutboundRecurrence, now: Date): string {
  if (recurrence === "one_shot") return "one-shot";
  const date = now.toISOString().slice(0, 10);
  if (recurrence === "daily") return date;
  const dayMs = 24 * 60 * 60 * 1000;
  const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((now.getTime() - start.getTime()) / dayMs + start.getUTCDay() + 1) / 7,
  );
  return `${now.getUTCFullYear()}-w${week}`;
}
