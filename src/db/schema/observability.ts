import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  doublePrecision,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { products, workspaces } from "@/db/schema/workspaces";

const tz = { withTimezone: true } as const;

/**
 * One row per route, method, status class and UTC minute.
 *
 * This is deliberately aggregated: an operator needs a 5xx rate and a slow-route
 * trend, not a second request log. The table is sparse (one row per bucket, not
 * per request), carries no tenant identifier and is pruned after a week.
 */
export const requestMetrics = pgTable(
  "request_metrics",
  {
    bucketStart: timestamp("bucket_start", tz).notNull(),
    route: text("route").notNull(),
    method: text("method").notNull(),
    statusClass: text("status_class").notNull(),
    count: integer("count").notNull().default(0),
    totalMs: integer("total_ms").notNull().default(0),
    maxMs: integer("max_ms").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.bucketStart, t.route, t.method, t.statusClass] }),
    index("request_metrics_bucket_idx").on(t.bucketStart),
    check(
      "request_metrics_status_ck",
      sql`${t.statusClass} in ('2xx','3xx','4xx','5xx')`,
    ),
    check("request_metrics_count_ck", sql`${t.count} >= 0`),
    check("request_metrics_timing_ck", sql`${t.totalMs} >= 0 and ${t.maxMs} >= 0`),
  ],
);

/**
 * Token usage for AI calls.
 *
 * `estimated_cost_micros` is computed at write time from the deployment's
 * configured rates, so a later price change does not rewrite history. The row
 * intentionally stores no prompt, completion, customer text or model response:
 * it answers "what did AI cost", not "what did a customer ask".
 */
export const aiUsageEvents = pgTable(
  "ai_usage_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, {
      onDelete: "set null",
    }),
    productId: uuid("product_id").references(() => products.id, {
      onDelete: "set null",
    }),
    feature: text("feature").notNull().default("ai"),
    model: text("model").notNull(),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    estimatedCostMicros: bigint("estimated_cost_micros", { mode: "number" })
      .notNull()
      .default(0),
    requestId: text("request_id"),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    index("ai_usage_events_created_idx").on(t.createdAt),
    index("ai_usage_events_workspace_created_idx").on(t.workspaceId, t.createdAt),
    check("ai_usage_events_tokens_ck", sql`${t.promptTokens} >= 0 and ${t.completionTokens} >= 0`),
    check("ai_usage_events_cost_ck", sql`${t.estimatedCostMicros} >= 0`),
  ],
);

/**
 * Dashboard product analytics: which settings sections a teammate actually
 * opens.
 *
 * Privacy decisions (see docs/dashboard-analytics-privacy.md):
 *  - no page content, form values, query strings, referrer, IP or user agent;
 *  - `actor_ref` is a keyed, one-way hash of the user id, used only to count
 *    distinct people — the raw id is never stored;
 *  - only a fixed allowlist of section slugs is accepted by the write path;
 *  - rows are pruned after the configured retention window.
 */
export const dashboardViewEvents = pgTable(
  "dashboard_view_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, {
      onDelete: "set null",
    }),
    surface: text("surface").notNull(),
    section: text("section").notNull(),
    actorRef: text("actor_ref").notNull(),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    index("dashboard_view_events_workspace_created_idx").on(t.workspaceId, t.createdAt),
    index("dashboard_view_events_surface_section_idx").on(t.surface, t.section, t.createdAt),
    check(
      "dashboard_view_events_surface_ck",
      sql`${t.surface} in ('workspace_settings','product_settings')`,
    ),
    check(
      "dashboard_view_events_section_ck",
      sql`length(${t.section}) between 1 and 60 and ${t.section} ~ '^[a-z0-9][a-z0-9-]*$'`,
    ),
    check("dashboard_view_events_actor_ck", sql`length(${t.actorRef}) between 8 and 64`),
  ],
);

/**
 * Alert transition state.
 *
 * Storing the last state (rather than a row per evaluation) means a firing
 * alert notifies once, not every five minutes, and a recovery notifies once.
 */
export const alertStates = pgTable(
  "alert_states",
  {
    rule: text("rule").primaryKey(),
    state: text("state").notNull().default("ok"),
    value: doublePrecision("value"),
    threshold: doublePrecision("threshold"),
    detail: text("detail"),
    firedAt: timestamp("fired_at", tz),
    resolvedAt: timestamp("resolved_at", tz),
    notifiedAt: timestamp("notified_at", tz),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    check("alert_states_state_ck", sql`${t.state} in ('ok','firing')`),
  ],
);

/**
 * Automated backup verification results.
 *
 * A row is evidence that a check actually ran — not a note that someone
 * intended to run a drill. The scheduled `verify_backups` job writes these and
 * the status page reports the age of the newest successful row.
 */
export const backupVerifications = pgTable(
  "backup_verifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    detail: text("detail"),
    objectCount: integer("object_count"),
    byteSize: bigint("byte_size", { mode: "number" }),
    checksum: text("checksum"),
    manifestKey: text("manifest_key"),
    durationMs: integer("duration_ms"),
    checkedAt: timestamp("checked_at", tz).notNull().defaultNow(),
  },
  (t) => [
    index("backup_verifications_kind_checked_idx").on(t.kind, t.checkedAt),
    index("backup_verifications_checked_idx").on(t.checkedAt),
    check(
      "backup_verifications_kind_ck",
      sql`${t.kind} in ('database','storage','manifest')`,
    ),
    check("backup_verifications_status_ck", sql`${t.status} in ('ok','failed')`),
  ],
);

export type RequestMetric = typeof requestMetrics.$inferSelect;
export type AiUsageEvent = typeof aiUsageEvents.$inferSelect;
export type NewAiUsageEvent = typeof aiUsageEvents.$inferInsert;
export type DashboardViewEvent = typeof dashboardViewEvents.$inferSelect;
export type AlertState = typeof alertStates.$inferSelect;
export type BackupVerification = typeof backupVerifications.$inferSelect;
export type NewBackupVerification = typeof backupVerifications.$inferInsert;
