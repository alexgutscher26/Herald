import { describe, expect, test } from "bun:test";

import {
  defaultMetricsFor,
  evaluateAlert,
  REPORT_DATASETS,
  ReportValidationError,
  validateAlert,
  validateMetricSelection,
} from "@/features/reporting/catalogue";
import { buildReportCsv } from "@/features/reporting/csv";
import { buildReportPdf } from "@/features/reporting/pdf";
import {
  clampReportDays,
  comparisonPercent,
  daysBetween,
  isAlertCheckDue,
  isReportDue,
  reportPeriods,
} from "@/features/reporting/periods";

const NOW = new Date("2026-11-07T12:00:00.000Z");

describe("report catalogue", () => {
  test("datasets and metric keys are unique", () => {
    const datasets = new Set<string>();
    const metrics = new Set<string>();
    for (const dataset of REPORT_DATASETS) {
      expect(datasets.has(dataset.key)).toBe(false);
      datasets.add(dataset.key);
      expect(dataset.metrics.length).toBeGreaterThanOrEqual(2);
      for (const metric of dataset.metrics) {
        expect(metrics.has(`${dataset.key}:${metric.key}`)).toBe(false);
        metrics.add(`${dataset.key}:${metric.key}`);
      }
    }
    expect(datasets.size).toBe(5);
  });

  test("a selection is validated against its own dataset", () => {
    const result = validateMetricSelection("product_activity", [
      "board_views",
      "submissions",
      "board_views",
    ]);
    expect(result.metrics.map((metric) => metric.key)).toEqual([
      "board_views",
      "submissions",
    ]);
    expect(defaultMetricsFor("feedback").length).toBe(3);
  });

  test("unknown datasets, cross-dataset metrics and empty selections are rejected", () => {
    expect(() => validateMetricSelection("nope", ["board_views"])).toThrow(
      ReportValidationError,
    );
    expect(() => validateMetricSelection("feedback", ["board_views"])).toThrow(
      ReportValidationError,
    );
    expect(() => validateMetricSelection("feedback", [])).toThrow(ReportValidationError);
    expect(() =>
      validateMetricSelection(
        "product_activity",
        REPORT_DATASETS[0]!.metrics.map((metric) => metric.key).slice(0, 9),
      ),
    ).toThrow(ReportValidationError);
  });

  test("alerts stay inside the report dataset and compare correctly", () => {
    const alert = validateAlert("product_activity", {
      metric: "submissions",
      operator: "above",
      value: 10.9,
    });
    expect(alert?.value).toBe(10);
    expect(evaluateAlert(alert, { submissions: 11 })).toBe(true);
    expect(evaluateAlert(alert, { submissions: 10 })).toBe(false);
    expect(
      evaluateAlert(
        { metric: "submissions", operator: "below", value: 5 },
        { submissions: 4 },
      ),
    ).toBe(true);
    expect(() =>
      validateAlert("feedback", { metric: "board_views", operator: "above", value: 1 }),
    ).toThrow(ReportValidationError);
  });
});

describe("report periods", () => {
  test("current and previous windows have the same length", () => {
    const { current, previous } = reportPeriods(7, NOW);
    expect(current).toEqual({
      from: "2026-11-01",
      to: "2026-11-07",
      endExclusive: new Date("2026-11-08T00:00:00.000Z"),
    });
    expect(previous?.from).toBe("2026-10-25");
    expect(previous?.to).toBe("2026-10-31");
    expect(previous?.endExclusive).toEqual(new Date("2026-11-01T00:00:00.000Z"));
    expect(reportPeriods(7, NOW, false).previous).toBeNull();
  });

  test("day ranges are inclusive, bounded and clamp bad input", () => {
    expect(daysBetween("2026-11-01", "2026-11-03")).toEqual([
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
    ]);
    expect(clampReportDays(0)).toBe(1);
    expect(clampReportDays(10_000)).toBe(365);
    expect(clampReportDays("nope")).toBe(30);
  });

  test("comparison percentages handle a zero baseline and schedules are due", () => {
    expect(comparisonPercent(15, 10)).toBe(50);
    expect(comparisonPercent(10, 0)).toBeNull();
    expect(isReportDue("daily", null, NOW)).toBe(true);
    expect(isReportDue("none", null, NOW)).toBe(false);
    expect(isReportDue("daily", new Date("2026-11-06T18:00:00.000Z"), NOW)).toBe(false);
    expect(isReportDue("daily", new Date("2026-11-06T10:00:00.000Z"), NOW)).toBe(true);
    expect(isAlertCheckDue(null, NOW)).toBe(true);
  });
});

describe("report exports", () => {
  const input = {
    reportName: "=HYPERLINK(\"https://evil.test\")",
    datasetKey: "product_activity",
    from: "2026-11-01",
    to: "2026-11-02",
    metrics: ["board_views", "submissions"],
    totals: { board_views: 20, submissions: 5 },
    previousTotals: { board_views: 10, submissions: 10 },
    comparison: { board_views: 100, submissions: -50 },
    series: [
      { day: "2026-11-01", metrics: { board_views: 12, submissions: 2 } },
      { day: "2026-11-02", metrics: { board_views: 8, submissions: 3 } },
    ],
  };

  test("CSV neutralises formula cells and includes totals plus daily rows", () => {
    const csv = buildReportCsv(input);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("total,,board_views,Board views,20");
    expect(csv).toContain("daily,2026-11-01");
    expect(csv).toContain("100.0%");
    expect(csv.split("\n").filter(Boolean).length).toBeGreaterThan(6);
  });

  test("PDF is a valid document with the report and metric text", () => {
    const pdf = buildReportPdf({ ...input, datasetLabel: "Product activity" });
    const text = new TextDecoder().decode(pdf);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("/Type /Catalog");
    expect(text).toContain("Board views");
    expect(text).toContain("%%EOF");
    expect(text).toContain("startxref");
  });
});
