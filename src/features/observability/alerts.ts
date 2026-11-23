import "server-only";

import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";

import { db } from "@/db";
import { jobs, jobRuns } from "@/db/schema/jobs";
import { notificationDeliveries } from "@/db/schema/notifications";
import {
  aiUsageEvents,
  alertStates,
  backupVerifications,
  requestMetrics,
} from "@/db/schema/observability";
import { webhookDeliveries } from "@/db/schema/webhooks";
import { getAlertWebhookUrl } from "@/lib/env";
import { logEvent, serializeError } from "@/lib/logger";
import { getAlertThresholds } from "@/lib/observability/config";
import { getReleaseInfo } from "@/lib/observability/release";

import {
  ALERT_RULES,
  rateReading,
  thresholdReading,
  transitionFor,
  type AlertReading,
  type AlertRuleId,
} from "./rules";

/**
 * Alert evaluation.
 *
 * One scheduled job reads aggregate signals and compares them with the
 * configured thresholds. State transitions are persisted, so a firing alert
 * notifies once rather than every five minutes, and a recovery is announced
 * once. Every signal is a count or a rate; no tenant name, email, payload or
 * provider error string is included in a notification.
 *
 * The 5xx signal depends on `request_metrics`, which is written by instrumented
 * API routes. A route that is not instrumented cannot fire this alert; the
 * coverage is listed in docs/observability.md rather than overstated.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOTIFY_TIMEOUT_MS = 3_000;

async function http5xxReading(now: Date): Promise<AlertReading> {
  const thresholds = getAlertThresholds();
  const since = new Date(now.getTime() - 15 * MINUTE);
  const rows = await db
    .select({
      statusClass: requestMetrics.statusClass,
      requests: sql<number>`coalesce(sum(${requestMetrics.count}), 0)::int`,
    })
    .from(requestMetrics)
    .where(gte(requestMetrics.bucketStart, since))
    .groupBy(requestMetrics.statusClass);

  const total = rows.reduce((sum, row) => sum + row.requests, 0);
  const errors = rows.find((row) => row.statusClass === "5xx")?.requests ?? 0;

  return rateReading({
    rule: "http_5xx_rate",
    title: "HTTP 5xx rate",
    numerator: errors,
    denominator: total,
    thresholdPct: thresholds.errorRatePct,
    minSampleSize: thresholds.minRequests,
    detail: (value) =>
      `${errors} of ${total} instrumented requests answered 5xx in the last 15 minutes (${value}%).`,
  });
}

async function jobFailureReading(now: Date): Promise<AlertReading> {
  const thresholds = getAlertThresholds();
  const since = new Date(now.getTime() - 30 * MINUTE);
  const rows = await db
    .select({
      claimed: sql<number>`coalesce(sum(${jobRuns.claimed}), 0)::int`,
      failed: sql<number>`coalesce(sum(${jobRuns.failed}), 0)::int`,
    })
    .from(jobRuns)
    .where(gte(jobRuns.startedAt, since));

  const claimed = rows[0]?.claimed ?? 0;
  const failed = rows[0]?.failed ?? 0;

  return rateReading({
    rule: "job_failure_rate",
    title: "Background job failure rate",
    numerator: failed,
    denominator: claimed,
    thresholdPct: thresholds.jobFailureRatePct,
    minSampleSize: thresholds.minJobClaims,
    detail: (value) =>
      `${failed} of ${claimed} claimed jobs failed in the last 30 minutes (${value}%).`,
  });
}

async function queueDepthReading(now: Date): Promise<AlertReading> {
  const thresholds = getAlertThresholds();
  const cutoff = new Date(now.getTime() - thresholds.queueAgeMinutes * MINUTE);
  const rows = await db
    .select({ depth: sql<number>`count(*)::int` })
    .from(jobs)
    .where(and(eq(jobs.status, "pending"), lt(jobs.runAt, cutoff)));
  const depth = rows[0]?.depth ?? 0;

  return thresholdReading({
    rule: "queue_depth",
    title: "Overdue job queue depth",
    value: depth,
    threshold: thresholds.queueDepth,
    unit: "count",
    detail: (value) =>
      `${value} job${value === 1 ? "" : "s"} have been due for more than ${thresholds.queueAgeMinutes} minutes.`,
  });
}

async function emailBounceReading(now: Date): Promise<AlertReading> {
  const thresholds = getAlertThresholds();
  const since = new Date(now.getTime() - DAY);
  const rows = await db
    .select({
      status: notificationDeliveries.status,
      count: sql<number>`count(*)::int`,
    })
    .from(notificationDeliveries)
    .where(
      and(
        gte(notificationDeliveries.createdAt, since),
        inArray(notificationDeliveries.status, ["sent", "bounced", "complained"]),
      ),
    )
    .groupBy(notificationDeliveries.status);

  const byStatus = new Map(rows.map((row) => [row.status, row.count]));
  const sent = byStatus.get("sent") ?? 0;
  const bad = (byStatus.get("bounced") ?? 0) + (byStatus.get("complained") ?? 0);

  return rateReading({
    rule: "email_bounce_rate",
    title: "Email bounce/complaint rate",
    numerator: bad,
    denominator: sent + bad,
    thresholdPct: thresholds.emailBounceRatePct,
    minSampleSize: thresholds.minDeliveries,
    detail: (value) =>
      `${bad} of ${sent + bad} delivered or rejected messages bounced or complained in the last 24 hours (${value}%).`,
  });
}

async function webhookFailureReading(now: Date): Promise<AlertReading> {
  const thresholds = getAlertThresholds();
  const since = new Date(now.getTime() - HOUR);
  const rows = await db
    .select({
      status: webhookDeliveries.status,
      count: sql<number>`count(*)::int`,
    })
    .from(webhookDeliveries)
    .where(
      and(
        gte(webhookDeliveries.createdAt, since),
        inArray(webhookDeliveries.status, ["succeeded", "failed"]),
      ),
    )
    .groupBy(webhookDeliveries.status);

  const byStatus = new Map(rows.map((row) => [row.status, row.count]));
  const succeeded = byStatus.get("succeeded") ?? 0;
  const failed = byStatus.get("failed") ?? 0;

  return rateReading({
    rule: "webhook_failure_rate",
    title: "Outbound webhook failure rate",
    numerator: failed,
    denominator: succeeded + failed,
    thresholdPct: thresholds.webhookFailureRatePct,
    minSampleSize: thresholds.minWebhookAttempts,
    detail: (value) =>
      `${failed} of ${succeeded + failed} webhook deliveries failed in the last hour (${value}%).`,
  });
}

async function aiSpendReading(now: Date): Promise<AlertReading> {
  const thresholds = getAlertThresholds();
  const since = new Date(now.getTime() - DAY);
  const rows = await db
    .select({
      cost: sql<number>`coalesce(sum(${aiUsageEvents.estimatedCostMicros}), 0)::float8 / 1000000`,
    })
    .from(aiUsageEvents)
    .where(gte(aiUsageEvents.createdAt, since));
  const spend = Math.round((rows[0]?.cost ?? 0) * 100) / 100;

  return thresholdReading({
    rule: "ai_daily_spend",
    title: "AI spend, trailing 24 hours",
    value: spend,
    threshold: thresholds.aiDailyUsd,
    unit: "usd",
    detail: (value) => `Estimated AI spend is $${value.toFixed(2)} in the last 24 hours.`,
  });
}

async function backupFreshnessReading(now: Date): Promise<AlertReading> {
  const thresholds = getAlertThresholds();
  const rows = await db
    .select({
      kind: backupVerifications.kind,
      status: backupVerifications.status,
      checkedAt: backupVerifications.checkedAt,
    })
    .from(backupVerifications)
    .where(inArray(backupVerifications.kind, ["database", "storage", "manifest"]))
    .orderBy(desc(backupVerifications.checkedAt))
    .limit(12);

  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!latest.has(row.kind)) latest.set(row.kind, row);
  }

  const required = ["database", "storage", "manifest"] as const;
  const missing = required.filter((kind) => !latest.has(kind));
  if (missing.length > 0) {
    return {
      rule: "backup_freshness",
      title: "Backup verification freshness",
      state: "ok",
      value: 0,
      threshold: thresholds.backupMaxAgeHours,
      unit: "hours",
      sampleSize: 0,
      minSampleSize: 1,
      detail: "No automated backup verification has run yet.",
    };
  }

  const failed = required.find((kind) => latest.get(kind)?.status === "failed");
  if (failed) {
    return {
      rule: "backup_freshness",
      title: "Backup verification freshness",
      state: "firing",
      value: thresholds.backupMaxAgeHours + 1,
      threshold: thresholds.backupMaxAgeHours,
      unit: "hours",
      sampleSize: 1,
      minSampleSize: 1,
      detail: `The latest ${failed} verification failed.`,
    };
  }

  const oldest = required
    .map((kind) => latest.get(kind)!)
    .reduce((worst, row) => (row.checkedAt < worst.checkedAt ? row : worst));
  const ageHours = Math.max(
    0,
    Math.round(((now.getTime() - oldest.checkedAt.getTime()) / HOUR) * 10) / 10,
  );

  return thresholdReading({
    rule: "backup_freshness",
    title: "Backup verification freshness",
    value: ageHours,
    threshold: thresholds.backupMaxAgeHours,
    unit: "hours",
    detail: (value) => `The last successful verification was ${value} hours ago.`,
  });
}

const READERS: Record<AlertRuleId, (now: Date) => Promise<AlertReading>> = {
  http_5xx_rate: http5xxReading,
  job_failure_rate: jobFailureReading,
  queue_depth: queueDepthReading,
  email_bounce_rate: emailBounceReading,
  webhook_failure_rate: webhookFailureReading,
  ai_daily_spend: aiSpendReading,
  backup_freshness: backupFreshnessReading,
};

export async function collectAlertReadings(now = new Date()): Promise<AlertReading[]> {
  const readings: AlertReading[] = [];
  for (const rule of ALERT_RULES) {
    try {
      readings.push(await READERS[rule](now));
    } catch (error) {
      logEvent("warn", "alert.evaluation_failed", {
        rule,
        error: serializeError(error),
      });
    }
  }
  return readings;
}

async function notifyAlert(reading: AlertReading, now: Date): Promise<void> {
  const release = getReleaseInfo();
  const payload = {
    source: "herald",
    kind: "alert",
    rule: reading.rule,
    title: reading.title,
    state: reading.state,
    value: reading.value,
    threshold: reading.threshold,
    unit: reading.unit,
    detail: reading.detail,
    release: release.release,
    environment: release.environment,
    timestamp: now.toISOString(),
  };

  let url: string | null;
  try {
    url = getAlertWebhookUrl();
  } catch (error) {
    logEvent("warn", "alert.misconfigured", { error: serializeError(error) });
    return;
  }

  if (!url) {
    logEvent("warn", "alert.no_channel", {
      rule: reading.rule,
      state: reading.state,
    });
    return;
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
    });
    if (!response.ok) {
      logEvent("warn", "alert.notify_rejected", {
        rule: reading.rule,
        status: response.status,
      });
    }
  } catch (error) {
    logEvent("warn", "alert.notify_failed", {
      rule: reading.rule,
      error: serializeError(error),
    });
  }
}

/**
 * Persist a transition and notify exactly once.
 *
 * The row lock makes two overlapping cron invocations cooperate: the second
 * sees the new state and does not send a duplicate notification.
 */
