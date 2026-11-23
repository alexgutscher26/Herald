import "server-only";

import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { jobs, jobRuns } from "@/db/schema";

/**
 * Operational read models for the queue.
 *
 * Deliberately narrow: counts, status and the stored error message. Payloads
 * can contain tenant ids, so they are never selected here — an operator can see
 * that a job failed without being able to read its contents from this surface.
 */

const MAX_ROWS = 100;

function bounded(limit: number, fallback: number): number {
  if (!Number.isFinite(limit)) return fallback;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_ROWS);
}

export type JobRunView = {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  claimed: number;
  succeeded: number;
  failed: number;
  retrying: number;
  durationMs: number | null;
};

export type FailedJobView = {
  id: string;
  type: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  updatedAt: string;
};

export async function getRecentJobRuns(limit = 10): Promise<JobRunView[]> {
  const rows = await db
    .select({
      id: jobRuns.id,
      startedAt: jobRuns.startedAt,
      finishedAt: jobRuns.finishedAt,
      claimed: jobRuns.claimed,
      succeeded: jobRuns.succeeded,
      failed: jobRuns.failed,
      retrying: jobRuns.retrying,
      durationMs: jobRuns.durationMs,
    })
    .from(jobRuns)
    .orderBy(desc(jobRuns.startedAt))
    .limit(bounded(limit, 10));

  return rows.map((row) => ({
    id: row.id,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    claimed: row.claimed,
    succeeded: row.succeeded,
    failed: row.failed,
    retrying: row.retrying,
    durationMs: row.durationMs,
  }));
}

/** Jobs that exhausted their attempts and need a human. */
export async function getRecentFailedJobs(limit = 20): Promise<FailedJobView[]> {
  const rows = await db
    .select({
      id: jobs.id,
      type: jobs.type,
      attempts: jobs.attempts,
      maxAttempts: jobs.maxAttempts,
      lastError: jobs.lastError,
      updatedAt: jobs.updatedAt,
    })
    .from(jobs)
    .where(eq(jobs.status, "failed"))
    .orderBy(desc(jobs.updatedAt))
    .limit(bounded(limit, 20));

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    lastError: row.lastError,
    updatedAt: row.updatedAt.toISOString(),
  }));
}
