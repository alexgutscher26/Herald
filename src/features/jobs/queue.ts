import "server-only";

import { and, eq, lt, sql } from "drizzle-orm";

import { db } from "@/db";
import { jobs, jobRuns } from "@/db/schema";
import { logEvent, serializeError } from "@/lib/logger";
import { currentRequestId, runWithRequestId } from "@/lib/observability/context";
import { withSpan } from "@/lib/observability/tracing";

import { nextAttemptAt } from "./backoff";
import { NonRetryableJobError } from "./errors";
import { getJobHandler } from "./handlers";
import type {
  ClaimedJob,
  JobExecution,
  JobRunSummary,
  JobStatus,
  JobType,
  JobTypeCounts,
} from "./types";

/**
 * Durable job queue.
 *
 * Claiming is a short transaction: select one due row `FOR UPDATE SKIP LOCKED`,
 * mark it running and increment attempts, then commit. The handler runs after
 * the commit, so a slow job never holds a row lock. A crashed runner is
 * recovered by reclaiming locks older than ten minutes.
 */

const STALE_LOCK_MS = 10 * 60 * 1000;
const DEFAULT_BATCH = 20;
const MAX_BATCH = 50;

export type EnqueuedJob = {
  id: string;
  status: JobStatus;
  result: Record<string, unknown> | null;
  lastError: string | null;
  /** False when the dedupe key matched an existing job. */
  created: boolean;
};

export async function enqueueJob(input: {
  type: JobType;
  payload?: Record<string, unknown>;
  dedupeKey?: string | null;
  runAt?: Date;
}): Promise<EnqueuedJob> {
  const dedupeKey = input.dedupeKey ?? null;
  const requestId = currentRequestId();
  const inserted = await db
    .insert(jobs)
    .values({
      type: input.type,
      // The id is duplicated into the payload so a handler that only sees the
      // stored JSON (or a dead-letter inspector) can still correlate it. The
      // dedicated column is the authoritative value used for execution.
      payload: requestId
        ? { ...(input.payload ?? {}), requestId }
        : (input.payload ?? {}),
      requestId,
      dedupeKey,
      // Omit `runAt` for "now": the column default uses the database clock,
      // which is also what claiming compares against. A JavaScript timestamp
      // can be a few milliseconds ahead of the server, leaving a fresh job
      // invisible until the clocks agree.
      ...(input.runAt ? { runAt: input.runAt } : {}),
    })
    .onConflictDoNothing()
    .returning({
      id: jobs.id,
      status: jobs.status,
      result: jobs.result,
      lastError: jobs.lastError,
    });

  if (inserted[0]) return { ...inserted[0], created: true };

  if (dedupeKey) {
    const existing = await db
      .select({
        id: jobs.id,
        status: jobs.status,
        result: jobs.result,
        lastError: jobs.lastError,
      })
      .from(jobs)
      .where(eq(jobs.dedupeKey, dedupeKey))
      .limit(1);
    if (existing[0]) return { ...existing[0], created: false };
  }

  throw new Error("Could not enqueue the job.");
}

