import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db";
import { getStorage } from "@/features/storage";
import { logEvent, serializeError } from "@/lib/logger";
import { getRetentionSettings } from "@/lib/observability/config";

/**
 * Enforce the observability retention policy.
 *
 * Request metrics are high-volume and short-lived (a week); dashboard view
 * events are low-volume and kept for a season; AI usage and backup evidence
 * follow the broader operational retention. Deleting by age, not by count,
 * keeps the policy explainable in a privacy review.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

async function deletedCount(statement: ReturnType<typeof sql>): Promise<number> {
  const result = await db.execute(statement);
  return Number((result as { rowCount?: number }).rowCount ?? 0);
}

export type PruneResult = {
  requestMetrics: number;
  dashboardViews: number;
  aiUsage: number;
  backupVerifications: number;
  backupManifests: number;
};

export async function pruneObservability(now = new Date()): Promise<PruneResult> {
  const settings = getRetentionSettings();
  const cutoff = (days: number) => new Date(now.getTime() - days * DAY_MS);

  const [requestMetrics, dashboardViews, aiUsage, backupVerifications] =
    await Promise.all([
      deletedCount(
        sql`delete from request_metrics where bucket_start < ${cutoff(settings.requestMetricsDays)}`,
      ),
      deletedCount(
        sql`delete from dashboard_view_events where created_at < ${cutoff(settings.dashboardViewsDays)}`,
      ),
      deletedCount(
        sql`delete from ai_usage_events where created_at < ${cutoff(settings.aiUsageDays)}`,
      ),
      deletedCount(
        sql`delete from backup_verifications where checked_at < ${cutoff(settings.backupVerificationsDays)}`,
      ),
    ]);

  let backupManifests = 0;
  try {
    const storage = getStorage();
    const manifests = await storage.list("backups/manifests/");
    const manifestCutoff = now.getTime() - settings.backupManifestsDays * DAY_MS;
    for (const manifest of manifests) {
      const createdAt = Date.parse(manifest.createdAt);
      if (Number.isFinite(createdAt) && createdAt < manifestCutoff) {
        await storage.delete(manifest.key);
        backupManifests += 1;
      }
    }
  } catch (error) {
    logEvent("warn", "observability.manifest_prune_failed", {
      error: serializeError(error),
    });
  }

  const result: PruneResult = {
    requestMetrics,
    dashboardViews,
    aiUsage,
    backupVerifications,
    backupManifests,
  };

  logEvent("info", "observability.pruned", result);
  return result;
}
