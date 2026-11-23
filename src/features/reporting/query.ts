import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { analyticsDaily } from "@/db/schema/analytics";
import {
  validateMetricSelection,
  type ReportDatasetKey,
} from "@/features/reporting/catalogue";
import {
  clampReportDays,
  comparisonPercent,
  daysBetween,
  reportPeriods,
  type ReportPeriod,
} from "@/features/reporting/periods";

/**
 * Safe report query module.
 *
 * Two rules make this safe:
 *   1. every metric is resolved through the catalogue before any SQL is built;
 *   2. every value is bound as a parameter. Metric keys become SQL only after
 *      the catalogue lookup, and aliases are fixed selectors.
 *
 * The module is the only place a dashboard, export or alert reads report data,
 * which is what keeps the numbers consistent across all three.
 */

export type ReportSeriesPoint = {
  day: string;
  metrics: Record<string, number>;
};

export type ReportQueryResult = {
  dataset: string;
  metrics: string[];
  days: number;
  from: string;
  to: string;
  series: ReportSeriesPoint[];
  totals: Record<string, number>;
  previous: {
    from: string;
    to: string;
    totals: Record<string, number>;
  } | null;
  comparison: Record<string, number | null>;
};

export type ReportQueryInput = {
  workspaceId: string;
  productId: string;
  dataset: string;
  metrics: readonly string[];
  days?: number | undefined;
  compare?: boolean | undefined;
  now?: Date | undefined;
};

type MetricRow = { day: string; metric: string; value: number | string };

