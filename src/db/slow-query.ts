/**
 * Slow-query classification.
 *
 * Pure so the thresholds, statement sanitising and log throttling can be tested
 * without a database. `slow-query-log.ts` does the actual logging and alerting.
 *
 * Two thresholds:
 *  - `SLOW_QUERY_MS` (default 200) logs a `db.slow_query` warning.
 *  - `SLOW_QUERY_ALERT_MS` (default 1000) additionally reports through the
 *    error webhook, so a genuinely stuck query reaches the alert channel.
 *
 * The statement is the SQL text `pg` received, which uses `$1` placeholders for
 * every parameterised value; it never contains row data from this application.
 */

export const DEFAULT_SLOW_QUERY_MS = 200;
export const DEFAULT_SLOW_QUERY_ALERT_MS = 1_000;
export const SLOW_QUERY_LOG_INTERVAL_MS = 10_000;
const MAX_STATEMENT_LENGTH = 300;

export type SlowQuerySettings = {
  slowMs: number;
  alertMs: number;
};

function readThreshold(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), 1), 600_000);
}

export function slowQuerySettings(
  env: Record<string, string | undefined> = process.env,
): SlowQuerySettings {
  const slowMs = readThreshold(env.SLOW_QUERY_MS, DEFAULT_SLOW_QUERY_MS);
  // An alert threshold below the log threshold would make the pair confusing;
  // the alert threshold is the higher of the two.
  const alertMs = Math.max(
    readThreshold(env.SLOW_QUERY_ALERT_MS, DEFAULT_SLOW_QUERY_ALERT_MS),
    slowMs,
  );
  return { slowMs, alertMs };
}

/** Collapse whitespace and truncate, so one statement cannot flood a drain. */
export function normalizeStatement(statement: string | null | undefined): string {
  if (!statement) return "[unknown statement]";
  const collapsed = statement.replace(/\s+/g, " ").trim();
  return collapsed.length > MAX_STATEMENT_LENGTH
    ? `${collapsed.slice(0, MAX_STATEMENT_LENGTH)}…`
    : collapsed;
}

/**
 * Per-statement log throttle.
 *
 * A single slow query under load must not produce one log line per request.
 * The first sighting logs, then the same normalised statement is quiet for
 * `SLOW_QUERY_LOG_INTERVAL_MS`. Alert-worthy queries bypass this in the logger.
 */
export class SlowQueryThrottle {
  private readonly lastLogged = new Map<string, number>();

  shouldLog(key: string, now: number, intervalMs = SLOW_QUERY_LOG_INTERVAL_MS): boolean {
    const last = this.lastLogged.get(key);
    if (last !== undefined && now - last < intervalMs) return false;
    this.lastLogged.set(key, now);
    return true;
  }

  clear(): void {
    this.lastLogged.clear();
  }

  get size(): number {
    return this.lastLogged.size;
  }
}

export function isSlowQuery(durationMs: number, settings = slowQuerySettings()): boolean {
  return durationMs >= settings.slowMs;
}

export function needsAlert(durationMs: number, settings = slowQuerySettings()): boolean {
  return durationMs >= settings.alertMs;
}
