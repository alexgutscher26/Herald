import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { analyticsDaily } from "@/db/schema/analytics";
import { feedbackPosts } from "@/db/schema/feedback";
import { junoConversations } from "@/db/schema/knowledge";
import {
  ANALYTICS_METRICS,
  recalculateAnalyticsWindow,
  type AnalyticsMetric,
} from "@/features/analytics/rollup";
import { runReportQuery } from "@/features/reporting/query";

/**
 * Analytics overview, read through the reporting layer.
 *
 * The daily numbers come from `runReportQuery`, so the page, saved reports and
 * exports share one definition of every product metric. The few support and
 * CSAT figures that are not daily counters are assembled here, behind the same
 * module, so the page itself has no bespoke aggregation SQL.
 */

export type { AnalyticsMetric } from "@/features/analytics/rollup";

export type AnalyticsSeriesPoint = {
  day: string;
  metrics: Record<AnalyticsMetric, number>;
};

export type AnalyticsFunnel = {
  status: string;
  count: number;
};

export type AnalyticsOverview = {
  days: number;
  from: string;
  to: string;
  totals: Record<AnalyticsMetric, number>;
  /** Previous-window totals for the same metrics; null when unavailable. */
  previousTotals: Record<AnalyticsMetric, number> | null;
  /** Percent change per metric, null when the previous window had no value. */
  comparison: Record<AnalyticsMetric, number | null>;
  series: AnalyticsSeriesPoint[];
  funnel: AnalyticsFunnel[];
  averageFirstResponseMinutes: number | null;
  averageTimeToShipMinutes: number | null;
  junoResolved: number;
  junoInvolved: number;
  emailDeliveryRate: number | null;
  csatRequested: number;
  csatResponses: number;
  csatAverage: number | null;
  csatByOperator: Array<{
    operatorId: string | null;
    name: string;
    requested: number;
    responses: number;
    average: number | null;
  }>;
};

