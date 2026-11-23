import "server-only";

import { and, desc, eq, ne, or, isNotNull } from "drizzle-orm";

import { db } from "@/db";
import { products, workspaces } from "@/db/schema/workspaces";
import {
  reportRuns,
  savedReports,
  type ReportAlertConfig,
  type SavedReport,
} from "@/db/schema/reporting";
import { sendEmail } from "@/features/email/provider";
import {
  datasetLabel,
  evaluateAlert,
  metricLabel,
  validateAlert,
  validateMetricSelection,
  type ReportFormat,
  type ReportSchedule,
} from "@/features/reporting/catalogue";
import { buildReportCsv } from "@/features/reporting/csv";
import { buildReportPdf } from "@/features/reporting/pdf";
import {
  isAlertCheckDue,
  isReportDue,
  reportPeriods,
} from "@/features/reporting/periods";
import { runReportQuery, type ReportQueryResult } from "@/features/reporting/query";

/**
 * Saved report service.
 *
 * Authorization happens in the action/route layer. This module still scopes
 * every mutation by workspace *and* product, and validates the catalogue before
 * writing, so a saved report can never store an unknown metric.
 */

export type SavedReportView = {
  id: string;
  name: string;
  description: string | null;
  dataset: string;
  metrics: string[];
  days: number;
  comparePrevious: boolean;
  schedule: ReportSchedule;
  format: ReportFormat;
  recipients: string[];
  alert: ReportAlertConfig | null;
  alertActive: boolean;
  showOnDashboard: boolean;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SaveReportInput = {
  workspaceId: string;
  productId: string;
  name: string;
  description?: string | null | undefined;
  dataset: string;
  metrics: string[];
  days: number;
  comparePrevious: boolean;
  schedule: ReportSchedule;
  format: ReportFormat;
  recipients: string[];
  alert: ReportAlertConfig | null;
  showOnDashboard: boolean;
  createdBy: string;
};

function serializeReport(row: SavedReport): SavedReportView {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    dataset: row.dataset,
    metrics: [...row.metrics],
    days: row.days,
    comparePrevious: row.comparePrevious,
    schedule: row.schedule,
    format: row.format,
    recipients: [...row.recipients],
    alert: row.alert,
    alertActive: row.alertActive,
    showOnDashboard: row.showOnDashboard,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function validateInput(input: SaveReportInput): { metrics: string[]; alert: ReportAlertConfig | null } {
  const { metrics } = validateMetricSelection(input.dataset, input.metrics);
  const alert = validateAlert(input.dataset, input.alert);
  if (input.schedule !== "none" && input.recipients.length === 0) {
    throw new Error("Add at least one recipient before scheduling an export.");
  }
  return { metrics: metrics.map((metric) => metric.key), alert };
}

export async function listSavedReports(
  workspaceId: string,
  productId: string,
): Promise<SavedReportView[]> {
  const rows = await db
    .select()
    .from(savedReports)
    .where(
      and(
        eq(savedReports.workspaceId, workspaceId),
        eq(savedReports.productId, productId),
      ),
    )
    .orderBy(desc(savedReports.updatedAt));

  return rows.map(serializeReport);
}

export async function getSavedReport(input: {
  workspaceId: string;
  productId: string;
  reportId: string;
}): Promise<SavedReportView | null> {
  const rows = await db
    .select()
    .from(savedReports)
    .where(
      and(
        eq(savedReports.id, input.reportId),
        eq(savedReports.workspaceId, input.workspaceId),
        eq(savedReports.productId, input.productId),
      ),
    )
    .limit(1);

  return rows[0] ? serializeReport(rows[0]) : null;
}

async function getReportRow(input: {
  workspaceId: string;
  productId: string;
  reportId: string;
}): Promise<SavedReport | null> {
  const rows = await db
    .select()
    .from(savedReports)
    .where(
      and(
        eq(savedReports.id, input.reportId),
        eq(savedReports.workspaceId, input.workspaceId),
        eq(savedReports.productId, input.productId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function createSavedReport(
  input: SaveReportInput,
): Promise<{ ok: true; report: SavedReportView } | { ok: false; error: string }> {
  try {
    const validated = validateInput(input);
    const rows = await db
      .insert(savedReports)
      .values({
        workspaceId: input.workspaceId,
        productId: input.productId,
        name: input.name,
        description: input.description?.trim() || null,
        dataset: input.dataset,
        metrics: validated.metrics,
        days: input.days,
        comparePrevious: input.comparePrevious,
        schedule: input.schedule,
        format: input.format,
        recipients: [...new Set(input.recipients.map((email) => email.trim().toLowerCase()))],
        alert: validated.alert,
        showOnDashboard: input.showOnDashboard,
        createdBy: input.createdBy,
      })
      .returning();
    const row = rows[0];
    if (!row) return { ok: false, error: "Could not save the report." };
    return { ok: true, report: serializeReport(row) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not save the report.",
    };
  }
}

export async function updateSavedReport(
  input: SaveReportInput & { reportId: string },
): Promise<{ ok: true; report: SavedReportView } | { ok: false; error: string }> {
  try {
    const validated = validateInput(input);
    const rows = await db
      .update(savedReports)
      .set({
        name: input.name,
        description: input.description?.trim() || null,
        dataset: input.dataset,
        metrics: validated.metrics,
        days: input.days,
        comparePrevious: input.comparePrevious,
        schedule: input.schedule,
        format: input.format,
        recipients: [...new Set(input.recipients.map((email) => email.trim().toLowerCase()))],
        alert: validated.alert,
        showOnDashboard: input.showOnDashboard,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(savedReports.id, input.reportId),
          eq(savedReports.workspaceId, input.workspaceId),
          eq(savedReports.productId, input.productId),
        ),
      )
      .returning();

    const row = rows[0];
    if (!row) return { ok: false, error: "Report not found." };
    return { ok: true, report: serializeReport(row) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not update the report.",
    };
  }
}

export async function deleteSavedReport(input: {
  workspaceId: string;
  productId: string;
  reportId: string;
}): Promise<boolean> {
  const rows = await db
    .delete(savedReports)
    .where(
      and(
        eq(savedReports.id, input.reportId),
        eq(savedReports.workspaceId, input.workspaceId),
        eq(savedReports.productId, input.productId),
      ),
    )
    .returning({ id: savedReports.id });
  return Boolean(rows[0]);
}

export type RunSavedReportResult =
  | {
      ok: true;
      report: SavedReportView;
      result: ReportQueryResult;
      runId: string;
      alertTriggered: boolean;
      alertTransitioned: boolean;
    }
  | { ok: false; error: string };

async function runRow(
  report: SavedReport,
  now: Date,
): Promise<RunSavedReportResult> {
  try {
    const result = await runReportQuery({
      workspaceId: report.workspaceId,
      productId: report.productId,
      dataset: report.dataset,
      metrics: report.metrics,
      days: report.days,
      compare: report.comparePrevious,
      now,
    });
    const alertTriggered = evaluateAlert(report.alert, result.totals);
    const alertTransitioned = alertTriggered && !report.alertActive;

    const rows = await db
      .insert(reportRuns)
      .values({
        reportId: report.id,
        workspaceId: report.workspaceId,
        productId: report.productId,
        status: "succeeded",
        fromDay: result.from,
        toDay: result.to,
        result: result as unknown as Record<string, unknown>,
        alertTriggered,
      })
      .returning({ id: reportRuns.id });

    const updated = await db
      .update(savedReports)
      .set({
        lastRunAt: now,
        alertActive: alertTriggered,
        updatedAt: now,
      })
      .where(eq(savedReports.id, report.id))
      .returning();

    return {
      ok: true,
      report: serializeReport(updated[0] ?? report),
      result,
      runId: rows[0]?.id ?? "",
      alertTriggered,
      alertTransitioned,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "The report failed.";
    const periods = reportPeriods(report.days, now, false);
    await db
      .insert(reportRuns)
      .values({
        reportId: report.id,
        workspaceId: report.workspaceId,
        productId: report.productId,
        status: "failed",
        fromDay: periods.current.from,
        toDay: periods.current.to,
        error: message,
      })
      .catch(() => undefined);
    await db
      .update(savedReports)
      .set({ lastRunAt: now, updatedAt: now })
      .where(eq(savedReports.id, report.id))
      .catch(() => undefined);

    return { ok: false, error: message };
  }
}

/** Run one saved report and record the result. Never emails; the caller does. */
export async function runSavedReport(input: {
  workspaceId: string;
  productId: string;
  reportId: string;
  now?: Date;
}): Promise<RunSavedReportResult> {
  const report = await getReportRow(input);
  if (!report) return { ok: false, error: "Report not found." };
  return runRow(report, input.now ?? new Date());
}

export type DashboardReport = {
  report: SavedReportView;
  result: ReportQueryResult | null;
  error: string | null;
};

/** Live results for the dashboard cards. Limited so the page stays bounded. */
export async function getReportDashboard(input: {
  workspaceId: string;
  productId: string;
  now?: Date;
}): Promise<DashboardReport[]> {
  const rows = await db
    .select()
    .from(savedReports)
    .where(
      and(
        eq(savedReports.workspaceId, input.workspaceId),
        eq(savedReports.productId, input.productId),
        eq(savedReports.showOnDashboard, true),
      ),
    )
    .orderBy(desc(savedReports.updatedAt))
    .limit(4);

  const cards: DashboardReport[] = [];
  for (const row of rows) {
    try {
      const result = await runReportQuery({
        workspaceId: row.workspaceId,
        productId: row.productId,
        dataset: row.dataset,
        metrics: row.metrics,
        days: row.days,
        compare: row.comparePrevious,
        now: input.now,
      });
      cards.push({ report: serializeReport(row), result, error: null });
    } catch (error) {
      cards.push({
        report: serializeReport(row),
        result: null,
        error: error instanceof Error ? error.message : "The report could not be built.",
      });
    }
  }
  return cards;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function reportAttachment(
  report: EmailReport,
  result: ReportQueryResult,
): { filename: string; content: string } {
  const safeName = report.name.replace(/[^a-zA-Z0-9-_]+/g, "-").slice(0, 60) || "report";
  if (report.format === "pdf") {
    const pdf = buildReportPdf({
      reportName: report.name,
      datasetLabel: datasetLabel(report.dataset),
      datasetKey: report.dataset,
      from: result.from,
      to: result.to,
      metrics: result.metrics,
      totals: result.totals,
      previousTotals: result.previous?.totals ?? null,
      comparison: result.comparison,
      series: result.series,
    });
    return {
      filename: `${safeName}-${result.from}-${result.to}.pdf`,
      content: Buffer.from(pdf).toString("base64"),
    };
  }

  const csv = buildReportCsv({
    reportName: report.name,
    datasetKey: report.dataset,
    from: result.from,
    to: result.to,
    metrics: result.metrics,
    totals: result.totals,
    previousTotals: result.previous?.totals ?? null,
    comparison: result.comparison,
    series: result.series,
  });
  return {
    filename: `${safeName}-${result.from}-${result.to}.csv`,
    content: Buffer.from(csv, "utf8").toString("base64"),
  };
}

type EmailReport = Pick<
  SavedReport,
  "id" | "name" | "dataset" | "format" | "recipients" | "productId" | "workspaceId"
>;

async function sendReportEmail(input: {
  report: EmailReport;
  result: ReportQueryResult;
  runId: string;
  kind: "report" | "alert";
}): Promise<{ sent: boolean; error: string | null }> {
  const recipients = input.report.recipients.filter((email) => email.includes("@"));
  if (recipients.length === 0) return { sent: false, error: "No recipients." };

  const context = await db
    .select({
      productName: products.name,
      workspaceName: workspaces.name,
    })
    .from(products)
    .innerJoin(workspaces, eq(products.workspaceId, workspaces.id))
    .where(and(eq(products.id, input.report.productId), eq(workspaces.id, input.report.workspaceId)))
    .limit(1);
  const productName = context[0]?.productName ?? "Herald";
  const rows = input.result.metrics
    .map((metric) => {
      const total = input.result.totals[metric] ?? 0;
      const change = input.result.comparison[metric];
      return `<tr><td style="padding:4px 8px;border-bottom:1px solid #ddd">${escapeHtml(
        metricLabel(input.report.dataset, metric),
      )}</td><td style="padding:4px 8px;border-bottom:1px solid #ddd;text-align:right">${total}</td><td style="padding:4px 8px;border-bottom:1px solid #ddd;text-align:right">${
        change === null || change === undefined ? "—" : `${change.toFixed(1)}%`
      }</td></tr>`;
    })
    .join("");

  const subject =
    input.kind === "alert"
      ? `Alert: ${input.report.name} crossed its threshold`
      : `${input.report.name}: ${input.result.from} to ${input.result.to}`;
  const attachment = reportAttachment(input.report, input.result);
  const html = `<div style="font-family:system-ui,sans-serif;color:#222">
    <p style="font-size:12px;color:#666;margin:0 0 4px">${escapeHtml(productName)} · ${
      input.kind === "alert" ? "Threshold alert" : "Scheduled report"
    }</p>
    <h1 style="font-size:20px;margin:0 0 8px">${escapeHtml(input.report.name)}</h1>
    <p style="font-size:13px;color:#555;margin:0 0 12px">${input.result.from} to ${input.result.to} · ${datasetLabel(
      input.report.dataset,
    )}</p>
    <table style="border-collapse:collapse;font-size:13px"><thead><tr><th style="text-align:left;padding:4px 8px">Metric</th><th style="text-align:right;padding:4px 8px">Total</th><th style="text-align:right;padding:4px 8px">vs previous</th></tr></thead><tbody>${rows}</tbody></table>
    <p style="font-size:11px;color:#777;margin-top:14px">The ${input.report.format.toUpperCase()} export is attached.</p>
  </div>`;
  const text = `${input.report.name}\n${input.result.from} to ${input.result.to}\n\n${input.result.metrics
    .map(
      (metric) =>
        `${metricLabel(input.report.dataset, metric)}: ${input.result.totals[metric] ?? 0}`,
    )
    .join("\n")}`;

  let lastError: string | null = null;
  let allSent = true;
  for (const recipient of recipients) {
    const sent = await sendEmail({
      to: recipient,
      subject,
      html,
      text,
      attachments: [{ filename: attachment.filename, content: attachment.content }],
      idempotencyKey: `report-${input.runId}-${input.kind}-${recipient}`,
    });
    if (!sent.ok) {
      allSent = false;
      lastError = sent.error;
    }
  }

  return allSent ? { sent: true, error: null } : { sent: false, error: lastError };
}

export type ScheduledReportSummary = {
  checked: number;
  ran: number;
  emailed: number;
  alerts: number;
  failed: number;
};

/** Cron entry point: run every due report, email recipients and fire alerts. */
export async function runDueSavedReports(
  now = new Date(),
): Promise<ScheduledReportSummary> {
  const scheduled = await db
    .select()
    .from(savedReports)
    .where(or(ne(savedReports.schedule, "none"), isNotNull(savedReports.alert)));

  const summary: ScheduledReportSummary = {
    checked: 0,
    ran: 0,
    emailed: 0,
    alerts: 0,
    failed: 0,
  };

  for (const report of scheduled) {
    // A scheduled report follows its calendar; an alert-only report is checked
    // once a day so a dashboard report can still fire a threshold email.
    const due =
      report.schedule !== "none"
        ? isReportDue(report.schedule, report.lastRunAt, now)
        : isAlertCheckDue(report.lastRunAt, now);
    if (!due) continue;

    summary.checked += 1;
    const outcome = await runRow(report, now);
    if (!outcome.ok) {
      summary.failed += 1;
      continue;
    }
    summary.ran += 1;
    if (outcome.alertTriggered) summary.alerts += 1;

    if (report.recipients.length === 0) continue;
    const email = await sendReportEmail({
      report,
      result: outcome.result,
      runId: outcome.runId,
      kind: outcome.alertTransitioned ? "alert" : "report",
    });
    if (email.sent) {
      summary.emailed += 1;
      await db
        .update(reportRuns)
        .set({ emailedTo: outcome.report.recipients })
        .where(eq(reportRuns.id, outcome.runId))
        .catch(() => undefined);
    } else if (outcome.runId) {
      await db
        .update(reportRuns)
        .set({ error: email.error })
        .where(eq(reportRuns.id, outcome.runId))
        .catch(() => undefined);
      summary.failed += 1;
    }
  }

  return summary;
}
