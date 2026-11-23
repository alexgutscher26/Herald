import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db";
import { requestMetrics } from "@/db/schema/observability";
import { logEvent, serializeError } from "@/lib/logger";

/**
 * Aggregate one completed request into a UTC minute bucket.
 *
 * One upsert per request keeps the table small: a minute of traffic at one
 * route is one row per status class, not one row per visit. A failure to write
 * a metric is logged and ignored — telemetry must never fail a request.
 */

export type RequestMetricInput = {
  route: string;
  method: string;
  status: number;
  durationMs: number;
  now?: Date;
};

export function statusClassFor(status: number): "2xx" | "3xx" | "4xx" | "5xx" {
  if (status >= 500) return "5xx";
  if (status >= 400) return "4xx";
  if (status >= 300) return "3xx";
  // A 1xx is informational, not a server failure; it belongs with success
  // rather than inflating the alerting signal.
  return "2xx";
}

export async function recordRequestMetric(input: RequestMetricInput): Promise<void> {
  const now = input.now ?? new Date();
  const bucketStart = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  const durationMs = Math.max(0, Math.min(Math.round(input.durationMs), 3_600_000));
  const route = input.route.slice(0, 160);
  const method = input.method.toUpperCase().slice(0, 12);
  const statusClass = statusClassFor(input.status);

  try {
    await db
      .insert(requestMetrics)
      .values({
        bucketStart,
        route,
        method,
        statusClass,
        count: 1,
        totalMs: durationMs,
        maxMs: durationMs,
      })
      .onConflictDoUpdate({
        target: [
          requestMetrics.bucketStart,
          requestMetrics.route,
          requestMetrics.method,
          requestMetrics.statusClass,
        ],
        set: {
          count: sql`${requestMetrics.count} + 1`,
          totalMs: sql`${requestMetrics.totalMs} + ${durationMs}`,
          maxMs: sql`greatest(${requestMetrics.maxMs}, ${durationMs})`,
        },
      });
  } catch (error) {
    logEvent("warn", "observability.metric_write_failed", {
      route,
      method,
      error: serializeError(error),
    });
  }
}
