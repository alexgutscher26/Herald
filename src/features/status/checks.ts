import "server-only";

import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";

import { db, getPool } from "@/db";
import { jobs } from "@/db/schema/jobs";
import { notificationDeliveries } from "@/db/schema/notifications";
import { backupVerifications } from "@/db/schema/observability";
import { getStorage } from "@/features/storage";
import type { StorageHealth } from "@/features/storage/types";
import { getAlertThresholds } from "@/lib/observability/config";
import { getEmailConfig } from "@/lib/env";

/**
 * Real dependency checks shared by readiness and the public status page.
 *
 * Every check is isolated and returns a coarse state plus one sentence that is
 * safe to publish: no hostname, dsn, provider body, workspace or customer data.
 * Storage and email are optional dependencies, so an email outage degrades the
 * status page without making the instance unready.
 */

export type CheckState = "ok" | "degraded" | "unavailable" | "unconfigured";
export type DependencyCheck = { state: CheckState; detail: string };

const DAY_MS = 24 * 60 * 60 * 1000;
const STORAGE_CACHE_MS = 15_000;

let storageCache: { at: number; value: StorageHealth } | null = null;

export async function checkDatabase(): Promise<DependencyCheck> {
  try {
    const result = await getPool().query("SELECT 1 AS ok");
    return result.rows.length === 1
      ? { state: "ok", detail: "Queries are completing normally." }
      : { state: "unavailable", detail: "The database did not return a result." };
  } catch {
    return { state: "unavailable", detail: "The database is not reachable." };
  }
}

export async function checkStorage(now = new Date()): Promise<DependencyCheck> {
  if (storageCache && now.getTime() - storageCache.at < STORAGE_CACHE_MS) {
    return storageCache.value.ok
      ? { state: "ok", detail: "Storage reads and writes are working." }
      : { state: "unavailable", detail: storageCache.value.detail };
  }

  try {
    const health = await getStorage().health();
    storageCache = { at: now.getTime(), value: health };
    return health.ok
      ? { state: "ok", detail: "Storage reads and writes are working." }
      : { state: "unavailable", detail: health.detail };
  } catch {
    return { state: "unavailable", detail: "Storage is not reachable." };
  }
}

/**
 * Email provider readiness.
 *
 * No network probe is made on every readiness request: calling the provider on
 * a liveness cadence would spend quota and make an email outage look like an
 * application outage. Instead this checks that the configuration is complete
 * and inspects actual delivery outcomes from the last 24 hours.
 */
export async function checkEmail(now = new Date()): Promise<DependencyCheck> {
  let configured = false;
  try {
    configured = getEmailConfig() !== null;
  } catch {
    return { state: "degraded", detail: "Email configuration is invalid." };
  }

  if (!configured) {
    return {
      state: "unconfigured",
      detail: "Email is not configured; outbound delivery is disabled.",
    };
  }

  try {
    const since = new Date(now.getTime() - DAY_MS);
    const rows = await db
      .select({ status: notificationDeliveries.status, count: sql<number>`count(*)::int` })
      .from(notificationDeliveries)
      .where(
        and(
          gte(notificationDeliveries.createdAt, since),
          inArray(notificationDeliveries.status, [
            "sent",
            "failed",
            "bounced",
            "complained",
          ]),
        ),
      )
      .groupBy(notificationDeliveries.status);

    const byStatus = new Map(rows.map((row) => [row.status, row.count]));
    const sent = byStatus.get("sent") ?? 0;
    const failed = byStatus.get("failed") ?? 0;
    const bounced = byStatus.get("bounced") ?? 0;
    const complained = byStatus.get("complained") ?? 0;
    const handled = sent + failed + bounced + complained;

    if (handled === 0) {
      return {
        state: "ok",
        detail: "Configured; no outbound deliveries in the last 24 hours.",
      };
    }

    const bad = bounced + complained;
    const bounceRate = bad / Math.max(1, sent + bad);
    const threshold = getAlertThresholds().emailBounceRatePct / 100;

    if (failed === handled) {
      return {
        state: "unavailable",
        detail: "Every delivery attempt in the last 24 hours failed.",
      };
    }
    if (bounceRate > threshold && sent + bad >= 20) {
      return {
        state: "degraded",
        detail: `Bounce/complaint rate is ${Math.round(bounceRate * 1000) / 10}% over the last 24 hours.`,
      };
    }
    if (failed > 0) {
      return {
        state: "degraded",
        detail: `${failed} of ${handled} delivery attempts failed in the last 24 hours.`,
      };
    }
    return {
      state: "ok",
      detail: `${sent} deliveries in the last 24 hours; no failures.`,
    };
  } catch {
    return { state: "degraded", detail: "Email delivery health could not be read." };
  }
}