function numeric(value: number | string | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function emptyMetrics(): Record<AnalyticsMetric, number> {
  return Object.fromEntries(
    ANALYTICS_METRICS.map((metric) => [metric, 0]),
  ) as Record<AnalyticsMetric, number>;
}

/**
 * One saved report may only name eight metrics, but the overview shows every
 * product-activity metric. Read the catalogue in capped batches so the page
 * keeps using the same validated query path as reports and exports.
 */
const REPORT_METRIC_LIMIT = 8;

function metricChunks(): AnalyticsMetric[][] {
  const chunks: AnalyticsMetric[][] = [];
  for (let index = 0; index < ANALYTICS_METRICS.length; index += REPORT_METRIC_LIMIT) {
    chunks.push(ANALYTICS_METRICS.slice(index, index + REPORT_METRIC_LIMIT));
  }
  return chunks;
}

export async function getAnalyticsOverview(input: {
  workspaceId: string;
  productId: string;
  days?: number;
  now?: Date;
}): Promise<AnalyticsOverview> {
  const days = Math.min(Math.max(Math.trunc(input.days ?? 30), 1), 90);
  const now = input.now ?? new Date();
  const today = now.toISOString().slice(0, 10);

  const existing = await db
    .select({ id: analyticsDaily.id })
    .from(analyticsDaily)
    .where(
      and(
        eq(analyticsDaily.productId, input.productId),
        eq(analyticsDaily.day, today),
      ),
    )
    .limit(1);
  if (!existing[0]) {
    await recalculateAnalyticsWindow({
      workspaceId: input.workspaceId,
      productId: input.productId,
      days,
      now,
    });
  }

  const reports = await Promise.all(
    metricChunks().map((metrics) =>
      runReportQuery({
        workspaceId: input.workspaceId,
        productId: input.productId,
        dataset: "product_activity",
        metrics,
        days,
        compare: true,
        now,
      }),
    ),
  );
  const [firstReport] = reports;
  if (!firstReport) throw new Error("No analytics metrics are configured.");

  const totals = emptyMetrics();
  const previousTotals = emptyMetrics();
  const comparison = Object.fromEntries(
    ANALYTICS_METRICS.map((metric) => [metric, null]),
  ) as Record<AnalyticsMetric, number | null>;
  const metricsByDay = new Map<string, Record<AnalyticsMetric, number>>();
  for (const report of reports) {
    const reportMetrics = report.metrics as AnalyticsMetric[];
    for (const metric of reportMetrics) {
      totals[metric] = report.totals[metric] ?? 0;
      previousTotals[metric] = report.previous?.totals[metric] ?? 0;
      comparison[metric] = report.comparison[metric] ?? null;
    }
    for (const point of report.series) {
      let dayMetrics = metricsByDay.get(point.day);
      if (!dayMetrics) {
        dayMetrics = emptyMetrics();
        metricsByDay.set(point.day, dayMetrics);
      }
      for (const metric of reportMetrics) {
        dayMetrics[metric] = point.metrics[metric] ?? 0;
      }
    }
  }
  const series: AnalyticsSeriesPoint[] = [...metricsByDay.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([day, metrics]) => ({ day, metrics }));

  const [funnelRows, responseRows, junoRows, csatRows, csatOperatorRows] = await Promise.all([
    db
      .select({ status: feedbackPosts.status, count: sql<number>`count(*)::int` })
      .from(feedbackPosts)
      .where(eq(feedbackPosts.productId, input.productId))
      .groupBy(feedbackPosts.status),
    db.execute(sql`
      WITH customer_first AS (
        SELECT "conversation_id", min("created_at") AS first_at
        FROM "conversation_messages"
        WHERE "product_id" = ${input.productId}
          AND "author_type" = 'customer'
          AND "kind" = 'message'
        GROUP BY "conversation_id"
      ),
      team_first AS (
        SELECT "conversation_id", min("created_at") AS first_at
        FROM "conversation_messages"
        WHERE "product_id" = ${input.productId}
          AND "author_type" = 'team'
          AND "kind" = 'message'
        GROUP BY "conversation_id"
      )
      SELECT avg(extract(epoch from (t."first_at" - c."first_at")) / 60)::float AS minutes
      FROM "conversations" conv
      INNER JOIN customer_first c ON c."conversation_id" = conv."id"
      INNER JOIN team_first t ON t."conversation_id" = conv."id"
      WHERE conv."product_id" = ${input.productId}
        AND conv."created_at" >= ${firstReport.from}
        AND conv."created_at" < ${today}::date + 1
        AND t."first_at" >= c."first_at"
    `),
    db
      .select({ state: junoConversations.state, count: sql<number>`count(*)::int` })
      .from(junoConversations)
      .where(eq(junoConversations.productId, input.productId))
      .groupBy(junoConversations.state),
    db.execute(sql`
      SELECT
        count(*) FILTER (WHERE "csat_requested_at" IS NOT NULL)::int AS requested,
        count(*) FILTER (WHERE "csat_rating" IS NOT NULL)::int AS responses,
        avg("csat_rating")::float AS average
      FROM "conversations"
      WHERE "product_id" = ${input.productId}
        AND "resolved_at" >= ${firstReport.from}
        AND "resolved_at" < ${today}::date + 1
    `),
    db.execute(sql`
      SELECT
        c."assignee_id" AS operator_id,
        coalesce(u."name", 'Unassigned') AS operator_name,
        count(*) FILTER (WHERE c."csat_requested_at" IS NOT NULL)::int AS requested,
        count(*) FILTER (WHERE c."csat_rating" IS NOT NULL)::int AS responses,
        avg(c."csat_rating")::float AS average
      FROM "conversations" c
      LEFT JOIN "user" u ON u."id" = c."assignee_id"
      WHERE c."product_id" = ${input.productId}
        AND c."resolved_at" >= ${firstReport.from}
        AND c."resolved_at" < ${today}::date + 1
      GROUP BY c."assignee_id", u."name"
      ORDER BY average DESC NULLS LAST, operator_name ASC
    `),
  ]);

  const response = (responseRows.rows[0] as { minutes: number | string | null } | undefined)
    ?.minutes;
  const junoResolved = junoRows
    .filter((row) => row.state === "resolved")
    .reduce((sum, row) => sum + numeric(row.count), 0);
  const junoInvolved = junoRows.reduce((sum, row) => sum + numeric(row.count), 0);
  const emailAttempts = totals.emails_sent + totals.emails_failed;
  const csat = csatRows.rows[0] as
    | {
        requested: number | string | null;
        responses: number | string | null;
        average: number | string | null;
      }
    | undefined;
  const csatAverage = csat?.average;
  const csatByOperator = (
    csatOperatorRows.rows as Array<{
      operator_id: string | null;
      operator_name: string;
      requested: number | string | null;
      responses: number | string | null;
      average: number | string | null;
    }>
  ).map((row) => ({
    operatorId: row.operator_id,
    name: row.operator_name,
    requested: numeric(row.requested),
    responses: numeric(row.responses),
    average:
      row.average === null || row.average === undefined
        ? null
        : numeric(row.average),
  }));

  return {
    days,
    from: firstReport.from,
    to: firstReport.to,
    totals,
    previousTotals: firstReport.previous ? previousTotals : null,
    comparison,
    series,
    funnel: funnelRows.map((row) => ({ status: row.status, count: numeric(row.count) })),
    averageFirstResponseMinutes:
      response === null || response === undefined ? null : Math.round(numeric(response)),
    averageTimeToShipMinutes:
      totals.time_to_ship_count > 0
        ? Math.round(totals.time_to_ship_minutes / totals.time_to_ship_count)
        : null,
    junoResolved,
    junoInvolved,
    emailDeliveryRate: emailAttempts > 0 ? totals.emails_sent / emailAttempts : null,
    csatRequested: numeric(csat?.requested),
    csatResponses: numeric(csat?.responses),
    csatAverage:
      csatAverage === null || csatAverage === undefined ? null : numeric(csatAverage),
    csatByOperator,
  };
}
