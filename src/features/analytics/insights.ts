import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db";

/**
 * Analytics that need raw rows rather than the daily product-activity rollups:
 * event funnels, signup cohorts and rollup freshness.
 *
 * Every query is product- or workspace-scoped and every event name is a bound
 * parameter. The only SQL identifiers interpolated are fixed step indexes.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function range(days: number, now: Date): { start: Date; end: Date; from: string; to: string } {
  const safeDays = Math.min(Math.max(Math.trunc(days), 1), 90);
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
  const start = new Date(end.getTime() - safeDays * DAY_MS);
  return {
    start,
    end,
    from: start.toISOString().slice(0, 10),
    to: new Date(end.getTime() - DAY_MS).toISOString().slice(0, 10),
  };
}

export type AnalyticsFreshness = {
  updatedAt: string | null;
  rows: number;
};

export async function getAnalyticsFreshness(productId: string): Promise<AnalyticsFreshness> {
  const result = await db.execute(sql`
    SELECT max("updated_at") AS updated_at, count(*)::int AS rows
    FROM "analytics_daily"
    WHERE "product_id" = ${productId}
  `);
  const row = result.rows[0] as
    | { updated_at: Date | string | null; rows: number | string | null }
    | undefined;
  const updatedAt = row?.updated_at
    ? new Date(row.updated_at).toISOString()
    : null;
  return {
    updatedAt,
    rows: Number(row?.rows ?? 0),
  };
}

export type EventFunnelStep = {
  name: string;
  count: number;
  /** Share of the previous step; null for the first step or a zero baseline. */
  rate: number | null;
  /** People lost between the previous step and this one. */
  dropped: number | null;
};

export type EventFunnel = {
  days: number;
  from: string;
  to: string;
  steps: EventFunnelStep[];
};

const EVENT_NAME = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;

export function cleanEventSteps(values: readonly unknown[]): string[] {
  const steps: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const name = value.trim();
    if (!EVENT_NAME.test(name) || steps.includes(name)) continue;
    steps.push(name);
  }
  return steps.slice(0, 6);
}

/**
 * Ordered customer-event funnel.
 *
 * Step N only counts a customer whose event N happened at or after their event
 * N-1 time, so a later action cannot satisfy an earlier step. Each step keeps
 * the first qualifying time, which is what makes the next comparison sound.
 */
export async function getEventFunnel(input: {
  productId: string;
  steps: readonly string[];
  days?: number;
  now?: Date;
}): Promise<EventFunnel> {
  const steps = cleanEventSteps(input.steps);
  const window = range(input.days ?? 30, input.now ?? new Date());
  if (steps.length === 0) {
    return { days: Math.min(Math.max(input.days ?? 30, 1), 90), ...window, steps: [] };
  }

  const ctes = steps.map((name, index) => {
    if (index === 0) {
      return sql`
        ${sql.raw(`step_${index}`)} AS (
          SELECT "customer_id", min("occurred_at") AS at
          FROM "customer_events"
          WHERE "product_id" = ${input.productId}
            AND "name" = ${name}
            AND "occurred_at" >= ${window.start}
            AND "occurred_at" < ${window.end}
          GROUP BY "customer_id"
        )
      `;
    }
    return sql`
      ${sql.raw(`step_${index}`)} AS (
        SELECT s."customer_id", min(e."occurred_at") AS at
        FROM ${sql.raw(`step_${index - 1}`)} s
        INNER JOIN "customer_events" e
          ON e."customer_id" = s."customer_id"
         AND e."product_id" = ${input.productId}
        WHERE e."name" = ${name}
          AND e."occurred_at" >= s.at
          AND e."occurred_at" < ${window.end}
        GROUP BY s."customer_id"
      )
    `;
  });

  const counts = sql.join(
    steps.map(
      (_, index) =>
        sql`(SELECT count(*)::int FROM ${sql.raw(`step_${index}`)}) AS ${sql.raw(`total_${index}`)}`,
    ),
    sql`, `,
  );

  const result = await db.execute(
    sql`WITH ${sql.join(ctes, sql`, `)} SELECT ${counts}`,
  );
  const row = (result.rows[0] ?? {}) as Record<string, number | string | null>;

  const rows = steps.map((name, index) => ({
    name,
    count: Number(row[`total_${index}`] ?? 0),
  }));
  return {
    days: Math.min(Math.max(input.days ?? 30, 1), 90),
    from: window.from,
    to: window.to,
    steps: rows.map((step, index) => {
      const previous = rows[index - 1];
      return {
        ...step,
        rate:
          index === 0 || !previous || previous.count === 0
            ? null
            : step.count / previous.count,
        dropped:
          index === 0 || !previous
            ? null
            : Math.max(0, previous.count - step.count),
      };
    }),
  };
}

