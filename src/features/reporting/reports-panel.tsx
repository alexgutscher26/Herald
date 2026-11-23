import { BarChart3, Download, FileText } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumber } from "@/lib/format";
import { REPORT_DATASETS, datasetLabel, metricLabel } from "./catalogue";
import type { DashboardReport, SavedReportView } from "./service";
import { ReportBuilder } from "./report-builder";
import { ReportCardActions } from "./report-card-actions";

/**
 * Saved dashboards and the builder.
 *
 * The cards are rendered from a live query through the reporting layer, so the
 * number on the dashboard and the CSV/PDF export are calculated by the same
 * module.
 */

function changeLabel(change: number | null): string {
  if (change === null) return "no baseline";
  const prefix = change > 0 ? "+" : "";
  return `${prefix}${change.toFixed(1)}% vs previous`;
}

function ScheduleLabel({ report }: { report: SavedReportView }) {
  if (report.schedule === "none") return <span>Manual</span>;
  return <span className="capitalize">{report.schedule}</span>;
}

export function ReportsPanel({
  workspaceSlug,
  productSlug,
  reports,
  cards,
  canManage,
}: {
  workspaceSlug: string;
  productSlug: string;
  reports: SavedReportView[];
  cards: DashboardReport[];
  canManage: boolean;
}) {
  const exportBase = `/api/app/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(
    productSlug,
  )}/reports`;

  return (
    <section aria-labelledby="saved-reports-heading" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="saved-reports-heading" className="text-base font-semibold tracking-tight">
            Saved reports
          </h2>
          <p className="text-xs text-muted-foreground">
            One catalogue, one query module: the cards, scheduled exports and alerts all use
            the same definitions.
          </p>
        </div>
      </div>

      {cards.length === 0 ? (
        <Card>
          <CardContent className="flex items-start gap-3 p-5 text-sm text-muted-foreground">
            <BarChart3 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>
              No saved reports yet. Build one below to pin metrics to this page, schedule a
              CSV/PDF export or set a threshold alert.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {cards.map(({ report, result, error }) => (
            <Card key={report.id}>
              <CardHeader className="space-y-1 pb-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-sm">{report.name}</CardTitle>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {datasetLabel(report.dataset)} · last {report.days} days ·{" "}
                      <ScheduleLabel report={report} />
                      {report.alertActive ? (
                        <span className="ml-1 font-medium text-warning">· alert active</span>
                      ) : null}
                    </p>
                  </div>
                  <ReportCardActions
                    workspaceSlug={workspaceSlug}
                    productSlug={productSlug}
                    reportId={report.id}
                    canManage={canManage}
                  />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {error || !result ? (
                  <p role="alert" className="text-xs text-destructive">
                    {error ?? "This report could not be built."}
                  </p>
                ) : (
                  <>
                    <ul className="space-y-1.5">
                      {result.metrics.map((metric) => (
                        <li
                          key={metric}
                          className="flex items-baseline justify-between gap-3 border-b pb-1.5 text-sm last:border-0"
                        >
                          <span className="min-w-0 truncate text-muted-foreground">
                            {metricLabel(result.dataset, metric)}
                          </span>
                          <span className="flex shrink-0 items-baseline gap-2">
                            <span className="font-medium tabular-nums">
                              {formatNumber(result.totals[metric] ?? 0)}
                            </span>
                            <span className="w-40 text-right text-[10px] text-muted-foreground">
                              {changeLabel(result.comparison[metric] ?? null)}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <a
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                        href={`${exportBase}/${report.id}/export?format=csv`}
                      >
                        <Download className="size-3" aria-hidden="true" />
                        CSV
                      </a>
                      <a
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                        href={`${exportBase}/${report.id}/export?format=pdf`}
                      >
                        <FileText className="size-3" aria-hidden="true" />
                        PDF
                      </a>
                      <span className="text-muted-foreground">
                        {result.from} to {result.to}
                      </span>
                    </div>
                    {report.alert ? (
                      <p className="text-[11px] text-muted-foreground">
                        Alert: {metricLabel(report.dataset, report.alert.metric)}{" "}
                        {report.alert.operator} {formatNumber(report.alert.value)}.
                      </p>
                    ) : null}
                  </>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {reports.length > cards.length ? (
        <p className="text-xs text-muted-foreground">
          {reports.length - cards.length} more saved report
          {reports.length - cards.length === 1 ? "" : "s"} are available through exports but
          hidden from the dashboard.
        </p>
      ) : null}

      {canManage ? (
        <ReportBuilder
          workspaceSlug={workspaceSlug}
          productSlug={productSlug}
          datasets={REPORT_DATASETS}
        />
      ) : (
        <p className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          Admins and owners can add, schedule and delete reports. You can still run and export
          the saved reports above.
        </p>
      )}
    </section>
  );
}
