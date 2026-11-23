import type { PublicLocaleCode } from "./i18n";

/** Compatible export for the dashboard moderation view; public views use `formatPublicDate`. */
export function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

/** A stored target date is shown in the visitor's locale; quarters pass through. */
export function formatPlannedFor(locale: PublicLocaleCode, value: string): string {
  const quarter = /^(\d{4})-Q([1-4])$/.exec(value);
  if (quarter) return `Q${quarter[2]} ${quarter[1]}`;

  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!date) return value;

  const parsed = new Date(
    Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3])),
  );
  if (Number.isNaN(parsed.getTime())) return value;

  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
