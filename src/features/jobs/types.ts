import type { JobStatus, JobType } from "@/db/schema/jobs";

export type { JobStatus, JobType };

/** Handlers receive only the stored JSON payload; they never read request data. */
export type JobHandler = (
  payload: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

export type ClaimedJob = {
  id: string;
  type: JobType;
  payload: Record<string, unknown>;
  /** Correlation id of the request that enqueued the job, when there was one. */
  requestId: string | null;
  attempts: number;
  maxAttempts: number;
};

export type JobExecution = {
  id: string;
  type: JobType;
  status: "succeeded" | "failed" | "retrying";
};

export type JobTypeCounts = {
  claimed: number;
  succeeded: number;
  failed: number;
  retrying: number;
};

export type JobRunSummary = {
  checkedAt: string;
  claimed: number;
  succeeded: number;
  failed: number;
  retrying: number;
  /**
   * Counts per job type processed by this invocation. A type is absent when it
   * was not claimed; the shape stays stable for a scheduler without listing
   * every enum value.
   */
  byType: Partial<Record<JobType, JobTypeCounts>>;
  results: JobExecution[];
};
