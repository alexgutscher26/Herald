import "server-only";

import { reportError } from "@/lib/error-report";
import { logEvent } from "@/lib/logger";

import {
  SlowQueryThrottle,
  isSlowQuery,
  needsAlert,
  normalizeStatement,
  slowQuerySettings,
} from "./slow-query";

/**
 * Record one complete SQL statement.
 *
 * Every slow statement is written to the structured log as `db.slow_query`
 * with its duration and normalised text (never parameter values). Statements at
 * or above the alert threshold are also sent through the existing error webhook,
 * which is the same channel as unhandled errors — one alert path, not a second
 * paging system. Reporting is fire-and-forget so a slow webhook can never delay
 * a query that already finished.
 */

const throttle = new SlowQueryThrottle();

export function recordQueryDuration(statement: string | null, durationMs: number): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) return;

  const settings = slowQuerySettings();
  if (!isSlowQuery(durationMs, settings)) return;

  const normalized = normalizeStatement(statement);
  const alert = needsAlert(durationMs, settings);
  const now = Date.now();

  // An alert-worthy query is always reported; a merely slow one is throttled.
  if (alert || throttle.shouldLog(normalized, now)) {
    logEvent("warn", "db.slow_query", {
      durationMs: Math.round(durationMs),
      statement: normalized,
      thresholdMs: settings.slowMs,
      alertThresholdMs: settings.alertMs,
    });
  }

  if (alert) {
    void reportError(
      new Error("Slow database query"),
      { durationMs: Math.round(durationMs), statement: normalized },
      "db.slow_query",
    );
  }
}

/** Test helper. */
export function resetSlowQueryLog(): void {
  throttle.clear();
}
