import type { ReportSchedule } from "./catalogue";

/**
 * UTC period math for reports. Pure and unit-tested so the dashboard, export
 * and alert paths all agree on what "last 30 days" means.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_REPORT_DAYS = 365;

export function clampReportDays(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 30);
  if (!Number.isFinite(parsed)) return 30;
  return Math.min(MAX_REPORT_DAYS, Math.max(1, Math.trunc(parsed)));
}

export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export type ReportPeriod = {
  /** First day, inclusive, `YYYY-MM-DD`. */
  from: string;
  /** Last day, inclusive, `YYYY-MM-DD`. */
  to: string;
  /** Exclusive timestamp bound used by SQL. */
  endExclusive: Date;
};

export type ReportPeriods = {
  current: ReportPeriod;
  previous: ReportPeriod | null;
};

/**
 * The current window ends today (UTC) and contains `days` days. The comparison
 * window is the immediately preceding window of the same length, so a 7-day
 * report compares against the 7 days before it rather than a calendar week.
 */
export function reportPeriods(days: number, now = new Date(), compare = true): ReportPeriods {
  const length = clampReportDays(days);
  const endDay = startOfUtcDay(now);
  const start = addDays(endDay, -(length - 1));
  const endExclusive = addDays(endDay, 1);

  const current: ReportPeriod = {
    from: dayKey(start),
    to: dayKey(endDay),
    endExclusive,
  };

  if (!compare) return { current, previous: null };

  const previousEnd = addDays(start, -1);
  const previousStart = addDays(previousEnd, -(length - 1));
  return {
    current,
    previous: {
      from: dayKey(previousStart),
      to: dayKey(previousEnd),
      endExclusive: start,
    },
  };
}

/** Every UTC day in an inclusive period, used to zero-fill the series. */
export function daysBetween(from: string, to: string): string[] {
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return [];
  const days: string[] = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    if (days.length >= MAX_REPORT_DAYS) break;
    days.push(dayKey(cursor));
  }
  return days;
}

/** Percentage change, or null when there is no baseline to compare with. */
export function comparisonPercent(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

const SCHEDULE_HOURS: Record<Exclude<ReportSchedule, "none">, number> = {
  daily: 20,
  weekly: 6 * 24 + 20,
  monthly: 28 * 24,
};

/**
 * Whether a scheduled report is due. A report that has never run is due
 * immediately. The window is slightly shorter than the nominal period so a
 * cron that drifts by an hour does not skip a day.
 */
export function isReportDue(
  schedule: ReportSchedule,
  lastRunAt: Date | null,
  now = new Date(),
): boolean {
  if (schedule === "none") return false;
  if (!lastRunAt) return true;
  const elapsedHours = (now.getTime() - lastRunAt.getTime()) / (60 * 60 * 1000);
  return elapsedHours >= SCHEDULE_HOURS[schedule];
}

/** An alert-only report is evaluated at most once a day. */
export function isAlertCheckDue(lastRunAt: Date | null, now = new Date()): boolean {
  if (!lastRunAt) return true;
  const elapsedHours = (now.getTime() - lastRunAt.getTime()) / (60 * 60 * 1000);
  return elapsedHours >= 20;
}
