import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  ANALYTICS_EVENT_TYPES,
  analyticsDaily,
  type AnalyticsEventType,
} from "@/db/schema/analytics";
import {
  feedbackPosts,
  products,
} from "@/db/schema";
import { junoConversations } from "@/db/schema/knowledge";

/**
 * Daily analytics rollups.
 *
 * Raw events are useful for a short window; the dashboard reads one row per
 * product/metric/day. The job recomputes a trailing window because events can
 * arrive late and a UTC day boundary is not the operator's local midnight.
 */

export const ANALYTICS_METRICS = [
  "board_views",
  "request_views",
  "submit_started",
  "submissions",
  "votes",
  "widget_opens",
  "widget_installs",
  "portal_page_views",
  "conversations_started",
  "conversations_resolved",
  "juno_resolved",
  "emails_sent",
  "emails_failed",
  "feedback_shipped",
  "time_to_ship_minutes",
  "time_to_ship_count",
] as const;

export type AnalyticsMetric = (typeof ANALYTICS_METRICS)[number];

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
  series: AnalyticsSeriesPoint[];
  funnel: AnalyticsFunnel[];
  averageFirstResponseMinutes: number | null;
  averageTimeToShipMinutes: number | null;
  junoResolved: number;
  junoInvolved: number;
  emailDeliveryRate: number | null;
  /** CSAT over threads resolved inside the window. */
  csatRequested: number;
  csatResponses: number;
  csatAverage: number | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function emptyMetrics(): Record<AnalyticsMetric, number> {
  return Object.fromEntries(
    ANALYTICS_METRICS.map((metric) => [metric, 0]),
  ) as Record<AnalyticsMetric, number>;
}

function eventMetric(type: AnalyticsEventType): AnalyticsMetric {
  switch (type) {
    case "board_view":
      return "board_views";
    case "request_view":
      return "request_views";
    case "submit_started":
      return "submit_started";
    case "submission":
      return "submissions";
    case "vote":
      return "votes";
    case "widget_open":
      return "widget_opens";
    case "widget_install":
      return "widget_installs";
    case "portal_page_view":
      return "portal_page_views";
  }
}

type CountRow = { day: string; value: number | string };
type TypeCountRow = CountRow & { type: string };

