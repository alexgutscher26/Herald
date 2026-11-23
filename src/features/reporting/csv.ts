import { metricLabel } from "./catalogue";

/**
 * CSV export for a report.
 *
 * Values are quoted and formula-prefixed when they start with a spreadsheet
 * control character. Report names and labels can be user-supplied, so a cell
 * must never execute when opened in Excel/Sheets.
 */

export type ReportCsvRow = {
  day: string;
  metric: string;
  value: number;
};

export type ReportCsvInput = {
  reportName: string;
  datasetKey: string;
  from: string;
  to: string;
  metrics: readonly string[];
  totals: Record<string, number>;
  previousTotals: Record<string, number> | null;
  comparison: Record<string, number | null>;
  series: ReadonlyArray<{ day: string; metrics: Record<string, number> }>;
};

function safeCell(value: string | number | null): string {
  if (value === null) return "";
  const raw = String(value);
  const guarded = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  if (/[",\n\r]/.test(guarded)) return `"${guarded.replace(/"/g, '""')}"`;
  return guarded;
}

function percent(value: number | null): string {
  return value === null ? "" : `${value.toFixed(1)}%`;
}

export function buildReportCsv(input: ReportCsvInput): string {
  const lines: string[] = [];
  lines.push(
    [
      "section",
      "day",
      "metric",
      "label",
      "value",
      "previous",
      "change_pct",
    ].join(","),
  );

  lines.push(
    ["report", "", "", safeCell(input.reportName), "", "", ""].join(","),
  );
  lines.push(
    ["period", `${input.from}..${input.to}`, "", "", "", "", ""].join(","),
  );

  for (const metric of input.metrics) {
    lines.push(
      [
        "total",
        "",
        safeCell(metric),
        safeCell(metricLabel(input.datasetKey, metric)),
        safeCell(input.totals[metric] ?? 0),
        input.previousTotals ? safeCell(input.previousTotals[metric] ?? 0) : "",
        percent(input.comparison[metric] ?? null),
      ].join(","),
    );
  }

  for (const point of input.series) {
    for (const metric of input.metrics) {
      lines.push(
        [
          "daily",
          safeCell(point.day),
          safeCell(metric),
          safeCell(metricLabel(input.datasetKey, metric)),
          safeCell(point.metrics[metric] ?? 0),
          "",
          "",
        ].join(","),
      );
    }
  }

  return `${lines.join("\n")}\n`;
}
