import { afterAll, beforeAll, describe, expect } from "bun:test";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { jobRuns, jobs } from "@/db/schema";
import { enqueueJob, runDueJobs, runJobNow } from "@/features/jobs/queue";

import {
  SETUP_TIMEOUT_MS,
  isolatedTest,
  setupTestDatabase,
  teardownTestDatabase,
} from "./harness";

/**
 * The queue's guarantees are database-level (`FOR UPDATE SKIP LOCKED`, a
 * unique dedupe key, attempt accounting), so the tests run the real runner
 * against real rows.
 */

beforeAll(async () => {
  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

describe("enqueueing", () => {
  isolatedTest("a dedupe key yields exactly one job", async () => {
    const first = await enqueueJob({
      type: "publish_releases",
      dedupeKey: "minute-2026-01-01T00:00",
    });
    const second = await enqueueJob({
      type: "publish_releases",
      dedupeKey: "minute-2026-01-01T00:00",
    });

    expect(second.id).toBe(first.id);

    const rows = await db
      .select()
      .from(jobs)
      .where(eq(jobs.dedupeKey, "minute-2026-01-01T00:00"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("pending");
  });

  isolatedTest("runJobNow reuses a succeeded job instead of running twice", async () => {
    const dedupeKey = "sync-publish-test";
    const first = await runJobNow({ type: "publish_releases", dedupeKey });
    expect(first.status).toBe("succeeded");

    const second = await runJobNow({ type: "publish_releases", dedupeKey });
    expect(second.jobId).toBe(first.jobId);
    expect(second.status).toBe("succeeded");

    const rows = await db.select().from(jobs).where(eq(jobs.dedupeKey, dedupeKey));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.attempts).toBe(1);
  });
});

describe("running due work", () => {
  isolatedTest("runs a due job, records the result and one run row", async () => {
    const enqueued = await enqueueJob({
      type: "publish_releases",
      dedupeKey: "due-run",
    });

    const summary = await runDueJobs(10);

    expect(summary.claimed).toBe(1);
    expect(summary.succeeded).toBe(1);
    expect(summary.failed).toBe(0);
    expect(summary.byType.publish_releases).toEqual({
      claimed: 1,
      succeeded: 1,
      failed: 0,
      retrying: 0,
    });

    const rows = await db.select().from(jobs).where(eq(jobs.id, enqueued.id));
    expect(rows[0]?.status).toBe("succeeded");
    expect(rows[0]?.attempts).toBe(1);
    expect(rows[0]?.completedAt).not.toBeNull();

    const runs = await db.select().from(jobRuns);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.claimed).toBe(1);
    expect(runs[0]?.succeeded).toBe(1);
    expect(runs[0]?.durationMs).not.toBeNull();
  });

  isolatedTest("does not claim a job scheduled for the future", async () => {
    await enqueueJob({
      type: "publish_releases",
      dedupeKey: "future-run",
      runAt: new Date(Date.now() + 60_000),
    });

    const summary = await runDueJobs(10);
    expect(summary.claimed).toBe(0);
    expect(summary.byType).toEqual({});

    const rows = await db.select().from(jobs).where(eq(jobs.dedupeKey, "future-run"));
    expect(rows[0]?.status).toBe("pending");
    expect(rows[0]?.attempts).toBe(0);
  });

  isolatedTest("a non-retryable failure is terminal after one attempt", async () => {
    const enqueued = await enqueueJob({
      type: "send_email",
      payload: {},
      dedupeKey: "bad-email",
    });

    const summary = await runDueJobs(5);
    expect(summary.failed).toBe(1);
    expect(summary.byType.send_email).toEqual({
      claimed: 1,
      succeeded: 0,
      failed: 1,
      retrying: 0,
    });

    const rows = await db.select().from(jobs).where(eq(jobs.id, enqueued.id));
    expect(rows[0]?.status).toBe("failed");
    expect(rows[0]?.attempts).toBe(1);
    expect(rows[0]?.lastError).toContain("deliveryId");
    expect(rows[0]?.completedAt).not.toBeNull();
  });

  isolatedTest("an unregistered job type fails rather than silently succeeding", async () => {
    const enqueued = await enqueueJob({
      type: "process_import",
      dedupeKey: "no-handler",
    });

    const summary = await runDueJobs(5);
    expect(summary.failed).toBe(1);

    const rows = await db.select().from(jobs).where(eq(jobs.id, enqueued.id));
    expect(rows[0]?.status).toBe("failed");
    expect(rows[0]?.lastError).toContain("process_import");
    expect(summary.byType.process_import?.failed).toBe(1);
  });
});

describe("per-test isolation", () => {
  let writtenId: string | null = null;

  isolatedTest("sees its own uncommitted rows", async () => {
    const job = await enqueueJob({ type: "publish_releases" });
    writtenId = job.id;

    const rows = await db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(rows).toHaveLength(1);
  });

  isolatedTest("does not see the previous test's rows", async () => {
    expect(writtenId).not.toBeNull();
    expect(await db.select().from(jobs)).toHaveLength(0);
  });
});
