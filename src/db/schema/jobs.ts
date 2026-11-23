import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

const tz = { withTimezone: true } as const;

export const jobTypeEnum = pgEnum("job_type", [
  "publish_releases",
  "deliver_notification",
  "send_email",
  "send_weekly_digest",
  "process_import",
  "crawl_knowledge",
  "juno_answer",
  "juno_auto_resolve",
  "juno_tag_feedback",
  "juno_duplicate_suggestions",
  "slack_message",
  "slack_command",
  "slack_status_update",
  "slack_support_message",
  "slack_support_mirror",
  "issue_tracker_event",
  "sync_crm_connection",
  "schedule_crm_sync",
  "recalculate_analytics",
  "export_saved_reports",
  "purge_workspaces",
  "prune_audit_events",
  "send_billing_email",
  "expire_dunning",
  "send_onboarding_emails",
  "schedule_outbound_messages",
  "deliver_outbound_message",
  "evaluate_alerts",
  "verify_backups",
  "prune_observability",
]);

export const jobStatusEnum = pgEnum("job_status", [
  "pending",
  "running",
  "succeeded",
  "failed",
]);

/**
 * Durable background work.
 *
 * Claiming uses `FOR UPDATE SKIP LOCKED`, so two runners cannot execute the
 * same row. `dedupeKey` is an optional idempotency key for work that must be
 * enqueued exactly once (for example, one publish per minute). `attempts` is
 * incremented at claim time, which means a crashed worker still consumes an
 * attempt when the stale lock is reclaimed.
 */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    type: jobTypeEnum("type").notNull(),
    status: jobStatusEnum("status").notNull().default("pending"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    dedupeKey: text("dedupe_key").unique(),
    /**
     * Correlation id of the request that enqueued this job. It is copied from
     * the async request context, never taken from a payload, and is echoed on
     * job logs, spans and outbound provider calls.
     */
    requestId: text("request_id"),
    runAt: timestamp("run_at", tz).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", tz),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    lastError: text("last_error"),
    result: jsonb("result").$type<Record<string, unknown> | null>(),
    completedAt: timestamp("completed_at", tz),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    index("jobs_due_idx").on(t.status, t.runAt),
    index("jobs_type_status_idx").on(t.type, t.status),
    index("jobs_locked_idx").on(t.lockedAt),
    index("jobs_status_completed_idx").on(t.status, t.completedAt),
  ],
);

/**
 * One row per runner invocation.
 *
 * Per-job rows answer "what happened to this job"; this table answers "is the
 * runner actually running, and how often is it failing". Without it a stalled
 * queue looks exactly like an empty one.
 */
export const jobRuns = pgTable(
  "job_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    startedAt: timestamp("started_at", tz).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", tz),
    claimed: integer("claimed").notNull().default(0),
    succeeded: integer("succeeded").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    retrying: integer("retrying").notNull().default(0),
    durationMs: integer("duration_ms"),
  },
  (t) => [index("job_runs_started_idx").on(t.startedAt)],
);

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type JobType = (typeof jobTypeEnum.enumValues)[number];
export type JobStatus = (typeof jobStatusEnum.enumValues)[number];
export type JobRun = typeof jobRuns.$inferSelect;
export type NewJobRun = typeof jobRuns.$inferInsert;
