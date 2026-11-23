import "server-only";

import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db";
import { backupVerifications } from "@/db/schema/observability";
import { getStorage } from "@/features/storage";
import type { StoredObject } from "@/features/storage/types";
import { logEvent, serializeError } from "@/lib/logger";
import {
  buildBackupManifest,
  manifestChecksum,
  type BackupManifest,
} from "@/lib/observability/backup-manifest";
import { getRetentionSettings } from "@/lib/observability/config";
import { getReleaseInfo } from "@/lib/observability/release";

export type { BackupManifest };

/**
 * Automated backup verification.
 *
 * This is not a note that someone intended to run a drill. The scheduled job:
 *
 *  1. inventories the storage driver and re-reads a deterministic sample of
 *     attachment objects, verifying each checksum;
 *  2. records the database inventory (size, migration count, key row counts)
 *     that a restore would need to reproduce;
 *  3. writes a manifest into object storage, reads it back and compares its
 *     SHA-256, proving the storage backup path is round-trippable;
 *  4. records one row per check; the status page and the alert evaluator read
 *     the age of the newest successful rows.
 *
 * Provider-level point-in-time recovery remains a hosting feature and cannot be
 * exercised from application code. docs/operations.md documents the operator
 * step and the residual gap explicitly.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const ATTACHMENT_SAMPLE = 20;

const COUNTED_TABLES = [
  "workspaces",
  "products",
  "user",
  "customers",
  "feedback_posts",
  "releases",
  "notification_deliveries",
  "webhook_deliveries",
  "jobs",
] as const;

async function tableCounts(): Promise<Record<string, number>> {
  const rows = await db.execute(sql`
    select 'workspaces' as name, count(*)::int as count from workspaces
    union all select 'products', count(*)::int from products
    union all select 'user', count(*)::int from "user"
    union all select 'customers', count(*)::int from customers
    union all select 'feedback_posts', count(*)::int from feedback_posts
    union all select 'releases', count(*)::int from releases
    union all select 'notification_deliveries', count(*)::int from notification_deliveries
    union all select 'webhook_deliveries', count(*)::int from webhook_deliveries
    union all select 'jobs', count(*)::int from jobs
  `);

  const counts: Record<string, number> = {};
  for (const table of COUNTED_TABLES) counts[table] = 0;
  for (const row of (rows as { rows?: Record<string, unknown>[] }).rows ?? []) {
    const name = typeof row.name === "string" ? row.name : null;
    const count = typeof row.count === "number" ? row.count : Number(row.count ?? 0);
    if (name) counts[name] = Number.isFinite(count) ? count : 0;
  }
  return counts;
}

async function migrationCount(): Promise<number | null> {
  try {
    // drizzle.config.ts keeps the migration journal in public.drizzle_migrations;
    // querying drizzle.__drizzle_migrations silently reported "unknown" on every run.
    const result = await db.execute(
      sql`select count(*)::int as count from public.drizzle_migrations`,
    );
    const row = (result as { rows?: Record<string, unknown>[] }).rows?.[0];
    const count = Number(row?.count ?? 0);
    return Number.isFinite(count) ? count : null;
  } catch {
    return null;
  }
}

async function databaseBytes(): Promise<number | null> {
  try {
    const result = await db.execute(
      sql`select pg_database_size(current_database())::float8 as bytes`,
    );
    const row = (result as { rows?: Record<string, unknown>[] }).rows?.[0];
    const bytes = Number(row?.bytes ?? 0);
    return Number.isFinite(bytes) ? bytes : null;
  } catch {
    return null;
  }
}

function sampleAttachments(objects: StoredObject[]): StoredObject[] {
  const attachments = objects.filter((object) => object.key.includes("/attachment/"));
  if (attachments.length <= ATTACHMENT_SAMPLE) return attachments;

  const step = Math.ceil(attachments.length / ATTACHMENT_SAMPLE);
  const sample: StoredObject[] = [];
  for (let index = 0; index < attachments.length; index += step) {
    sample.push(attachments[index]!);
    if (sample.length >= ATTACHMENT_SAMPLE) break;
  }
  return sample;
}

async function pruneManifests(now: Date): Promise<number> {
  const { backupManifestsDays } = getRetentionSettings();
  const cutoff = now.getTime() - backupManifestsDays * DAY_MS;
  try {
    const storage = getStorage();
    const manifests = await storage.list("backups/manifests/");
    let pruned = 0;
    for (const manifest of manifests) {
      const createdAt = Date.parse(manifest.createdAt);
      if (Number.isFinite(createdAt) && createdAt < cutoff) {
        await storage.delete(manifest.key);
        pruned += 1;
      }
    }
    return pruned;
  } catch (error) {
    logEvent("warn", "backup.manifest_prune_failed", {
      error: serializeError(error),
    });
    return 0;
  }
}

export type BackupVerificationResult = {
  checkedAt: string;
  database: "ok" | "failed";
  storage: "ok" | "failed";
  manifest: "ok" | "failed";
  objects: number;
  bytes: number;
  attachmentsChecked: number;
  attachmentsFailed: number;
  manifestKey: string | null;
  /** Whether the result rows were persisted for /status and the alert rule. */
  recorded: boolean;
};