export type EventNameOption = { name: string; events: number; customers: number };

export type TagAnalyticsRow = {
  id: string;
  name: string;
  color: string | null;
  requests: number;
  votes: number;
  shipped: number;
};

export type BoardAnalyticsRow = TagAnalyticsRow;

/** Requests, votes and shipped requests per board for the selected window. */
export async function getBoardAnalytics(input: {
  productId: string;
  days?: number;
  now?: Date;
}): Promise<BoardAnalyticsRow[]> {
  const window = range(input.days ?? 30, input.now ?? new Date());
  const result = await db.execute(sql`
    SELECT b."id", b."name", NULL::text AS color,
           count(DISTINCT p."id")::int AS requests,
           count(DISTINCT v."id")::int AS votes,
           count(DISTINCT p."id") FILTER (
             WHERE EXISTS (
               SELECT 1 FROM "feedback_status_history" h
               WHERE h."feedback_post_id" = p."id" AND h."to_status" = 'shipped'
             )
           )::int AS shipped
    FROM "boards" b
    LEFT JOIN "feedback_posts" p
      ON p."board_id" = b."id"
     AND p."created_at" >= ${window.start}
     AND p."created_at" < ${window.end}
     AND p."archived_at" IS NULL
    LEFT JOIN "feedback_votes" v ON v."feedback_post_id" = p."id"
    WHERE b."product_id" = ${input.productId} AND b."archived_at" IS NULL
    GROUP BY b."id", b."name"
    ORDER BY requests DESC, votes DESC, b."name" ASC
    LIMIT 20
  `);
  return (
    result.rows as Array<{
      id: string;
      name: string;
      color: string | null;
      requests: number | string;
      votes: number | string;
      shipped: number | string;
    }>
  ).map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
    requests: Number(row.requests),
    votes: Number(row.votes),
    shipped: Number(row.shipped),
  }));
}

/** Requests, votes and shipped requests per tag for the selected window. */
export async function getTagAnalytics(input: {
  productId: string;
  days?: number;
  now?: Date;
}): Promise<TagAnalyticsRow[]> {
  const window = range(input.days ?? 30, input.now ?? new Date());
  const result = await db.execute(sql`
    SELECT t."id", t."name", t."color",
           count(DISTINCT p."id")::int AS requests,
           count(DISTINCT v."id")::int AS votes,
           count(DISTINCT p."id") FILTER (
             WHERE EXISTS (
               SELECT 1 FROM "feedback_status_history" h
               WHERE h."feedback_post_id" = p."id" AND h."to_status" = 'shipped'
             )
           )::int AS shipped
    FROM "board_tags" t
    LEFT JOIN "feedback_tag_links" l
      ON l."tag_id" = t."id" AND l."product_id" = t."product_id"
    LEFT JOIN "feedback_posts" p
      ON p."id" = l."feedback_post_id"
     AND p."created_at" >= ${window.start}
     AND p."created_at" < ${window.end}
     AND p."archived_at" IS NULL
    LEFT JOIN "feedback_votes" v ON v."feedback_post_id" = p."id"
    WHERE t."product_id" = ${input.productId}
    GROUP BY t."id", t."name", t."color"
    HAVING count(DISTINCT p."id") > 0
    ORDER BY requests DESC, votes DESC, t."name" ASC
    LIMIT 20
  `);
  return (
    result.rows as Array<{
      id: string;
      name: string;
      color: string | null;
      requests: number | string;
      votes: number | string;
      shipped: number | string;
    }>
  ).map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
    requests: Number(row.requests),
    votes: Number(row.votes),
    shipped: Number(row.shipped),
  }));
}

