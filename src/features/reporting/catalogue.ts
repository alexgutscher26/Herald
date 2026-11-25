import { ANALYTICS_METRICS } from "@/features/analytics/rollup";

/**
 * Report catalogue.
 *
 * Pure data plus pure validation. The query module may only build SQL for a
 * metric that appears here; a saved report stores keys, never SQL. This is what
 * makes the report builder safe against a tampered request.
 */

export type ReportMetricUnit = "count" | "minutes";

export type ReportMetricDefinition = {
  key: string;
  label: string;
  description: string;
  unit: ReportMetricUnit;
};

export type ReportDatasetDefinition = {
  key: string;
  label: string;
  description: string;
  metrics: readonly ReportMetricDefinition[];
};

function metric(
  key: string,
  label: string,
  description: string,
  unit: ReportMetricUnit = "count",
): ReportMetricDefinition {
  return { key, label, description, unit };
}

const PRODUCT_ACTIVITY_METRICS: readonly ReportMetricDefinition[] = [
  metric("board_views", "Board views", "Public board views, de-duplicated per visitor and day"),
  metric("request_views", "Request views", "Public request page views"),
  metric("portal_page_views", "Portal page views", "Public roadmap and changelog page views"),
  metric("submit_started", "Submit form opens", "Visitors who opened the submission form"),
  metric("submissions", "Submissions", "New feedback requests created"),
  metric("votes", "Votes", "Votes cast on requests"),
  metric("widget_opens", "Widget opens", "Times the embedded widget was opened"),
  metric("widget_installs", "Widget installs", "Widget installations recorded"),
  metric("conversations_started", "Conversations started", "New support threads"),
  metric("conversations_resolved", "Conversations resolved", "Threads resolved in the period"),
  metric("juno_resolved", "Mira resolved", "Mira conversations resolved without handoff"),
  metric("emails_sent", "Emails sent", "Notification emails delivered"),
  metric("emails_failed", "Emails failed", "Notification emails that failed"),
  metric("feedback_shipped", "Shipped events", "Requests moved to Shipped"),
  metric(
    "time_to_ship_minutes",
    "Time to ship (minutes)",
    "Minutes between request creation and first ship",
    "minutes",
  ),
  metric(
    "time_to_ship_count",
    "Requests shipped",
    "Requests included in the time-to-ship total",
  ),
];

const FEEDBACK_METRICS: readonly ReportMetricDefinition[] = [
  metric("requests_created", "Requests created", "Feedback requests created in the period"),
  metric(
    "requests_shipped",
    "Requests shipped",
    "Requests whose status moved to Shipped in the period",
  ),
  metric("votes_cast", "Votes cast", "Votes added to requests"),
  metric("comments_added", "Public comments", "Non-internal comments added to requests"),
];

const SUPPORT_METRICS: readonly ReportMetricDefinition[] = [
  metric("conversations_started", "Conversations started", "New support threads"),
  metric("conversations_resolved", "Conversations resolved", "Threads resolved in the period"),
  metric("csat_responses", "CSAT responses", "Ratings submitted after resolution"),
];

const AUDIENCE_METRICS: readonly ReportMetricDefinition[] = [
  metric("subscribers_added", "Subscribers added", "New product-update subscribers"),
  metric(
    "subscribers_unsubscribed",
    "Unsubscribes",
    "Subscribers who opted out of product updates",
  ),
];

const ENGAGEMENT_METRICS: readonly ReportMetricDefinition[] = [
  metric(
    "survey_responses",
    "Survey responses",
    "Distinct recipients who responded to each survey in the period",
  ),
  metric(
    "tour_completions",
    "Tour completions",
    "Distinct recipients who reached the final step of each tour in the period",
  ),
];

export const REPORT_DATASETS: readonly ReportDatasetDefinition[] = [
  {
    key: "product_activity",
    label: "Product activity",
    description:
      "The daily analytics rollups: public views, submissions, votes, widget, email and support activity.",
    metrics: PRODUCT_ACTIVITY_METRICS,
  },
  {
    key: "feedback",
    label: "Feedback",
    description: "Requests, shipping events, votes and public comments from the feedback tables.",
    metrics: FEEDBACK_METRICS,
  },
  {
    key: "support",
    label: "Support",
    description: "Conversation volume, resolutions and CSAT responses.",
    metrics: SUPPORT_METRICS,
  },
  {
    key: "audience",
    label: "Audience",
    description: "Product-update subscriber growth and unsubscribes.",
    metrics: AUDIENCE_METRICS,
  },
  {
    key: "engagement",
    label: "Engagement",
    description:
      "Survey responses and tour completions, counted once per recipient per survey or tour.",
    metrics: ENGAGEMENT_METRICS,
  },
];