async function applyReading(reading: AlertReading, now: Date): Promise<void> {
  let transition = transitionFor("ok", "ok");

  await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(alertStates)
      .where(eq(alertStates.rule, reading.rule))
      .for("update");
    const previous = rows[0];

    if (!previous) {
      const initial = reading.state;
      await tx.insert(alertStates).values({
        rule: reading.rule,
        state: initial,
        value: reading.value,
        threshold: reading.threshold,
        detail: reading.detail,
        firedAt: initial === "firing" ? now : null,
        resolvedAt: initial === "ok" ? now : null,
        notifiedAt: null,
        updatedAt: now,
      });
      transition = transitionFor("ok", initial);
      return;
    }

    const next = transitionFor(previous.state === "firing" ? "firing" : "ok", reading.state);
    transition = next;

    await tx
      .update(alertStates)
      .set({
        state: reading.state,
        value: reading.value,
        threshold: reading.threshold,
        detail: reading.detail,
        firedAt:
          next.changed && reading.state === "firing" ? now : previous.firedAt,
        resolvedAt:
          next.changed && reading.state === "ok" ? now : previous.resolvedAt,
        notifiedAt: next.changed ? now : previous.notifiedAt,
        updatedAt: now,
      })
      .where(eq(alertStates.rule, reading.rule));
  });

  if (!transition.changed) return;

  await notifyAlert(reading, now);
  logEvent(reading.state === "firing" ? "warn" : "info", "alert.transition", {
    rule: reading.rule,
    state: reading.state,
    value: reading.value,
    threshold: reading.threshold,
    detail: reading.detail,
  });
}

export async function evaluateAlerts(now = new Date()): Promise<AlertReading[]> {
  const readings = await collectAlertReadings(now);
  for (const reading of readings) {
    try {
      await applyReading(reading, now);
    } catch (error) {
      logEvent("warn", "alert.state_write_failed", {
        rule: reading.rule,
        error: serializeError(error),
      });
    }
  }
  return readings;
}
