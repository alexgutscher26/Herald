import "server-only";

import { and, asc, count, desc, eq, inArray, ne } from "drizzle-orm";

import { db } from "@/db";
import {
  boards,
  feedbackAttachments,
  feedbackImportPresets,
  feedbackImportRows,
  feedbackImports,
  feedbackPosts,
  type FeedbackImport,
  type FeedbackImportRow,
} from "@/db/schema";
import { resolveCustomerIdentity } from "@/features/customer-auth/customers";
import { enqueueJob } from "@/features/jobs/queue";
import { NonRetryableJobError } from "@/features/jobs/errors";
import { isValidEmail } from "@/lib/email";
import { isUniqueViolation } from "@/lib/error-message";

import {
  mapCategory,
  mapStatus,
  parseCreatedAt,
  parseVotes,
  validateMapping,
  type ImportStatus,
} from "./adapters";
import {
  IMPORT_FIELDS,
  MAX_IMPORT_ROWS,
  cleanCell,
  presetSignature,
  rowToData,
  type ImportField,
  type ImportFormat,
  type ImportMapping,
  type ImportRowData,
  type ImportSource,
} from "./types";
import { attachImportedCover } from "./attachments";
import { planImportRows, resolveBoardLabel, type ImportPlan } from "./plan";
import type { ImportPresetView } from "./presets";

/**
 * CSV import pipeline.
 *
 * Upload copies normalized rows into `feedback_import_rows` and enqueues one
 * `process_import` job. The job processes bounded batches so a 10,000-row file
 * never runs inside the upload request and never exceeds a single cron
 * invocation; when time runs out it enqueues a continuation and returns. Every
 * inserted post carries its import id and row number, so a retry after a crash
 * cannot duplicate a row.
 */

const BATCH_SIZE = 200;
const TIME_BUDGET_MS = 20_000;

export type CreateImportInput = {
  workspaceId: string;
  productId: string;
  createdBy: string;
  fileName: string;
  format: ImportFormat;
  boardId: string;
  headers: string[];
  rows: string[][];
  mapping: ImportMapping;
  source?: ImportSource;
  sourceConfig?: Record<string, string>;
};

export type CreateImportResult =
  | { ok: true; importId: string; totalRows: number }
  | { ok: false; error: string };