export async function listEventNames(
  productId: string,
  days = 90,
): Promise<EventNameOption[]> {
  const window = range(days, new Date());
  const result = await db.execute(sql`
    SELECT "name", count(*)::int AS events, count(DISTINCT "customer_id")::int AS customers
    FROM "customer_events"
    WHERE "product_id" = ${productId}
      AND "occurred_at" >= ${window.start}
    GROUP BY "name"
    ORDER BY events DESC, "name" ASC
    LIMIT 24
  `);
  return (result.rows as Array<{ name: string; events: number | string; customers: number | string }>).map(
    (row) => ({
      name: row.name,
      events: Number(row.events),
      customers: Number(row.customers),
    }),
  );
}

export type SignupCohort = {
  month: string;
  size: number;
  /** Index 0 is the signup month; later entries are calendar months after it. */
  retained: Array<number | null>;
};

/**
 * Monthly signup cohorts, retained by any product event in each later month.
 *
 * This is workspace signup data activity-scoped to one product: a customer who
 * signs up but never touches this product is still cohort size, with zero
 * retention. Cells after the current month are null rather than zero.
 */
export async function getSignupCohorts(input: {
  workspaceId: string;
  productId: string;
  months?: number;
  now?: Date;
}): Promise<SignupCohort[]> {
  const months = Math.min(Math.max(Math.trunc(input.months ?? 6), 1), 12);
  const now = input.now ?? new Date();
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1),
  );
  const offsets = Array.from({ length: months }, (_, index) => index);
  const retention = sql.join(
    offsets.map(
      (offset) =>
        sql`count(DISTINCT c."id") FILTER (
          WHERE a."active_month" = c."cohort_month" + make_interval(months => ${offset})
        )::int AS ${sql.raw(`m${offset}`)}`,
    ),
    sql`, `,
  );

  const result = await db.execute(sql`
    WITH cohort AS (
      SELECT "id", date_trunc('month', "created_at") AS cohort_month
      FROM "customers"
      WHERE "workspace_id" = ${input.workspaceId}
        AND "created_at" >= ${start}
    ),
    activity AS (
      SELECT DISTINCT "customer_id", date_trunc('month', "occurred_at") AS active_month
      FROM "customer_events"
      WHERE "product_id" = ${input.productId}
        AND "occurred_at" >= ${start}
    )
    SELECT
      to_char(c."cohort_month", 'YYYY-MM') AS month,
      count(DISTINCT c."id")::int AS size,
      ${retention}
    FROM cohort c
    LEFT JOIN activity a ON a."customer_id" = c."id"
    GROUP BY c."cohort_month"
    ORDER BY c."cohort_month" DESC
  `);

  const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return (
    result.rows as Array<Record<string, string | number | null> & { month: string; size: number | string }>
  ).map((row) => {
    const cohortMonth = row.month;
    const [year = 0, month = 0] = cohortMonth.split("-").map(Number);
    const retained = offsets.map((offset) => {
      const cellMonth = new Date(Date.UTC(year, month - 1 + offset, 1));
      const key = `${cellMonth.getUTCFullYear()}-${String(cellMonth.getUTCMonth() + 1).padStart(2, "0")}`;
      if (key > currentMonth) return null;
      return Number(row[`m${offset}`] ?? 0);
    });
    return {
      month: cohortMonth,
      size: Number(row.size),
      retained,
    };
  });
}