async function claimNextJob(): Promise<ClaimedJob | null> {
  return db.transaction(async (tx) => {
    const selected = await tx.execute(sql`
      SELECT "id" FROM "jobs"
      WHERE "status" = 'pending' AND "run_at" <= now()
      ORDER BY "run_at" ASC, "created_at" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `);

    const first = selected.rows[0] as { id?: unknown } | undefined;
    if (!first || typeof first.id !== "string") return null;

    const updated = await tx
      .update(jobs)
      .set({
        status: "running",
        lockedAt: new Date(),
        attempts: sql`${jobs.attempts} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, first.id))
      .returning({
        id: jobs.id,
        type: jobs.type,
        payload: jobs.payload,
        requestId: jobs.requestId,
        attempts: jobs.attempts,
        maxAttempts: jobs.maxAttempts,
      });

    return updated[0] ?? null;
  });
}

async function claimJobById(id: string): Promise<ClaimedJob | null> {
  const updated = await db
    .update(jobs)
    .set({
      status: "running",
      lockedAt: new Date(),
      attempts: sql`${jobs.attempts} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(jobs.id, id), eq(jobs.status, "pending")))
    .returning({
      id: jobs.id,
      type: jobs.type,
      payload: jobs.payload,
      requestId: jobs.requestId,
      attempts: jobs.attempts,
      maxAttempts: jobs.maxAttempts,
    });

  return updated[0] ?? null;
}

async function releaseStaleLocks(now: Date): Promise<void> {
  await db
    .update(jobs)
    .set({ status: "pending", lockedAt: null, updatedAt: now })
    .where(
      and(
        eq(jobs.status, "running"),
        lt(jobs.lockedAt, new Date(now.getTime() - STALE_LOCK_MS)),
      ),
    );
}

async function executeClaimedJob(job: ClaimedJob): Promise<JobExecution> {
  // Re-enter the enqueuing request's context so provider calls and logs from
  // the job carry the same id as the customer request that created it.
  return runWithRequestId(job.requestId, () =>
    withSpan(
      `job.${job.type}`,
      { jobId: job.id, type: job.type, attempts: job.attempts },
      () => executeJob(job),
    ),
  );
}

async function executeJob(job: ClaimedJob): Promise<JobExecution> {
  const now = new Date();
  const handler = getJobHandler(job.type);

  if (!handler) {
    logEvent("error", "job.handler_missing", {
      jobId: job.id,
      type: job.type,
      requestId: job.requestId,
    });
    await db
      .update(jobs)
      .set({
        status: "failed",
        lockedAt: null,
        lastError: `No handler registered for ${job.type}.`,
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(jobs.id, job.id));
    return { id: job.id, type: job.type, status: "failed" };
  }

  try {
    const result = await handler(job.payload);
    await db
      .update(jobs)
      .set({
        status: "succeeded",
        result,
        lockedAt: null,
        lastError: null,
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(jobs.id, job.id));
    return { id: job.id, type: job.type, status: "succeeded" };
  } catch (error) {
    const message =
      error instanceof Error ? error.message.slice(0, 500) : "The job failed.";
    const terminal =
      error instanceof NonRetryableJobError || job.attempts >= job.maxAttempts;

    logEvent("error", terminal ? "job.failed" : "job.retrying", {
      jobId: job.id,
      type: job.type,
      requestId: job.requestId,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      error: serializeError(error),
    });

    if (terminal) {
      await db
        .update(jobs)
        .set({
          status: "failed",
          lockedAt: null,
          lastError: message,
          completedAt: now,
          updatedAt: now,
        })
        .where(eq(jobs.id, job.id));
      return { id: job.id, type: job.type, status: "failed" };
    }

    await db
      .update(jobs)
      .set({
        status: "pending",
        lockedAt: null,
        lastError: message,
        runAt: nextAttemptAt(job.attempts, now),
        updatedAt: now,
      })
      .where(eq(jobs.id, job.id));
    return { id: job.id, type: job.type, status: "retrying" };
  }
}

export async function runDueJobs(limit = DEFAULT_BATCH): Promise<JobRunSummary> {
  const bounded = Math.min(Math.max(Math.trunc(limit), 1), MAX_BATCH);
  const now = new Date();
  await releaseStaleLocks(now);

  const byType: Partial<Record<JobType, JobTypeCounts>> = {};
  const summary: JobRunSummary = {
    checkedAt: now.toISOString(),
    claimed: 0,
    succeeded: 0,
    failed: 0,
    retrying: 0,
    byType,
    results: [],
  };

  for (let index = 0; index < bounded; index += 1) {
    const job = await claimNextJob();
    if (!job) break;

    summary.claimed += 1;
    const counts = (byType[job.type] ??= {
      claimed: 0,
      succeeded: 0,
      failed: 0,
      retrying: 0,
    });
    counts.claimed += 1;

    const execution = await executeClaimedJob(job);
    summary.results.push(execution);
    if (execution.status === "succeeded") {
      summary.succeeded += 1;
      counts.succeeded += 1;
    } else if (execution.status === "retrying") {
      summary.retrying += 1;
      counts.retrying += 1;
    } else {
      summary.failed += 1;
      counts.failed += 1;
    }
  }

  await recordJobRun(summary, now);
  return summary;
}

/**
 * Persist one runner invocation.
 *
 * A failure to write history must never fail the run itself — the work has
 * already happened, and the per-job rows still hold the authoritative state.
 */
async function recordJobRun(summary: JobRunSummary, startedAt: Date): Promise<void> {
  const finishedAt = new Date();
  const durationMs = Math.max(0, finishedAt.getTime() - startedAt.getTime());

  try {
    await db.insert(jobRuns).values({
      startedAt,
      finishedAt,
      claimed: summary.claimed,
      succeeded: summary.succeeded,
      failed: summary.failed,
      retrying: summary.retrying,
      durationMs,
    });
  } catch (error) {
    logEvent("warn", "job_run.record_failed", { error: serializeError(error) });
  }

  logEvent("info", "job_run.completed", {
    claimed: summary.claimed,
    succeeded: summary.succeeded,
    failed: summary.failed,
    retrying: summary.retrying,
    durationMs,
  });
}

export type RunJobNowResult = {
  jobId: string;
  status: JobStatus | "retrying" | "missing";
  result: Record<string, unknown> | null;
  error?: string | undefined;
};

/**
 * Enqueue and run one job synchronously. Used by the existing scheduled
 * publish endpoint so its contract stays intact while publishing becomes a
 * normal job type. A dedupe hit returns the stored result instead of running
 * the work twice.
 */
export async function runJobNow(input: {
  type: JobType;
  payload?: Record<string, unknown>;
  dedupeKey?: string | null;
}): Promise<RunJobNowResult> {
  const enqueued = await enqueueJob(input);

  if (enqueued.status === "succeeded") {
    return {
      jobId: enqueued.id,
      status: "succeeded",
      result: enqueued.result,
    };
  }
  if (enqueued.status === "failed") {
    return {
      jobId: enqueued.id,
      status: "failed",
      result: enqueued.result,
      error: enqueued.lastError ?? "The job failed.",
    };
  }

  const claimed = await claimJobById(enqueued.id);
  if (!claimed) {
    const current = await db
      .select({
        status: jobs.status,
        result: jobs.result,
        lastError: jobs.lastError,
      })
      .from(jobs)
      .where(eq(jobs.id, enqueued.id))
      .limit(1);

    const row = current[0];
    return {
      jobId: enqueued.id,
      status: row?.status ?? "missing",
      result: row?.result ?? null,
      error: row?.lastError ?? undefined,
    };
  }

  const execution = await executeClaimedJob(claimed);
  const current = await db
    .select({ result: jobs.result, lastError: jobs.lastError })
    .from(jobs)
    .where(eq(jobs.id, enqueued.id))
    .limit(1);

  return {
    jobId: enqueued.id,
    status: execution.status,
    result: current[0]?.result ?? null,
    error: current[0]?.lastError ?? undefined,
  };
}