function numeric(value: number | string | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function queryProductActivity(
  input: ReportQueryInput,
  metrics: readonly string[],
  period: ReportPeriod,
): Promise<MetricRow[]> {
  const rows = await db
    .select({
      day: analyticsDaily.day,
      metric: analyticsDaily.metric,
      value: analyticsDaily.value,
    })
    .from(analyticsDaily)
    .where(
      and(
        eq(analyticsDaily.workspaceId, input.workspaceId),
        eq(analyticsDaily.productId, input.productId),
        inArray(analyticsDaily.metric, metrics),
        sql`${analyticsDaily.day} >= ${period.from}`,
        sql`${analyticsDaily.day} < ${period.endExclusive.toISOString().slice(0, 10)}`,
      ),
    );

  return rows.map((row) => ({ day: row.day, metric: row.metric, value: row.value }));
}

/**
 * Feedback metrics have different source tables and date columns, so each one
 * contributes a fixed, parameterized SELECT to a UNION ALL. The switch is the
 * allowlist: there is no branch that accepts an arbitrary expression.
 */
async function queryFeedback(
  input: ReportQueryInput,
  metrics: readonly string[],
  period: ReportPeriod,
): Promise<MetricRow[]> {
  const parts = metrics.map((metric) => {
    switch (metric) {
      case "requests_created":
        return sql`
          SELECT to_char("created_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
                 'requests_created' AS metric, count(*)::int AS value
          FROM "feedback_posts"
          WHERE "product_id" = ${input.productId}
            AND "created_at" >= ${period.from}
            AND "created_at" < ${period.endExclusive}
          GROUP BY 1
        `;
      case "requests_shipped":
        return sql`
          SELECT to_char("changed_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
                 'requests_shipped' AS metric, count(*)::int AS value
          FROM "feedback_status_history"
          WHERE "product_id" = ${input.productId}
            AND "to_status" = 'shipped'
            AND "changed_at" >= ${period.from}
            AND "changed_at" < ${period.endExclusive}
          GROUP BY 1
        `;
      case "votes_cast":
        return sql`
          SELECT to_char(v."created_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
                 'votes_cast' AS metric, count(*)::int AS value
          FROM "feedback_votes" v
          INNER JOIN "feedback_posts" p ON p."id" = v."feedback_post_id"
          WHERE p."product_id" = ${input.productId}
            AND v."created_at" >= ${period.from}
            AND v."created_at" < ${period.endExclusive}
          GROUP BY 1
        `;
      case "comments_added":
        return sql`
          SELECT to_char("created_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
                 'comments_added' AS metric, count(*)::int AS value
          FROM "feedback_comments"
          WHERE "product_id" = ${input.productId}
            AND "internal" = false
            AND "created_at" >= ${period.from}
            AND "created_at" < ${period.endExclusive}
          GROUP BY 1
        `;
      default:
        throw new Error(`Unhandled feedback metric: ${metric}`);
    }
  });

  const result = await db.execute(sql.join(parts, sql` UNION ALL `));
  return result.rows as MetricRow[];
}

async function querySupport(
  input: ReportQueryInput,
  metrics: readonly string[],
  period: ReportPeriod,
): Promise<MetricRow[]> {
  const parts = metrics.map((metric) => {
    switch (metric) {
      case "conversations_started":
        return sql`
          SELECT to_char("created_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
                 'conversations_started' AS metric, count(*)::int AS value
          FROM "conversations"
          WHERE "product_id" = ${input.productId}
            AND "created_at" >= ${period.from}
            AND "created_at" < ${period.endExclusive}
          GROUP BY 1
        `;
      case "conversations_resolved":
        return sql`
          SELECT to_char("resolved_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
                 'conversations_resolved' AS metric, count(*)::int AS value
          FROM "conversations"
          WHERE "product_id" = ${input.productId}
            AND "resolved_at" IS NOT NULL
            AND "resolved_at" >= ${period.from}
            AND "resolved_at" < ${period.endExclusive}
          GROUP BY 1
        `;
      case "csat_responses":
        return sql`
          SELECT to_char("csat_rated_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
                 'csat_responses' AS metric, count(*)::int AS value
          FROM "conversations"
          WHERE "product_id" = ${input.productId}
            AND "csat_rating" IS NOT NULL
            AND "csat_rated_at" >= ${period.from}
            AND "csat_rated_at" < ${period.endExclusive}
          GROUP BY 1
        `;
      default:
        throw new Error(`Unhandled support metric: ${metric}`);
    }
  });

  const result = await db.execute(sql.join(parts, sql` UNION ALL `));
  return result.rows as MetricRow[];
}

async function queryAudience(
  input: ReportQueryInput,
  metrics: readonly string[],
  period: ReportPeriod,
): Promise<MetricRow[]> {
  const parts = metrics.map((metric) => {
    switch (metric) {
      case "subscribers_added":
        return sql`
          SELECT to_char("created_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
                 'subscribers_added' AS metric, count(*)::int AS value
          FROM "subscribers"
          WHERE "product_id" = ${input.productId}
            AND "created_at" >= ${period.from}
            AND "created_at" < ${period.endExclusive}
          GROUP BY 1
        `;
      case "subscribers_unsubscribed":
        return sql`
          SELECT to_char("unsubscribed_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
                 'subscribers_unsubscribed' AS metric, count(*)::int AS value
          FROM "subscribers"
          WHERE "product_id" = ${input.productId}
            AND "unsubscribed_at" IS NOT NULL
            AND "unsubscribed_at" >= ${period.from}
            AND "unsubscribed_at" < ${period.endExclusive}
          GROUP BY 1
        `;
      default:
        throw new Error(`Unhandled audience metric: ${metric}`);
    }
  });

  const result = await db.execute(sql.join(parts, sql` UNION ALL `));
  return result.rows as MetricRow[];
}

/**
 * Engagement metrics count people, not rows.
 *
 * `DISTINCT ON` keeps each recipient's first event in the period, so a repeat
 * response or a second Done click cannot add a second number. The recipient
 * key includes the survey or tour id: one person answering two different
 * surveys is two survey responses, but answering the same survey twice is one.
 */
async function queryEngagement(
  input: ReportQueryInput,
  metrics: readonly string[],
  period: ReportPeriod,
): Promise<MetricRow[]> {
  const parts = metrics.map((metric) => {
    switch (metric) {
      case "survey_responses":
        return sql`
          SELECT day, 'survey_responses' AS metric, count(*)::int AS value
          FROM (
            SELECT DISTINCT ON (recipient_key)
                   to_char("created_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day
            FROM (
              SELECT "survey_id"::text || ':' ||
                     coalesce("customer_id"::text, 'visitor:' || "visitor_key") AS recipient_key,
                     "created_at"
              FROM "survey_responses"
              WHERE "product_id" = ${input.productId}
                AND "created_at" >= ${period.from}
                AND "created_at" < ${period.endExclusive}
            ) responses
            ORDER BY recipient_key, "created_at"
          ) first_seen
          GROUP BY 1
        `;
      case "tour_completions":
        return sql`
          SELECT day, 'tour_completions' AS metric, count(*)::int AS value
          FROM (
            SELECT DISTINCT ON (recipient_key)
                   to_char("completed_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day
            FROM (
              SELECT "experience_id"::text || ':' ||
                     coalesce("customer_id"::text, 'visitor:' || "visitor_key") AS recipient_key,
                     "completed_at"
              FROM "widget_experience_completions"
              WHERE "product_id" = ${input.productId}
                AND "completed_at" >= ${period.from}
                AND "completed_at" < ${period.endExclusive}
            ) completions
            ORDER BY recipient_key, "completed_at"
          ) first_seen
          GROUP BY 1
        `;
      default:
        throw new Error(`Unhandled engagement metric: ${metric}`);
    }
  });

  const result = await db.execute(sql.join(parts, sql` UNION ALL `));
  return result.rows as MetricRow[];
}

async function queryPeriod(
  input: ReportQueryInput,
  metricKeys: readonly string[],
  period: ReportPeriod,
): Promise<{ totals: Record<string, number>; series: ReportSeriesPoint[] }> {
  let rows: MetricRow[] = [];
  switch (input.dataset as ReportDatasetKey) {
    case "product_activity":
      rows = await queryProductActivity(input, metricKeys, period);
      break;
    case "feedback":
      rows = await queryFeedback(input, metricKeys, period);
      break;
    case "support":
      rows = await querySupport(input, metricKeys, period);
      break;
    case "audience":
      rows = await queryAudience(input, metricKeys, period);
      break;
    case "engagement":
      rows = await queryEngagement(input, metricKeys, period);
      break;
    default:
      throw new Error("Unknown report dataset.");
  }

  const totals: Record<string, number> = Object.fromEntries(
    metricKeys.map((key) => [key, 0]),
  );
  const byDay = new Map<string, Record<string, number>>();
  for (const day of daysBetween(period.from, period.to)) {
    byDay.set(day, Object.fromEntries(metricKeys.map((key) => [key, 0])));
  }

  for (const row of rows) {
    const value = numeric(row.value);
    const total = totals[row.metric];
    if (total === undefined) continue;
    totals[row.metric] = total + value;
    const day = byDay.get(row.day);
    const dayValue = day?.[row.metric];
    if (day && dayValue !== undefined) day[row.metric] = dayValue + value;
  }

  const series = [...byDay.entries()].map(([day, metrics]) => ({ day, metrics }));
  return { totals, series };
}

/**
 * Run a catalogue-backed report. Throws `ReportValidationError` for an unknown
 * dataset or metric before any database work.
 */
export async function runReportQuery(input: ReportQueryInput): Promise<ReportQueryResult> {
  const { dataset } = validateMetricSelection(input.dataset, input.metrics);
  const metricKeys = [...new Set(input.metrics)];
  const days = clampReportDays(input.days);
  const compare = input.compare !== false;
  const periods = reportPeriods(days, input.now ?? new Date(), compare);

  const current = await queryPeriod(input, metricKeys, periods.current);
  const previous = periods.previous
    ? await queryPeriod(input, metricKeys, periods.previous)
    : null;

  const comparison: Record<string, number | null> = {};
  for (const metric of metricKeys) {
    comparison[metric] = previous
      ? comparisonPercent(current.totals[metric] ?? 0, previous.totals[metric] ?? 0)
      : null;
  }

  return {
    dataset: dataset.key,
    metrics: metricKeys,
    days,
    from: periods.current.from,
    to: periods.current.to,
    series: current.series,
    totals: current.totals,
    previous: previous
      ? {
          from: periods.previous!.from,
          to: periods.previous!.to,
          totals: previous.totals,
        }
      : null,
    comparison,
  };
}