/**
 * Backup freshness.
 *
 * "No verification row" is reported as degraded rather than healthy: a new
 * deployment has no evidence yet, and a status page must not claim a backup
 * exists merely because the job is configured.
 */
export async function checkBackups(now = new Date()): Promise<DependencyCheck> {
  const maxAgeHours = getAlertThresholds().backupMaxAgeHours;
  try {
    const rows = await db
      .select({
        kind: backupVerifications.kind,
        status: backupVerifications.status,
        checkedAt: backupVerifications.checkedAt,
        detail: backupVerifications.detail,
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
    if (required.some((kind) => !latest.has(kind))) {
      return {
        state: "degraded",
        detail: "Automated backup verification has not completed yet.",
      };
    }

    const failed = required.find((kind) => latest.get(kind)?.status === "failed");
    if (failed) {
      return {
        state: "degraded",
        detail: `The latest ${failed} verification failed.`,
      };
    }

    const oldest = required
      .map((kind) => latest.get(kind)!)
      .reduce((worst, row) => (row.checkedAt < worst.checkedAt ? row : worst));
    const ageHours = Math.max(
      0,
      Math.round((now.getTime() - oldest.checkedAt.getTime()) / (60 * 60 * 1000)),
    );

    if (ageHours > maxAgeHours) {
      return {
        state: "degraded",
        detail: `The last successful verification was ${ageHours} hours ago.`,
      };
    }

    return {
      state: "ok",
      detail: `Verified ${ageHours === 0 ? "within the hour" : `${ageHours} hours ago`}.`,
    };
  } catch {
    return { state: "degraded", detail: "Backup verification state could not be read." };
  }
}

export async function checkQueue(now = new Date()): Promise<DependencyCheck & { depth: number }> {
  try {
    const threshold = getAlertThresholds();
    const cutoff = new Date(now.getTime() - threshold.queueAgeMinutes * 60_000);
    const rows = await db
      .select({ depth: sql<number>`count(*)::int` })
      .from(jobs)
      .where(and(eq(jobs.status, "pending"), lt(jobs.runAt, cutoff)));
    const depth = rows[0]?.depth ?? 0;
    return depth > threshold.queueDepth
      ? {
          state: "degraded",
          detail: `${depth} jobs have been due for more than ${threshold.queueAgeMinutes} minutes.`,
          depth,
        }
      : {
          state: "ok",
          detail:
            depth === 0
              ? "No overdue jobs."
              : `${depth} jobs overdue; below the alert threshold.`,
          depth,
        };
  } catch {
    return { state: "degraded", detail: "Queue depth could not be read.", depth: 0 };
  }
}

export type ReadinessReport = {
  ready: boolean;
  database: CheckState;
  storage: CheckState;
  email: CheckState;
  backups: CheckState;
  queue: CheckState;
};

export async function getReadinessReport(now = new Date()): Promise<ReadinessReport> {
  const [database, storage, email, backups, queue] = await Promise.all([
    checkDatabase(),
    checkStorage(now),
    checkEmail(now),
    checkBackups(now),
    checkQueue(now),
  ]);

  return {
    // Storage is required for attachments, covers and exports. Email and
    // backups degrade the service but must not pull every instance from the
    // load balancer.
    ready: database.state === "ok" && storage.state === "ok",
    database: database.state,
    storage: storage.state,
    email: email.state,
    backups: backups.state,
    queue: queue.state,
  };
}
