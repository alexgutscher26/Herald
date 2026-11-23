/**
 * Subscriber quiet hours.
 *
 * A quiet window is stored as two local minutes-past-midnight plus an IANA
 * timezone. The minute representation keeps the comparison independent of DST
 * and of how a date happens to be formatted. Windows that wrap midnight are
 * supported. There is no database or request dependency here so the preferences
 * form, the sender and the unit tests share the same rules.
 */

export const QUIET_HOURS_DEFER_MINUTES = 15;
export const MAX_QUIET_HOURS_TIMEZONE = 64;

export type QuietHoursWindow = {
  /** Minutes past local midnight, 0–1439. */
  startMinute: number;
  endMinute: number;
  timezone: string;
};

export type QuietHoursFields = {
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
  quietHoursTimezone: string | null;
};

export type QuietHoursParseResult =
  | { ok: true; window: QuietHoursWindow }
  | { ok: false; error: string };

/** Templates that are held until a subscriber's local quiet window closes. */
const QUIET_HOURS_TEMPLATES = new Set<string>([
  "release_published",
  "winback_campaign",
  "feedback_status_changed",
  "feedback_reply",
  "weekly_digest",
  "daily_digest",
  "outbound_message",
]);

export function isQuietHoursTemplate(template: string): boolean {
  return QUIET_HOURS_TEMPLATES.has(template);
}

export function parseTimeOfDay(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

export function formatTimeOfDay(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function isValidTimeZone(timezone: string): boolean {
  const value = timezone.trim();
  if (value.length === 0 || value.length > MAX_QUIET_HOURS_TIMEZONE) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse the form/API shape. `null` start and end clear the window. A timezone
 * is required whenever a window is set, and an empty window (start === end) is
 * rejected rather than silently interpreted as "all day".
 */
export function parseQuietHours(input: {
  start: string | null | undefined;
  end: string | null | undefined;
  timezone: string | null | undefined;
}): QuietHoursParseResult {
  const rawStart = input.start?.trim() ?? "";
  const rawEnd = input.end?.trim() ?? "";
  const rawTimezone = input.timezone?.trim() ?? "";

  if (rawStart === "" && rawEnd === "" && rawTimezone === "") {
    return { ok: false, error: "Choose a start and end time for quiet hours." };
  }

  const startMinute = parseTimeOfDay(rawStart);
  const endMinute = parseTimeOfDay(rawEnd);
  if (startMinute === null || endMinute === null) {
    return { ok: false, error: "Quiet hours need a valid start and end time." };
  }
  if (startMinute === endMinute) {
    return { ok: false, error: "Quiet hours need a start and end that differ." };
  }
  if (!isValidTimeZone(rawTimezone)) {
    return { ok: false, error: "Choose a valid IANA timezone, for example Europe/Madrid." };
  }

  return {
    ok: true,
    window: { startMinute, endMinute, timezone: rawTimezone },
  };
}

export function clearQuietHours(): {
  quietHoursStart: null;
  quietHoursEnd: null;
  quietHoursTimezone: null;
} {
  return {
    quietHoursStart: null,
    quietHoursEnd: null,
    quietHoursTimezone: null,
  };
}

export function quietHoursWindowFromFields(
  fields: QuietHoursFields,
): QuietHoursWindow | null {
  if (
    fields.quietHoursStart === null ||
    fields.quietHoursEnd === null ||
    !fields.quietHoursTimezone
  ) {
    return null;
  }
  if (
    !Number.isInteger(fields.quietHoursStart) ||
    !Number.isInteger(fields.quietHoursEnd) ||
    fields.quietHoursStart < 0 ||
    fields.quietHoursStart >= 1440 ||
    fields.quietHoursEnd < 0 ||
    fields.quietHoursEnd >= 1440 ||
    fields.quietHoursStart === fields.quietHoursEnd ||
    !isValidTimeZone(fields.quietHoursTimezone)
  ) {
    return null;
  }
  return {
    startMinute: fields.quietHoursStart,
    endMinute: fields.quietHoursEnd,
    timezone: fields.quietHoursTimezone,
  };
}

/** The subscriber's local wall-clock minute, or null for an invalid zone. */
export function localMinuteOfDay(timezone: string, now: Date): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const parsedHour = Number(parts.find((part) => part.type === "hour")?.value);
    const minute = Number(parts.find((part) => part.type === "minute")?.value);
    if (!Number.isInteger(parsedHour) || !Number.isInteger(minute)) return null;
    // Some ICU versions spell midnight as 24 even with h23.
    const hour = parsedHour === 24 ? 0 : parsedHour;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return hour * 60 + minute;
  } catch {
    return null;
  }
}

export function isWithinQuietHours(window: QuietHoursWindow, now: Date): boolean {
  const minute = localMinuteOfDay(window.timezone, now);
  if (minute === null) return false;
  if (window.startMinute < window.endMinute) {
    return minute >= window.startMinute && minute < window.endMinute;
  }
  // Wraps midnight, for example 22:00–07:00.
  return minute >= window.startMinute || minute < window.endMinute;
}

/**
 * Return the next short re-check time. We deliberately do not try to compute
 * the exact window close: a fixed short deferral survives DST transitions and
 * malformed timezone data, and the sweep simply re-evaluates on the next pass.
 */
export function quietHoursDeferral(now: Date): Date {
  return new Date(now.getTime() + QUIET_HOURS_DEFER_MINUTES * 60_000);
}
