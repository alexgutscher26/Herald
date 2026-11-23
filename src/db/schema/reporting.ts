import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "@/db/schema/auth";
import { products, workspaces } from "@/db/schema/workspaces";

const tz = { withTimezone: true } as const;

/**
 * Reporting layer storage.
 *
 * A saved report is a catalogue selection, not SQL: `dataset` and `metrics`
 * are validated against `src/features/reporting/catalogue.ts` before every
 * write and read, so a client can never inject a column or expression. Runs
 * snapshot the result so a dashboard can render the last successful number
 * without re-running every query on each page load.
 */

export const reportScheduleEnum = pgEnum("report_schedule", [
  "none",
  "daily",
  "weekly",
  "monthly",
]);

export const reportFormatEnum = pgEnum("report_format", ["csv", "pdf"]);

export const reportRunStatusEnum = pgEnum("report_run_status", [
  "succeeded",
  "failed",
]);

export type ReportAlertConfig = {
  metric: string;
  operator: "above" | "below";
  value: number;
};

export const savedReports = pgTable(
  "saved_reports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    dataset: text("dataset").notNull(),
    metrics: jsonb("metrics").$type<string[]>().notNull().default([]),
    days: integer("days").notNull().default(30),
    comparePrevious: boolean("compare_previous").notNull().default(true),
    schedule: reportScheduleEnum("schedule").notNull().default("none"),
    format: reportFormatEnum("format").notNull().default("csv"),
    recipients: jsonb("recipients").$type<string[]>().notNull().default([]),
    alert: jsonb("alert").$type<ReportAlertConfig | null>(),
    /** True while the threshold is firing; used to email only on transition. */
    alertActive: boolean("alert_active").notNull().default(false),
    showOnDashboard: boolean("show_on_dashboard").notNull().default(true),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    lastRunAt: timestamp("last_run_at", tz),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    index("saved_reports_workspace_product_idx").on(t.workspaceId, t.productId),
    index("saved_reports_schedule_idx").on(t.schedule, t.lastRunAt),
    index("saved_reports_product_dashboard_idx").on(t.productId, t.showOnDashboard),
  ],
);

export const reportRuns = pgTable(
  "report_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => savedReports.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    status: reportRunStatusEnum("status").notNull(),
    fromDay: date("from_day").notNull(),
    toDay: date("to_day").notNull(),
    /** Full query result: series, totals, previous totals and comparisons. */
    result: jsonb("result").$type<Record<string, unknown> | null>(),
    alertTriggered: boolean("alert_triggered").notNull().default(false),
    emailedTo: jsonb("emailed_to").$type<string[]>().notNull().default([]),
    error: text("error"),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    index("report_runs_report_created_idx").on(t.reportId, t.createdAt),
    index("report_runs_workspace_created_idx").on(t.workspaceId, t.createdAt),
  ],
);

export type SavedReport = typeof savedReports.$inferSelect;
export type NewSavedReport = typeof savedReports.$inferInsert;
export type ReportRun = typeof reportRuns.$inferSelect;
export type NewReportRun = typeof reportRuns.$inferInsert;