/** Resolve the fallback board inside the authorized product. */
async function resolveTargetBoard(productId: string, boardId: string) {
  const rows = await db
    .select({ id: boards.id, name: boards.name, slug: boards.slug })
    .from(boards)
    .where(and(eq(boards.id, boardId), eq(boards.productId, productId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createFeedbackImport(
  input: CreateImportInput,
): Promise<CreateImportResult> {
  if (input.rows.length === 0) {
    return { ok: false, error: "The file has no data rows." };
  }
  if (input.rows.length > MAX_IMPORT_ROWS) {
    return {
      ok: false,
      error: `Import at most ${MAX_IMPORT_ROWS.toLocaleString("en")} rows at a time.`,
    };
  }

  const board = await resolveTargetBoard(input.productId, input.boardId);
  if (!board) return { ok: false, error: "Choose a board in this product." };

  const mapped = input.rows
    .map((row, index) => ({
      rowNumber: index + 1,
      data: rowToData(input.headers, row, input.mapping),
    }))
    .filter((row) => Object.keys(row.data).length > 0);

  if (mapped.length === 0) {
    return { ok: false, error: "No mapped values were found in the file." };
  }

  const mapping: Record<string, string> = {};
  for (const field of IMPORT_FIELDS) {
    const header = input.mapping[field];
    if (header) mapping[field] = header;
  }

  const created = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(feedbackImports)
      .values({
        workspaceId: input.workspaceId,
        productId: input.productId,
        boardId: board.id,
        format: input.format,
        source: input.source ?? "csv",
        sourceConfig: input.sourceConfig ?? {},
        fileName: input.fileName.slice(0, 200),
        mapping,
        status: "queued",
        totalRows: mapped.length,
        createdBy: input.createdBy,
      })
      .returning({ id: feedbackImports.id });

    const importRow = inserted[0];
    if (!importRow) throw new Error("Import insert returned no row.");

    for (let index = 0; index < mapped.length; index += 500) {
      await tx.insert(feedbackImportRows).values(
        mapped.slice(index, index + 500).map((row) => ({
          importId: importRow.id,
          rowNumber: row.rowNumber,
          data: row.data,
        })),
      );
    }

    return importRow.id;
  });

  try {
    await enqueueJob({
      type: "process_import",
      payload: { importId: created },
      dedupeKey: `feedback-import:${created}:start`,
    });
  } catch (error) {
    await db
      .update(feedbackImports)
      .set({
        status: "failed",
        lastError: "The import was stored but the background job could not be queued.",
        updatedAt: new Date(),
      })
      .where(eq(feedbackImports.id, created));
    throw error;
  }

  return { ok: true, importId: created, totalRows: mapped.length };
}

function importPostValues(input: {
  record: FeedbackImport;
  data: ImportRowData;
  rowNumber: number;
  boardId: string;
  author: {
    customerId: string | null;
    label: string | null;
    email: string | null;
  };
}): {
  values: typeof feedbackPosts.$inferInsert;
  warning: string | null;
} {
  const status: ImportStatus = mapStatus(input.data.status) ?? "open";
  const category = mapCategory(input.data.category) ?? "question";
  const votes = parseVotes(input.data.votes) ?? 0;
  const created = parseCreatedAt(input.data.createdAt);
  const now = new Date();
  const createdAt = created && created.getTime() <= now.getTime() ? created : now;

  return {
    values: {
      productId: input.record.productId,
      boardId: input.boardId,
      authorCustomerId: input.author.customerId,
      authorLabel: input.author.label,
      authorEmail: input.author.email,
      title: (input.data.title ?? "").slice(0, 200),
      body: input.data.body ?? "",
      status,
      category,
      source: "import",
      importedVoteCount: votes,
      importId: input.record.id,
      importRowNumber: input.rowNumber,
      createdAt,
      updatedAt: createdAt,
    },
    warning:
      input.data.status && mapStatus(input.data.status) === null
        ? `Status "${input.data.status}" is not recognized; imported as Open.`
        : null,
  };
}

async function resolveBoardForRow(
  record: FeedbackImport,
  data: ImportRowData,
  boardMap: Map<string, string>,
  archived: Set<string>,
): Promise<{ ok: true; boardId: string } | { ok: false; error: string }> {
  return resolveBoardLabel({
    requested: cleanCell(data.board),
    fallbackBoardId: record.boardId,
    boardMap,
    archived,
  });
}

async function resolveAuthor(
  record: FeedbackImport,
  data: ImportRowData,
): Promise<{
  customerId: string | null;
  label: string | null;
  email: string | null;
}> {
  const rawEmail = cleanCell(data.authorEmail).slice(0, 254);
  const name = cleanCell(data.authorName).slice(0, 120) || null;

  if (rawEmail !== "" && isValidEmail(rawEmail)) {
    const resolved = await resolveCustomerIdentity(record.workspaceId, {
      externalId: null,
      email: rawEmail,
      name,
      avatarUrl: null,
      traits: { source: "import" },
      verifyEmail: false,
    });

    if (resolved.ok) {
      return { customerId: resolved.customer.id, label: name, email: rawEmail };
    }
    // A conflicting or banned identity is preserved as a label rather than
    // silently attaching the request to somebody else's account.
    return { customerId: null, label: name ?? rawEmail, email: null };
  }

  return {
    customerId: null,
    label: name ?? (rawEmail === "" ? "Imported request" : rawEmail),
    email: null,
  };
}

async function importOneRow(
  record: FeedbackImport,
  row: FeedbackImportRow,
  boardMap: Map<string, string>,
  archived: Set<string>,
): Promise<"imported" | "skipped" | "failed"> {
  const data = row.data as ImportRowData;
  const title = cleanCell(data.title);
  if (title.length === 0) {
    await markRow(record.id, row.id, "failed", "The row has no title.");
    return "failed";
  }

  const board = await resolveBoardForRow(record, data, boardMap, archived);
  if (!board.ok) {
    await markRow(record.id, row.id, "failed", board.error);
    return "failed";
  }

  const author = await resolveAuthor(record, data);

  const { values, warning } = importPostValues({
    record,
    data,
    rowNumber: row.rowNumber,
    boardId: board.boardId,
    author,
  });

  try {
    const inserted = await db
      .insert(feedbackPosts)
      .values(values)
      .returning({ id: feedbackPosts.id });

    const post = inserted[0];
    if (!post) throw new Error("The request could not be stored.");

    let finalWarning = warning;
    const imageUrl = cleanCell(data.imageUrl);
    if (imageUrl !== "") {
      const attached = await attachImportedCover({
        workspaceId: record.workspaceId,
        productId: record.productId,
        postId: post.id,
        customerId: author.customerId,
        url: imageUrl,
      });
      if (!attached.ok) {
        finalWarning = [finalWarning, `Cover image skipped: ${attached.error}`]
          .filter(Boolean)
          .join(" ");
      }
    }

    await markRow(record.id, row.id, "imported", finalWarning, post.id);
    return "imported";
  } catch (error) {
    if (isUniqueViolation(error)) {
      // A previous attempt inserted this row but crashed before marking it.
      const existing = await db
        .select({ id: feedbackPosts.id })
        .from(feedbackPosts)
        .where(
          and(
            eq(feedbackPosts.importId, record.id),
            eq(feedbackPosts.importRowNumber, row.rowNumber),
          ),
        )
        .limit(1);

      await markRow(record.id, row.id, "imported", warning, existing[0]?.id ?? null);
      return "imported";
    }

    const message = error instanceof Error ? error.message.slice(0, 300) : "The row failed.";
    await markRow(record.id, row.id, "failed", message);
    return "failed";
  }
}

async function markRow(
  importId: string,
  rowId: string,
  status: "imported" | "skipped" | "failed",
  error: string | null,
  postId: string | null = null,
): Promise<void> {
  await db
    .update(feedbackImportRows)
    .set({ status, error, feedbackPostId: postId, processedAt: new Date() })
    .where(and(eq(feedbackImportRows.id, rowId), eq(feedbackImportRows.importId, importId)));
}

async function rollUp(importId: string): Promise<{
  processed: number;
  imported: number;
  skipped: number;
  failed: number;
  pending: number;
}> {
  const rows = await db
    .select({ status: feedbackImportRows.status, value: count() })
    .from(feedbackImportRows)
    .where(eq(feedbackImportRows.importId, importId))
    .groupBy(feedbackImportRows.status);

  const totals = { pending: 0, imported: 0, skipped: 0, failed: 0 };
  for (const row of rows) totals[row.status] = Number(row.value);

  const attachments = await db
    .select({ value: count() })
    .from(feedbackAttachments)
    .innerJoin(feedbackPosts, eq(feedbackAttachments.feedbackPostId, feedbackPosts.id))
    .where(eq(feedbackPosts.importId, importId));

  const processed = totals.imported + totals.skipped + totals.failed;
  await db
    .update(feedbackImports)
    .set({
      processedRows: processed,
      importedRows: totals.imported,
      skippedRows: totals.skipped,
      failedRows: totals.failed,
      importedAttachments: Number(attachments[0]?.value ?? 0),
      updatedAt: new Date(),
    })
    .where(eq(feedbackImports.id, importId));

  return { ...totals, processed };
}

async function loadBoardMap(productId: string): Promise<{
  boardMap: Map<string, string>;
  archived: Set<string>;
}> {
  const rows = await db
    .select({
      id: boards.id,
      name: boards.name,
      slug: boards.slug,
      archivedAt: boards.archivedAt,
    })
    .from(boards)
    .where(eq(boards.productId, productId));

  const boardMap = new Map<string, string>();
  const archived = new Set<string>();
  for (const board of rows) {
    boardMap.set(board.name.toLowerCase(), board.id);
    boardMap.set(board.slug.toLowerCase(), board.id);
    if (board.archivedAt) archived.add(board.id);
  }
  return { boardMap, archived };
}

async function loadBoards(record: FeedbackImport): Promise<{
  boardMap: Map<string, string>;
  archived: Set<string>;
}> {
  return loadBoardMap(record.productId);
}

export type ProcessImportResult = {
  importId: string;
  status: "completed" | "partial" | "running" | "failed" | "cancelled";
  processed: number;
  imported: number;
  skipped: number;
  failed: number;
  pending: number;
};

/**
 * Process pending rows for one import.
 *
 * Called by the `process_import` job. It runs for at most ~20 seconds; if rows
 * remain it enqueues a continuation keyed on the processed count so a retry of
 * this same job cannot enqueue the same continuation twice. The optional time
 * budget lets a caller (notably a test) prove the continuation path without
 * waiting the full production budget; it is still clamped to the budget.
 */
export async function processFeedbackImport(
  importId: string,
  options: { timeBudgetMs?: number } = {},
): Promise<ProcessImportResult> {
  const timeBudgetMs = Math.min(
    Math.max(Math.trunc(options.timeBudgetMs ?? TIME_BUDGET_MS), 1),
    TIME_BUDGET_MS,
  );
  const rows = await db
    .select()
    .from(feedbackImports)
    .where(eq(feedbackImports.id, importId))
    .limit(1);

  const record = rows[0];
  if (!record) throw new NonRetryableJobError("That import no longer exists.");

  if (record.status === "completed") {
    return {
      importId,
      status: "completed",
      processed: record.processedRows,
      imported: record.importedRows,
      skipped: record.skippedRows,
      failed: record.failedRows,
      pending: 0,
    };
  }

  await db
    .update(feedbackImports)
    .set({ status: "running", lastError: null, updatedAt: new Date() })
    .where(and(eq(feedbackImports.id, importId), ne(feedbackImports.status, "cancelled")));

  const startedAt = Date.now();
  const { boardMap, archived } = await loadBoards(record);

  const cancelledOutcome = async (): Promise<ProcessImportResult> => {
    const totals = await rollUp(importId);
    return {
      importId,
      status: "cancelled",
      processed: totals.processed,
      imported: totals.imported,
      skipped: totals.skipped,
      failed: totals.failed,
      pending: totals.pending,
    };
  };

  if (record.status === "cancelled") return cancelledOutcome();

  try {
    for (;;) {
      const state = await db
        .select({ status: feedbackImports.status })
        .from(feedbackImports)
        .where(eq(feedbackImports.id, importId))
        .limit(1);
      if (state[0]?.status === "cancelled") return cancelledOutcome();

      const pending = await db
        .select()
        .from(feedbackImportRows)
        .where(
          and(
            eq(feedbackImportRows.importId, importId),
            eq(feedbackImportRows.status, "pending"),
          ),
        )
        .orderBy(asc(feedbackImportRows.rowNumber))
        .limit(BATCH_SIZE);

      if (pending.length === 0) break;

      for (let index = 0; index < pending.length; index += 1) {
        if (index > 0 && index % 20 === 0) {
          const state = await db
            .select({ status: feedbackImports.status })
            .from(feedbackImports)
            .where(eq(feedbackImports.id, importId))
            .limit(1);
          if (state[0]?.status === "cancelled") return cancelledOutcome();
          if (Date.now() - startedAt >= timeBudgetMs) break;
        }
        await importOneRow(record, pending[index]!, boardMap, archived);
      }

      const totals = await rollUp(importId);
      if (totals.pending === 0) break;
      if (Date.now() - startedAt >= timeBudgetMs) break;
    }

    const totals = await rollUp(importId);
    const finalState = await db
      .select({ status: feedbackImports.status })
      .from(feedbackImports)
      .where(eq(feedbackImports.id, importId))
      .limit(1);
    if (finalState[0]?.status === "cancelled") return cancelledOutcome();

    if (totals.pending > 0) {
      await enqueueJob({
        type: "process_import",
        payload: { importId },
        dedupeKey: `feedback-import:${importId}:${totals.processed}`,
      });

      return {
        importId,
        status: "partial",
        processed: totals.processed,
        imported: totals.imported,
        skipped: totals.skipped,
        failed: totals.failed,
        pending: totals.pending,
      };
    }

    await db
      .update(feedbackImports)
      .set({
        status: "completed",
        completedAt: new Date(),
        updatedAt: new Date(),
        lastError: null,
      })
      .where(eq(feedbackImports.id, importId));

    return {
      importId,
      status: "completed",
      processed: totals.processed,
      imported: totals.imported,
      skipped: totals.skipped,
      failed: totals.failed,
      pending: 0,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "The import failed.";
    await db
      .update(feedbackImports)
      .set({ lastError: message, updatedAt: new Date() })
      .where(eq(feedbackImports.id, importId));
    throw error;
  }
}

export type ImportListItem = {
  id: string;
  fileName: string;
  status: FeedbackImport["status"];
  source: FeedbackImport["source"];
  format: FeedbackImport["format"];
  importedAttachments: number;
  totalRows: number;
  processedRows: number;
  importedRows: number;
  skippedRows: number;
  failedRows: number;
  createdAt: string;
  completedAt: string | null;
  lastError: string | null;
};

export async function listFeedbackImports(
  productId: string,
  limit = 10,
): Promise<ImportListItem[]> {
  const rows = await db
    .select()
    .from(feedbackImports)
    .where(eq(feedbackImports.productId, productId))
    .orderBy(desc(feedbackImports.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    fileName: row.fileName,
    status: row.status,
    source: row.source,
    format: row.format,
    importedAttachments: row.importedAttachments,
    totalRows: row.totalRows,
    processedRows: row.processedRows,
    importedRows: row.importedRows,
    skippedRows: row.skippedRows,
    failedRows: row.failedRows,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    lastError: row.lastError,
  }));
}

export type ImportDetail = ImportListItem & {
  errors: { rowNumber: number; status: string; message: string }[];
};

export async function getFeedbackImport(
  productId: string,
  importId: string,
): Promise<ImportDetail | null> {
  const rows = await db
    .select()
    .from(feedbackImports)
    .where(and(eq(feedbackImports.id, importId), eq(feedbackImports.productId, productId)))
    .limit(1);

  const record = rows[0];
  if (!record) return null;

  const problems = await db
    .select({
      rowNumber: feedbackImportRows.rowNumber,
      status: feedbackImportRows.status,
      error: feedbackImportRows.error,
    })
    .from(feedbackImportRows)
    .where(
      and(
        eq(feedbackImportRows.importId, importId),
        inArray(feedbackImportRows.status, ["failed", "skipped"]),
      ),
    )
    .orderBy(asc(feedbackImportRows.rowNumber))
    .limit(25);

  return {
    id: record.id,
    fileName: record.fileName,
    status: record.status,
    source: record.source,
    format: record.format,
    importedAttachments: record.importedAttachments,
    totalRows: record.totalRows,
    processedRows: record.processedRows,
    importedRows: record.importedRows,
    skippedRows: record.skippedRows,
    failedRows: record.failedRows,
    createdAt: record.createdAt.toISOString(),
    completedAt: record.completedAt?.toISOString() ?? null,
    lastError: record.lastError,
    errors: problems.map((problem) => ({
      rowNumber: problem.rowNumber,
      status: problem.status,
      message: problem.error ?? "No details were recorded.",
    })),
  };
}

// Keep the field type referenced so a future mapping change cannot silently
// drop a field from the import vocabulary.
export type { ImportField, ImportMapping };

export type ImportAnalysisInput = Pick<
  CreateImportInput,
  "productId" | "boardId" | "headers" | "rows" | "mapping"
>;

export type ImportAnalysisResult =
  | { ok: true; plan: ImportPlan }
  | { ok: false; error: string };

/**
 * Count what an upload would do without storing it.
 *
 * This is the dry run: the same mapping, title and board checks the job uses,
 * but no import row, job or feedback post is written.
 */
export async function analyzeFeedbackImport(
  input: ImportAnalysisInput,
): Promise<ImportAnalysisResult> {
  if (input.rows.length === 0) {
    return { ok: false, error: "The file has no data rows." };
  }
  if (input.rows.length > MAX_IMPORT_ROWS) {
    return {
      ok: false,
      error: `Import at most ${MAX_IMPORT_ROWS.toLocaleString("en")} rows at a time.`,
    };
  }

  const board = await resolveTargetBoard(input.productId, input.boardId);
  if (!board) return { ok: false, error: "Choose a board in this product." };

  const { boardMap, archived } = await loadBoardMap(input.productId);
  return {
    ok: true,
    plan: planImportRows({
      headers: input.headers,
      rows: input.rows,
      mapping: input.mapping,
      fallbackBoardId: board.id,
      boardMap,
      archived,
    }),
  };
}

/** Stop a queued or running import before its next batch. */
export async function cancelFeedbackImport(
  productId: string,
  importId: string,
): Promise<boolean> {
  const cancelled = await db
    .update(feedbackImports)
    .set({
      status: "cancelled",
      cancelRequestedAt: new Date(),
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(feedbackImports.id, importId),
        eq(feedbackImports.productId, productId),
        inArray(feedbackImports.status, ["queued", "running"]),
      ),
    )
    .returning({ id: feedbackImports.id });

  return cancelled.length > 0;
}

export async function listImportPresets(
  workspaceId: string,
): Promise<ImportPresetView[]> {
  const rows = await db
    .select()
    .from(feedbackImportPresets)
    .where(eq(feedbackImportPresets.workspaceId, workspaceId))
    .orderBy(desc(feedbackImportPresets.updatedAt))
    .limit(50);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    format: row.format,
    signature: row.signature,
    mapping: row.mapping as ImportMapping,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function saveImportPreset(input: {
  workspaceId: string;
  createdBy: string;
  name: string;
  format: ImportFormat;
  headers: string[];
  mapping: ImportMapping;
}): Promise<{ ok: true; preset: ImportPresetView } | { ok: false; error: string }> {
  const name = input.name.trim().slice(0, 80);
  if (name.length < 2) return { ok: false, error: "Give the preset a name." };

  const checked = validateMapping(input.headers, input.mapping);
  if (!checked.ok) return checked;

  const signature = presetSignature(input.headers);
  const rows = await db
    .insert(feedbackImportPresets)
    .values({
      workspaceId: input.workspaceId,
      name,
      format: input.format,
      signature,
      mapping: checked.mapping as Record<string, string>,
      createdBy: input.createdBy,
    })
    .onConflictDoUpdate({
      target: [feedbackImportPresets.workspaceId, feedbackImportPresets.signature],
      set: {
        name,
        format: input.format,
        mapping: checked.mapping as Record<string, string>,
        updatedAt: new Date(),
      },
    })
    .returning();

  const row = rows[0];
  if (!row) return { ok: false, error: "The preset could not be saved." };

  return {
    ok: true,
    preset: {
      id: row.id,
      name: row.name,
      format: row.format,
      signature: row.signature,
      mapping: row.mapping as ImportMapping,
      updatedAt: row.updatedAt.toISOString(),
    },
  };
}

export async function deleteImportPreset(
  workspaceId: string,
  presetId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(feedbackImportPresets)
    .where(
      and(
        eq(feedbackImportPresets.id, presetId),
        eq(feedbackImportPresets.workspaceId, workspaceId),
      ),
    )
    .returning({ id: feedbackImportPresets.id });
  return deleted.length > 0;
}