export type ReportDatasetKey = (typeof REPORT_DATASETS)[number]["key"];

export const REPORT_DATASET_KEYS = REPORT_DATASETS.map(
  (dataset) => dataset.key,
) as readonly string[];

export const REPORT_METRIC_KEYS = new Set(
  REPORT_DATASETS.flatMap((dataset) => dataset.metrics.map((item) => item.key)),
);

export const REPORT_SCHEDULES = ["none", "daily", "weekly", "monthly"] as const;
export type ReportSchedule = (typeof REPORT_SCHEDULES)[number];

export const REPORT_FORMATS = ["csv", "pdf"] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

export type ReportAlert = {
  metric: string;
  operator: "above" | "below";
  value: number;
};

export class ReportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportValidationError";
  }
}

export function isReportSchedule(value: unknown): value is ReportSchedule {
  return typeof value === "string" && (REPORT_SCHEDULES as readonly string[]).includes(value);
}

export function isReportFormat(value: unknown): value is ReportFormat {
  return typeof value === "string" && (REPORT_FORMATS as readonly string[]).includes(value);
}

export function findDataset(key: string): ReportDatasetDefinition | null {
  return REPORT_DATASETS.find((dataset) => dataset.key === key) ?? null;
}

export function findMetric(
  datasetKey: string,
  metricKey: string,
): ReportMetricDefinition | null {
  const dataset = findDataset(datasetKey);
  return dataset?.metrics.find((item) => item.key === metricKey) ?? null;
}

export function datasetLabel(key: string): string {
  return findDataset(key)?.label ?? key;
}

export function metricLabel(datasetKey: string, metricKey: string): string {
  return findMetric(datasetKey, metricKey)?.label ?? metricKey;
}

/**
 * Validate a dataset/metric selection. Unknown keys are rejected rather than
 * ignored: silently dropping one would make a saved report render fewer
 * numbers than the person saved.
 */
export function validateMetricSelection(
  datasetKey: string,
  metricKeys: readonly string[],
): { dataset: ReportDatasetDefinition; metrics: ReportMetricDefinition[] } {
  const dataset = findDataset(datasetKey);
  if (!dataset) throw new ReportValidationError("Choose a known dataset.");

  const unique = [...new Set(metricKeys)];
  if (unique.length === 0) throw new ReportValidationError("Choose at least one metric.");
  if (unique.length > 8) {
    throw new ReportValidationError("Choose at most eight metrics for one report.");
  }

  const metrics: ReportMetricDefinition[] = [];
  for (const key of unique) {
    const definition = dataset.metrics.find((item) => item.key === key);
    if (!definition) {
      throw new ReportValidationError(
        `"${key}" is not a metric in the ${dataset.label} dataset.`,
      );
    }
    metrics.push(definition);
  }

  return { dataset, metrics };
}

export function defaultMetricsFor(datasetKey: string): string[] {
  return findDataset(datasetKey)?.metrics.slice(0, 3).map((item) => item.key) ?? [];
}

/** Alert metrics must belong to the report's own dataset. */
export function validateAlert(
  datasetKey: string,
  alert: ReportAlert | null | undefined,
): ReportAlert | null {
  if (!alert) return null;
  const metric = findMetric(datasetKey, alert.metric);
  if (!metric) {
    throw new ReportValidationError("The alert metric must be part of the report.");
  }
  if (alert.operator !== "above" && alert.operator !== "below") {
    throw new ReportValidationError("Choose above or below for the alert.");
  }
  if (!Number.isFinite(alert.value)) {
    throw new ReportValidationError("The alert threshold must be a number.");
  }
  return {
    metric: alert.metric,
    operator: alert.operator,
    value: Math.trunc(alert.value),
  };
}

export function evaluateAlert(
  alert: ReportAlert | null,
  totals: Record<string, number>,
): boolean {
  if (!alert) return false;
  const value = totals[alert.metric] ?? 0;
  return alert.operator === "above" ? value > alert.value : value < alert.value;
}