export async function runBackupVerification(
  now = new Date(),
): Promise<BackupVerificationResult> {
  const startedAt = performance.now();
  const release = getReleaseInfo().release;
  const storage = getStorage();

  let objects: StoredObject[] = [];
  let storageReadable = true;
  try {
    objects = await storage.list();
  } catch (error) {
    storageReadable = false;
    logEvent("error", "backup.storage_list_failed", {
      error: serializeError(error),
    });
  }

  const bytes = objects.reduce((sum, object) => sum + object.byteSize, 0);
  const sample = sampleAttachments(objects);
  let attachmentsFailed = 0;
  for (const object of sample) {
    try {
      const read = await storage.get(object.key);
      if (!read || read.object.checksum !== object.checksum) attachmentsFailed += 1;
    } catch {
      attachmentsFailed += 1;
    }
  }

  let counts: Record<string, number> = {};
  let migrations: number | null = null;
  let dbBytes: number | null = null;
  let databaseOk = true;
  try {
    [counts, migrations, dbBytes] = await Promise.all([
      tableCounts(),
      migrationCount(),
      databaseBytes(),
    ]);
  } catch (error) {
    databaseOk = false;
    logEvent("error", "backup.database_inventory_failed", {
      error: serializeError(error),
    });
  }

  const storageOk = storageReadable && attachmentsFailed === 0;
  const detail = !storageReadable
    ? "The storage inventory could not be read."
    : attachmentsFailed > 0
      ? `${attachmentsFailed} of ${sample.length} sampled attachments failed verification.`
      : `Storage inventory read; ${sample.length} attachment${sample.length === 1 ? "" : "s"} verified.`;

  const databaseDetail = databaseOk
    ? `Database inventory read: ${migrations ?? "unknown"} migrations, ${dbBytes ?? "unknown"} bytes.`
    : "The database inventory could not be read.";

  const manifest = buildBackupManifest({
    generatedAt: now,
    release,
    migrations,
    databaseBytes: dbBytes,
    counts,
    objects: objects.length,
    bytes,
    attachmentsChecked: sample.length,
    attachmentsFailed,
  });
  const serialized = new TextEncoder().encode(JSON.stringify(manifest));
  const checksum = manifestChecksum(serialized);
  const manifestKey = `backups/manifests/${now.toISOString().slice(0, 10).replace(/-/g, "/")}/${randomUUID()}.json`;

  let manifestOk = false;
  let manifestDetail = "The manifest was not written.";
  if (storageOk) {
    try {
      await storage.put({
        key: manifestKey,
        fileName: "herald-backup-manifest.json",
        contentType: "application/json",
        body: serialized,
      });
      const readBack = await storage.get(manifestKey);
      manifestOk =
        readBack !== null && manifestChecksum(readBack.body) === checksum;
      manifestDetail = manifestOk
        ? `Manifest ${checksum.slice(0, 12)} written and verified by read-back.`
        : "The manifest read-back did not match its checksum.";
    } catch (error) {
      manifestDetail = "The manifest could not be written.";
      logEvent("error", "backup.manifest_write_failed", {
        error: serializeError(error),
      });
    }
  }

  const durationMs = Math.max(1, Math.round(performance.now() - startedAt));
  const rows = [
    {
      kind: "database",
      status: databaseOk ? "ok" : "failed",
      detail: databaseDetail,
      objectCount: null,
      byteSize: dbBytes,
      checksum: null,
      manifestKey: null,
      durationMs,
    },
    {
      kind: "storage",
      status: storageOk ? "ok" : "failed",
      detail,
      objectCount: objects.length,
      byteSize: bytes,
      checksum: null,
      manifestKey: null,
      durationMs,
    },
    {
      kind: "manifest",
      status: manifestOk ? "ok" : "failed",
      detail: manifestDetail,
      objectCount: objects.length,
      byteSize: serialized.byteLength,
      checksum,
      manifestKey,
      durationMs,
    },
  ] as const;

  let recorded = true;
  try {
    await db.insert(backupVerifications).values(
      rows.map((row) => ({
        kind: row.kind,
        status: row.status,
        detail: row.detail,
        objectCount: row.objectCount,
        byteSize: row.byteSize,
        checksum: row.checksum,
        manifestKey: row.manifestKey,
        durationMs: row.durationMs,
        checkedAt: now,
      })),
    );
  } catch (error) {
    recorded = false;
    logEvent("error", "backup.verification_record_failed", {
      error: serializeError(error),
    });
  }

  const pruned = await pruneManifests(now);
  logEvent(storageOk && databaseOk && manifestOk && recorded ? "info" : "warn", "backup.verification", {
    database: databaseOk ? "ok" : "failed",
    storage: storageOk ? "ok" : "failed",
    manifest: manifestOk ? "ok" : "failed",
    objects: objects.length,
    bytes,
    attachmentsChecked: sample.length,
    attachmentsFailed,
    manifestsPruned: pruned,
    recorded,
    durationMs,
  });

  const result: BackupVerificationResult = {
    checkedAt: now.toISOString(),
    database: databaseOk ? "ok" : "failed",
    storage: storageOk ? "ok" : "failed",
    manifest: manifestOk ? "ok" : "failed",
    objects: objects.length,
    bytes,
    attachmentsChecked: sample.length,
    attachmentsFailed,
    manifestKey: manifestOk ? manifestKey : null,
    recorded,
  };

  if (result.database === "failed" || result.storage === "failed" || result.manifest === "failed") {
    throw new Error(
      `Backup verification failed (database=${result.database}, storage=${result.storage}, manifest=${result.manifest}).`,
    );
  }

  if (!recorded) {
    throw new Error(
      "Backup verification completed, but its result could not be recorded. /status and the backup_freshness alert would not see it.",
    );
  }

  return result;
}
