import { NextResponse } from "next/server";

import { authorizeAppApi } from "@/features/app-api/auth";
import { datasetLabel } from "@/features/reporting/catalogue";
import { buildReportCsv } from "@/features/reporting/csv";
import { buildReportPdf } from "@/features/reporting/pdf";
import { runReportQuery } from "@/features/reporting/query";
import { getSavedReport } from "@/features/reporting/service";

/**
 * Report export.
 *
 * GET only, scoped to the authorized workspace/product, and it re-runs the
 * report through the query module. A saved report id from another tenant can
 * never resolve.
 */

export const dynamic = "force-dynamic";

function filename(name: string, from: string, to: string, extension: string): string {
  const safe = name.replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/^-+|-+$/g, "") || "report";
  return `${safe.slice(0, 60)}-${from}-${to}.${extension}`;
}

export async function GET(
  request: Request,
  context: {
    params: Promise<{ workspaceSlug: string; productSlug: string; reportId: string }>;
  },
): Promise<Response> {
  const { workspaceSlug, productSlug, reportId } = await context.params;

  const authorized = await authorizeAppApi({
    request,
    workspaceSlug,
    productSlug,
    permission: "analytics:read",
  });
  if (!authorized.ok) return authorized.response;

  const report = await getSavedReport({
    workspaceId: authorized.context.workspace.id,
    productId: authorized.context.product.id,
    reportId,
  });
  if (!report) {
    return NextResponse.json({ error: "Report not found." }, { status: 404 });
  }

  let result;
  try {
    result = await runReportQuery({
      workspaceId: authorized.context.workspace.id,
      productId: authorized.context.product.id,
      dataset: report.dataset,
      metrics: report.metrics,
      days: report.days,
      compare: report.comparePrevious,
    });
  } catch {
    return NextResponse.json(
      { error: "The saved report is not valid. Edit it and try again." },
      { status: 422 },
    );
  }

  const format = new URL(request.url).searchParams.get("format") === "pdf" ? "pdf" : "csv";

  if (format === "pdf") {
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
    return new Response(new Blob([pdf as unknown as BlobPart], { type: "application/pdf" }), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${filename(
          report.name,
          result.from,
          result.to,
          "pdf",
        )}"`,
        "cache-control": "private, no-store",
      },
    });
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
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename(
        report.name,
        result.from,
        result.to,
        "csv",
      )}"`,
      "cache-control": "private, no-store",
    },
  });
}