function numeric(value: number | string | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Recompute `days` ending at today's UTC date. It is safe to call repeatedly;
 * each metric is an upsert keyed by product/day/metric.
 */
export async function recalculateAnalyticsWindow(input: {
  workspaceId: string;
  productId: string;
  days?: number | undefined;
  now?: Date | undefined;
}): Promise<void> {
  const days = Math.min(Math.max(Math.trunc(input.days ?? 2), 1), 90);
  const endDay = startOfUtcDay(input.now ?? new Date());
  const start = addDays(endDay, -(days - 1));
  const endExclusive = addDays(endDay, 1);

  const productRows = await db
    .select({ id: products.id, workspaceId: products.workspaceId })
    .from(products)
    .where(
      and(
        eq(products.id, input.productId),
        eq(products.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);
  if (!productRows[0]) return;

  const values = new Map<string, Record<AnalyticsMetric, number>>();
  for (let offset = 0; offset < days; offset += 1) {
    values.set(dayKey(addDays(start, offset)), emptyMetrics());
  }

  function add(day: string, metric: AnalyticsMetric, amount: number): void {
    const point = values.get(day);
    if (point) point[metric] += amount;
  }

  // Submissions and votes are public-funnel actions, so the event stream is
  // authoritative. The feedback and vote rows are not added on top: a public
  // submission writes both, and counting both would double every action.
  const eventRows = await db.execute(sql`
    SELECT to_char("occurred_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, "type", count(*)::int AS value
    FROM "analytics_events"
    WHERE "product_id" = ${input.productId}
      AND "occurred_at" >= ${start}
      AND "occurred_at" < ${endExclusive}
    GROUP BY 1, 2
  `);

  for (const row of eventRows.rows as TypeCountRow[]) {
    if ((ANALYTICS_EVENT_TYPES as readonly string[]).includes(row.type)) {
      add(row.day, eventMetric(row.type as AnalyticsEventType), numeric(row.value));
    }
  }
  const [conversationRows, junoRows, deliveryRows, historyRows, shipRows] =
    await Promise.all([
      db.execute(sql`
        SELECT to_char("created_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, count(*)::int AS value
        FROM "conversations"
        WHERE "product_id" = ${input.productId}
          AND "created_at" >= ${start}
          AND "created_at" < ${endExclusive}
        GROUP BY 1
      `),
      db.execute(sql`
        SELECT to_char("resolved_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, count(*)::int AS value
        FROM "juno_conversations"
        WHERE "product_id" = ${input.productId}
          AND "resolved_at" >= ${start}
          AND "resolved_at" < ${endExclusive}
        GROUP BY 1
      `),
      db.execute(sql`
        SELECT to_char(coalesce("sent_at", "updated_at") AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, "status" AS type, count(*)::int AS value
        FROM "notification_deliveries"
        WHERE "product_id" = ${input.productId}
          AND coalesce("sent_at", "updated_at") >= ${start}
          AND coalesce("sent_at", "updated_at") < ${endExclusive}
          AND "status" IN ('sent', 'failed')
        GROUP BY 1, 2
      `),
      db.execute(sql`
        SELECT to_char("changed_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, "to_status" AS type, count(*)::int AS value
        FROM "feedback_status_history"
        WHERE "product_id" = ${input.productId}
          AND "changed_at" >= ${start}
          AND "changed_at" < ${endExclusive}
        GROUP BY 1, 2
      `),
      db.execute(sql`
        WITH first_ship AS (
          SELECT DISTINCT ON (h."feedback_post_id") h."feedback_post_id", h."changed_at"
          FROM "feedback_status_history" h
          WHERE h."product_id" = ${input.productId}
            AND h."to_status" = 'shipped'
          ORDER BY h."feedback_post_id", h."changed_at"
        )
        SELECT to_char(s."changed_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
               count(*)::int AS count,
               coalesce(sum(extract(epoch from (s."changed_at" - p."created_at")) / 60), 0)::int AS minutes
        FROM first_ship s
        INNER JOIN "feedback_posts" p ON p."id" = s."feedback_post_id"
        WHERE s."changed_at" >= ${start}
          AND s."changed_at" < ${endExclusive}
        GROUP BY 1
      `),
    ]);

  for (const row of conversationRows.rows as CountRow[]) {
    add(row.day, "conversations_started", numeric(row.value));
  }
  for (const row of junoRows.rows as CountRow[]) {
    add(row.day, "juno_resolved", numeric(row.value));
  }
  for (const row of deliveryRows.rows as TypeCountRow[]) {
    if (row.type === "sent") add(row.day, "emails_sent", numeric(row.value));
    if (row.type === "failed") add(row.day, "emails_failed", numeric(row.value));
  }
  for (const row of historyRows.rows as TypeCountRow[]) {
    if (row.type === "shipped") add(row.day, "feedback_shipped", numeric(row.value));
  }
  for (const row of shipRows.rows as Array<CountRow & { count: number | string; minutes: number | string }>) {
    add(row.day, "time_to_ship_count", numeric(row.count));
    add(row.day, "time_to_ship_minutes", numeric(row.minutes));
  }

  // Conversation resolutions are a state, not a creation date; read them
  // separately so a thread resolved today is counted today.
  const resolvedRows = await db.execute(sql`
    SELECT to_char("resolved_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, count(*)::int AS value
    FROM "conversations"
    WHERE "product_id" = ${input.productId}
      AND "resolved_at" >= ${start}
      AND "resolved_at" < ${endExclusive}
    GROUP BY 1
  `);
  for (const row of resolvedRows.rows as CountRow[]) {
    add(row.day, "conversations_resolved", numeric(row.value));
  }

  const rows = [...values.entries()].flatMap(([day, metrics]) =>
    ANALYTICS_METRICS.map((metric) => ({
      workspaceId: input.workspaceId,
      productId: input.productId,
      day,
      metric,
      value: metrics[metric],
      updatedAt: new Date(),
    })),
  );
  if (rows.length === 0) return;

  await db
    .insert(analyticsDaily)
    .values(rows)
    .onConflictDoUpdate({
      target: [analyticsDaily.productId, analyticsDaily.day, analyticsDaily.metric],
      set: {
        value: sql`excluded.value`,
        updatedAt: new Date(),
      },
    });
}

export async function recalculateAnalyticsForAllProducts(input?: {
  days?: number | undefined;
  now?: Date | undefined;
}): Promise<{ products: number }> {
  const productRows = await db.select({ id: products.id, workspaceId: products.workspaceId }).from(products);
  for (const product of productRows) {
    await recalculateAnalyticsWindow({
      workspaceId: product.workspaceId,
      productId: product.id,
      days: input?.days,
      now: input?.now,
    });
  }
  return { products: productRows.length };
}

export async function getAnalyticsOverview(input: {
  workspaceId: string;
  productId: string;
  days?: number | undefined;
  now?: Date | undefined;
}): Promise<AnalyticsOverview> {
  const days = Math.min(Math.max(Math.trunc(input.days ?? 30), 1), 90);
  const endDay = startOfUtcDay(input.now ?? new Date());
  const start = addDays(endDay, -(days - 1));
  const endExclusive = addDays(endDay, 1);

  const existing = await db
    .select({ id: analyticsDaily.id })
    .from(analyticsDaily)
    .where(
      and(
        eq(analyticsDaily.productId, input.productId),
        eq(analyticsDaily.day, dayKey(endDay)),
      ),
    )
    .limit(1);
  if (!existing[0]) {
    await recalculateAnalyticsWindow({
      ...input,
      days,
      now: input.now,
    });
  }

  const [dailyRows, funnelRows, responseRows, junoRows, csatRows] = await Promise.all([
    db
      .select({
        day: analyticsDaily.day,
        metric: analyticsDaily.metric,
        value: analyticsDaily.value,
      })
      .from(analyticsDaily)
      .where(
        and(
          eq(analyticsDaily.productId, input.productId),
          sql`${analyticsDaily.day} >= ${dayKey(start)}`,
          sql`${analyticsDaily.day} <= ${dayKey(endDay)}`,
        ),
      ),
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
        AND conv."created_at" >= ${start}
        AND conv."created_at" < ${endExclusive}
        AND t."first_at" >= c."first_at"
    `),
    db
      .select({
        state: junoConversations.state,
        count: sql<number>`count(*)::int`,
      })
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
        AND "resolved_at" >= ${start}
        AND "resolved_at" < ${endExclusive}
    `),
  ]);

  const series = new Map<string, AnalyticsSeriesPoint>();
  for (let offset = 0; offset < days; offset += 1) {
    const day = dayKey(addDays(start, offset));
    series.set(day, { day, metrics: emptyMetrics() });
  }
  const totals = emptyMetrics();
  for (const row of dailyRows) {
    if (!(ANALYTICS_METRICS as readonly string[]).includes(row.metric)) continue;
    const metric = row.metric as AnalyticsMetric;
    const point = series.get(row.day);
    if (point) point.metrics[metric] = numeric(row.value);
    totals[metric] += numeric(row.value);
  }

  const response = (responseRows.rows[0] as { minutes: number | string | null } | undefined)
    ?.minutes;
  const junoResolved = junoRows
    .filter((row) => row.state === "resolved")
    .reduce((sum, row) => sum + numeric(row.count), 0);
  const junoInvolved = junoRows.reduce((sum, row) => sum + numeric(row.count), 0);
  const emailAttempts = totals.emails_sent + totals.emails_failed;
  const csat = csatRows.rows[0] as
    | { requested: number | string | null; responses: number | string | null; average: number | string | null }
    | undefined;
  const csatAverage = csat?.average;

  return {
    days,
    from: dayKey(start),
    to: dayKey(endDay),
    totals,
    series: [...series.values()],
    funnel: funnelRows.map((row) => ({ status: row.status, count: numeric(row.count) })),
    averageFirstResponseMinutes: response === null || response === undefined
      ? null
      : Math.round(numeric(response)),
    averageTimeToShipMinutes:
      totals.time_to_ship_count > 0
        ? Math.round(totals.time_to_ship_minutes / totals.time_to_ship_count)
        : null,
    junoResolved,
    junoInvolved,
    emailDeliveryRate:
      emailAttempts > 0 ? totals.emails_sent / emailAttempts : null,
    csatRequested: numeric(csat?.requested),
    csatResponses: numeric(csat?.responses),
    csatAverage:
      csatAverage === null || csatAverage === undefined
        ? null
        : numeric(csatAverage),
  };
}

