/**
 * Date and time helpers.
 *
 * Every formatter pins the locale and accepts an explicit IANA timezone, so
 * server-rendered markup matches the hydrated client output regardless of the
 * machine's locale. Render paths should call a helper here rather than
 * constructing `new Date()` inline: an implicit "now" during render is the
 * usual source of hydration mismatches.
 *
 * `format.ts` re-exports these functions for existing imports; new code should
 * import from this module.
 */

export const DEFAULT_LOCALE = "en-US";

/** The current instant. Named so a render-time clock is greppable. */
export function now(): Date {
  return new Date();
}

/** The current UTC calendar year, used by static footers. */
export function currentYear(at: Date = now()): number {
  return at.getUTCFullYear();
}

export function formatDate(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(DEFAULT_LOCALE, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone,
  }).format(new Date(iso));
}

export function formatDateTime(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(DEFAULT_LOCALE, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(new Date(iso));
}

export function formatShortDateTime(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(DEFAULT_LOCALE, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(iso));
}

export function formatMonth(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(DEFAULT_LOCALE, {
    month: "long",
    year: "numeric",
    timeZone,
  }).format(new Date(iso));
}

/** Label such as `ET`, `GMT+1`, used next to time inputs. */
export function timeZoneAbbreviation(timeZone: string, at: Date = now()): string {
  const parts = new Intl.DateTimeFormat(DEFAULT_LOCALE, {
    timeZone,
    timeZoneName: "short",
  }).formatToParts(at);
  return parts.find((part) => part.type === "timeZoneName")?.value ?? timeZone;
}

/** Relative label against the supplied instant (defaults to now). */
export function formatRelative(iso: string, at: Date = now()): string {
  const then = new Date(iso).getTime();
  const diffMs = at.getTime() - then;
  const future = diffMs < 0;
  const minutes = Math.round(Math.abs(diffMs) / 60_000);

  if (minutes < 1) return "just now";
  if (minutes < 60) {
    const value = `${minutes}m`;
    return future ? `in ${value}` : `${value} ago`;
  }

  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    const value = `${hours}h`;
    return future ? `in ${value}` : `${value} ago`;
  }

  const days = Math.round(hours / 24);
  if (days === 1) return future ? "tomorrow" : "yesterday";
  if (days < 30) return future ? `in ${days}d` : `${days}d ago`;

  const months = Math.round(days / 30);
  return future ? `in ${months}mo` : `${months}mo ago`;
}

/* -------------------------------------------------------------------------- */
/* Timezone conversion for `datetime-local` inputs                            */
/* -------------------------------------------------------------------------- */

type ZoneParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function partsInZone(date: Date, timeZone: string): ZoneParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

function offsetMs(date: Date, timeZone: string): number {
  const parts = partsInZone(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - date.getTime();
}

/**
 * Convert a wall-clock value (`YYYY-MM-DDTHH:mm`, as produced by
 * `<input type="datetime-local">`) in `timeZone` to a UTC ISO string.
 */
export function zonedInputToIso(value: string, timeZone: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const naiveUtc = Date.parse(`${value}:00Z`);
  if (Number.isNaN(naiveUtc)) return null;

  let candidate = naiveUtc - offsetMs(new Date(naiveUtc), timeZone);
  candidate = naiveUtc - offsetMs(new Date(candidate), timeZone);
  return new Date(candidate).toISOString();
}

/** Format an ISO instant for a `datetime-local` input in `timeZone`. */
export function isoToZonedInput(iso: string | null, timeZone: string): string {
  if (!iso) return "";
  const parts = partsInZone(new Date(iso), timeZone);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

/** `YYYY-MM-DD` for an instant in a given timezone. */
export function isoDateInZone(iso: string, timeZone: string): string {
  const parts = partsInZone(new Date(iso), timeZone);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}
