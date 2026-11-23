"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { authorizeProductAction } from "@/features/live/action-auth";
import type { ActionResult } from "@/features/live/action-result";
import type { ReportAlertConfig } from "@/db/schema/reporting";
import {
  createSavedReport,
  deleteSavedReport,
  runSavedReport,
  updateSavedReport,
  type SavedReportView,
} from "@/features/reporting/service";

/**
 * Report builder actions.
 *
 * Reads use `analytics:read`; changes use `settings:manage`, matching the rest
 * of the workspace configuration. Every call resolves the product through the
 * authorized context before touching a report row.
 */

function analyticsPath(workspaceSlug: string, productSlug: string): string {
  return `/app/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(
    productSlug,
  )}/analytics`;
}

const reportSchema = z.object({
  workspaceSlug: z.string().min(1),
  productSlug: z.string().min(1),
  name: z.string().trim().min(2, "Name the report.").max(120),
  description: z.string().trim().max(500).nullable().optional(),
  dataset: z.string().min(1),
  metrics: z.array(z.string().min(1)).min(1, "Choose at least one metric.").max(8),
  days: z.number().int().min(1).max(365),
  comparePrevious: z.boolean(),
  schedule: z.enum(["none", "daily", "weekly", "monthly"]),
  format: z.enum(["csv", "pdf"]),
  recipients: z.array(z.email("Enter a valid recipient address.")).max(10),
  alert: z
    .object({
      metric: z.string().min(1),
      operator: z.enum(["above", "below"]),
      value: z.number().finite(),
    })
    .nullable(),
  showOnDashboard: z.boolean(),
});

export async function createReportAction(input: {
  workspaceSlug: string;
  productSlug: string;
  name: string;
  description?: string | null;
  dataset: string;
  metrics: string[];
  days: number;
  comparePrevious: boolean;
  schedule: "none" | "daily" | "weekly" | "monthly";
  format: "csv" | "pdf";
  recipients: string[];
  alert: ReportAlertConfig | null;
  showOnDashboard: boolean;
}): Promise<ActionResult<{ report: SavedReportView }>> {
  const parsed = reportSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the report." };
  }

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "settings:manage",
  );
  if ("error" in authorized) return authorized.error;

  const result = await createSavedReport({
    ...parsed.data,
    workspaceId: authorized.context.workspace.id,
    productId: authorized.context.product.id,
    createdBy: authorized.context.user.id,
  });
  if (!result.ok) return result;

  revalidatePath(analyticsPath(parsed.data.workspaceSlug, parsed.data.productSlug));
  return { ok: true, data: { report: result.report } };
}

export async function updateReportAction(input: {
  workspaceSlug: string;
  productSlug: string;
  reportId: string;
  name: string;
  description?: string | null;
  dataset: string;
  metrics: string[];
  days: number;
  comparePrevious: boolean;
  schedule: "none" | "daily" | "weekly" | "monthly";
  format: "csv" | "pdf";
  recipients: string[];
  alert: ReportAlertConfig | null;
  showOnDashboard: boolean;
}): Promise<ActionResult<{ report: SavedReportView }>> {
  const parsed = reportSchema
    .extend({ reportId: z.uuid() })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the report." };
  }

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "settings:manage",
  );
  if ("error" in authorized) return authorized.error;

  const result = await updateSavedReport({
    ...parsed.data,
    workspaceId: authorized.context.workspace.id,
    productId: authorized.context.product.id,
    createdBy: authorized.context.user.id,
  });
  if (!result.ok) return result;

  revalidatePath(analyticsPath(parsed.data.workspaceSlug, parsed.data.productSlug));
  return { ok: true, data: { report: result.report } };
}

export async function deleteReportAction(input: {
  workspaceSlug: string;
  productSlug: string;
  reportId: string;
}): Promise<ActionResult<{ deleted: true }>> {
  const parsed = z
    .object({
      workspaceSlug: z.string().min(1),
      productSlug: z.string().min(1),
      reportId: z.uuid(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the report." };

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "settings:manage",
  );
  if ("error" in authorized) return authorized.error;

  const deleted = await deleteSavedReport({
    workspaceId: authorized.context.workspace.id,
    productId: authorized.context.product.id,
    reportId: parsed.data.reportId,
  });
  if (!deleted) return { ok: false, error: "Report not found." };

  revalidatePath(analyticsPath(parsed.data.workspaceSlug, parsed.data.productSlug));
  return { ok: true, data: { deleted: true } };
}

export async function runReportAction(input: {
  workspaceSlug: string;
  productSlug: string;
  reportId: string;
}): Promise<ActionResult<{ ran: true; alertTriggered: boolean }>> {
  const parsed = z
    .object({
      workspaceSlug: z.string().min(1),
      productSlug: z.string().min(1),
      reportId: z.uuid(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the report." };

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "analytics:read",
  );
  if ("error" in authorized) return authorized.error;

  const result = await runSavedReport({
    workspaceId: authorized.context.workspace.id,
    productId: authorized.context.product.id,
    reportId: parsed.data.reportId,
  });
  if (!result.ok) return result;

  revalidatePath(analyticsPath(parsed.data.workspaceSlug, parsed.data.productSlug));
  return {
    ok: true,
    data: { ran: true, alertTriggered: result.alertTriggered },
  };
}
