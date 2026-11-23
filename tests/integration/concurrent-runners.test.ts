import { afterAll, beforeAll, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { inArray } from "drizzle-orm";
import { Pool } from "pg";

import { attachDatabaseHandle, type Database } from "@/db";
import * as schema from "@/db/schema";
import { jobs } from "@/db/schema";
import { enqueueJob, runDueJobs } from "@/features/jobs/queue";

import {
  SETUP_TIMEOUT_MS,
  setupTestDatabase,
  teardownTestDatabase,
  testDatabaseConnectionString,
  testDatabaseHandle,
} from "./harness";

/**
 * Exactly-once claiming under two runners.
 *
 * The harness normally pins the application to one connection inside a
 * transaction, which serialises everything and would hide a claim race. This
 * test therefore attaches a pool of several connections and runs two
 * `runDueJobs` calls at the same time, which is what production does when a
 * scheduler overlaps. Rows are committed (other connections must see them),
 * so the test removes exactly what it created before restoring the harness
 * handle.
 */

const JOBS = 6;

let pool: Pool | null = null;
let pooled: Database | null = null;

beforeAll(async () => {
  await setupTestDatabase();

  pool = new Pool({
    connectionString: testDatabaseConnectionString(),
    max: 4,
  });
  pool.on("error", () => {});
  pooled = drizzle(pool, { schema });
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  if (pool) await pool.end();
  pool = null;
  pooled = null;
  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

test(
  "two concurrent runners execute each due job exactly once",
  async () => {
    const currentPool = pool;
    const currentPooled = pooled;
    if (!currentPool || !currentPooled) throw new Error("The pool was not created.");

    const marker = `concurrent-${Date.now().toString(36)}`;
    const keys = Array.from({ length: JOBS }, (_, index) => `${marker}-${index}`);
    const startedAt = new Date();

    attachDatabaseHandle(currentPooled);

    try {
      for (const dedupeKey of keys) {
        await enqueueJob({ type: "publish_releases", dedupeKey });
      }

      const [first, second] = await Promise.all([runDueJobs(20), runDueJobs(20)]);

      // Every job was claimed, and no job was claimed by both runners.
      expect(first.claimed + second.claimed).toBe(JOBS);
      expect(first.claimed).toBeGreaterThan(0);
      expect(second.claimed).toBeGreaterThan(0);

      const claimedByType =
        (first.byType.publish_releases?.claimed ?? 0) +
        (second.byType.publish_releases?.claimed ?? 0);
      expect(claimedByType).toBe(JOBS);

      const rows = await currentPooled
        .select()
        .from(jobs)
        .where(inArray(jobs.dedupeKey, keys));

      expect(rows).toHaveLength(JOBS);
      for (const row of rows) {
        expect(row.status).toBe("succeeded");
        expect(row.attempts).toBe(1);
        expect(row.completedAt).not.toBeNull();
      }

      const runs = await currentPool.query<{ claimed: number }>(
        `SELECT "claimed" FROM "job_runs" WHERE "started_at" >= $1`,
        [startedAt],
      );
      expect(runs.rows).toHaveLength(2);
      expect(runs.rows.reduce((total, row) => total + row.claimed, 0)).toBe(JOBS);

      // Nothing is due any more, even after two runners did the work.
      const after = await runDueJobs(20);
      expect(after.claimed).toBe(0);
    } finally {
      await currentPool.query(`DELETE FROM "jobs" WHERE "dedupe_key" = ANY($1::text[])`, [
        keys,
      ]);
      await currentPool.query(`DELETE FROM "job_runs" WHERE "started_at" >= $1`, [
        startedAt,
      ]);
      attachDatabaseHandle(testDatabaseHandle());
    }
  },
  40_000,
);
