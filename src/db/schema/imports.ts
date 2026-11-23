import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "@/db/schema/auth";
import { boards } from "@/db/schema/boards";
import { products, workspaces } from "@/db/schema/workspaces";

const tz = { withTimezone: true } as const;

/**
 * Import formats understood by the one importer.
 *
 * `generic` maps whatever headers the file has. The named formats are CSV
 * exports from other feedback tools: they carry the same fields under
 * different column names and use different status vocabularies. They are not
 * separate code paths — only preset column mappings and status words.
 */
export const feedbackImportFormatEnum = pgEnum("feedback_import_format", [
  "generic",
  "canny",
  "productboard",
  "nolt",
  "frill",
  "beamer",
]);

export const feedbackImportStatusEnum = pgEnum("feedback_import_status", [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

/** Where rows came from. CSV is the default; the API sources normalize too. */
export const feedbackImportSourceEnum = pgEnum("feedback_import_source", [
  "csv",
  "github",
  "herald",
]);

export const feedbackImportRowStatusEnum = pgEnum("feedback_import_row_status", [
  "pending",
  "imported",
  "skipped",
  "failed",
]);

/**
 * One upload, processed in the background.
 *
 * The source rows are copied into `feedback_import_rows` at upload time, so the
 * job never needs the browser or the original file again and a retry resumes
 * exactly where it stopped. Counters are rolled up per batch; the row table
 * remains the authoritative record.
 */
export const feedbackImports = pgTable(
  "feedback_imports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** Fallback board for rows without a board column. */
    boardId: uuid("board_id").references(() => boards.id, { onDelete: "set null" }),
    format: feedbackImportFormatEnum("format").notNull().default("generic"),
    source: feedbackImportSourceEnum("source").notNull().default("csv"),
    /** Non-secret source coordinates (repository or API origin); never tokens. */
    sourceConfig: jsonb("source_config").$type<Record<string, string>>().notNull().default({}),
    fileName: text("file_name").notNull(),
    /** Import field → source column header. Frozen at upload time. */
    mapping: jsonb("mapping").$type<Record<string, string>>().notNull().default({}),
    status: feedbackImportStatusEnum("status").notNull().default("queued"),
    totalRows: integer("total_rows").notNull().default(0),
    processedRows: integer("processed_rows").notNull().default(0),
    importedRows: integer("imported_rows").notNull().default(0),
    skippedRows: integer("skipped_rows").notNull().default(0),
    failedRows: integer("failed_rows").notNull().default(0),
    importedAttachments: integer("imported_attachments").notNull().default(0),
    lastError: text("last_error"),
    cancelRequestedAt: timestamp("cancel_requested_at", tz),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
    completedAt: timestamp("completed_at", tz),
  },
  (t) => [
    index("feedback_imports_product_created_idx").on(t.productId, t.createdAt),
    index("feedback_imports_status_idx").on(t.status, t.createdAt),
  ],
);

/**
 * One source row, normalized to import fields at upload time.
 *
 * `rowNumber` is the 1-based data row (header excluded) and is stable across
 * retries. The unique pair is what makes inserting the resulting feedback post
 * idempotent when a worker crashes between the insert and the row update.
 */
export const feedbackImportRows = pgTable(
  "feedback_import_rows",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    importId: uuid("import_id")
      .notNull()
      .references(() => feedbackImports.id, { onDelete: "cascade" }),
    rowNumber: integer("row_number").notNull(),
    data: jsonb("data").$type<Record<string, string>>().notNull().default({}),
    status: feedbackImportRowStatusEnum("status").notNull().default("pending"),
    /** Why this row was skipped or failed; never the whole source row. */
    error: text("error"),
    feedbackPostId: uuid("feedback_post_id"),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    processedAt: timestamp("processed_at", tz),
  },
  (t) => [
    unique("feedback_import_rows_import_row_unique").on(t.importId, t.rowNumber),
    index("feedback_import_rows_pending_idx").on(t.importId, t.status),
  ],
);

/**
 * A remembered column mapping, scoped to the workspace.
 *
 * The signature is the normalized set of source headers, so the same export
 * re-applies its mapping even when the columns arrive in another order. A new
 * save for the same signature replaces the old one instead of piling up.
 */
export const feedbackImportPresets = pgTable(
  "feedback_import_presets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    format: feedbackImportFormatEnum("format").notNull().default("generic"),
    signature: text("signature").notNull(),
    mapping: jsonb("mapping").$type<Record<string, string>>().notNull().default({}),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("feedback_import_presets_workspace_signature_unique").on(
      t.workspaceId,
      t.signature,
    ),
    index("feedback_import_presets_workspace_idx").on(t.workspaceId, t.updatedAt),
  ],
);

export type FeedbackImport = typeof feedbackImports.$inferSelect;
export type FeedbackImportPreset = typeof feedbackImportPresets.$inferSelect;
export type NewFeedbackImport = typeof feedbackImports.$inferInsert;
export type FeedbackImportRow = typeof feedbackImportRows.$inferSelect;
export type NewFeedbackImportRow = typeof feedbackImportRows.$inferInsert;
