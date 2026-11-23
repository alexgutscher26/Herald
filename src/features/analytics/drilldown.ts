import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db";
import { findMetric } from "@/features/reporting/catalogue";

/**
 * Row-level drill-down for one catalogue metric.
 *
 * The metric key is validated against the report catalogue and then matched by
 * a fixed switch, so a request can never choose a table or expression. Raw
 * analytics rows never expose the day-scoped visitor hash.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const LIMIT = 100;

export type DrilldownColumn = { key: string; label: string };

export type MetricDrilldown = {
  metric: string;
  title: string;
  description: string;
  from: string;
  to: string;
  columns: DrilldownColumn[];
  rows: Array<Record<string, string | number | null>>;
  note: string | null;
};

const EVENT_METRICS: Record<string, string> = {
  board_views: "board_view",
  request_views: "request_view",
  portal_page_views: "portal_page_view",
  submit_started: "submit_started",
  submissions: "submission",
  votes: "vote",
  widget_opens: "widget_open",
  widget_installs: "widget_install",
};

const EVENT_COLUMNS: DrilldownColumn[] = [
  { key: "occurred_at", label: "Time (UTC)" },
  { key: "type", label: "Event" },
  { key: "board", label: "Board" },
  { key: "request", label: "Request" },
  { key: "page", label: "Page" },
];

function text(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function normalize(rows: ReadonlyArray<Record<string, unknown>>) {
  return rows.map((row) =>
    Object.fromEntries(Object.entries(row).map(([key, value]) => [key, text(value)])),
  );
}

export async function getMetricDrilldown(input: {
  workspaceId: string;
  productId: string;
  dataset: string;
  metric: string;
  days?: number;
  now?: Date;
}): Promise<MetricDrilldown> {
  const definition = findMetric(input.dataset, input.metric);
  if (!definition) throw new Error("Unknown metric.");
  const days = Math.min(Math.max(Math.trunc(input.days ?? 30), 1), 90);
  const now = input.now ?? new Date();
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
  const start = new Date(end.getTime() - days * DAY_MS);
  const base = {
    metric: definition.key,
    title: definition.label,
    description: definition.description,
    from: start.toISOString().slice(0, 10),
    to: new Date(end.getTime() - DAY_MS).toISOString().slice(0, 10),
  };
  const productId = input.productId;

  const eventType = EVENT_METRICS[input.metric];
  if (eventType) {
    const rows = await db.execute(sql`
      SELECT e."occurred_at", e."type",
             b."name" AS board, p."title" AS request,
             e."metadata"->>'page' AS page
      FROM "analytics_events" e
      LEFT JOIN "boards" b ON b."id" = e."board_id"
      LEFT JOIN "feedback_posts" p ON p."id" = e."feedback_post_id"
      WHERE e."product_id" = ${productId}
        AND e."type" = ${eventType}
        AND e."occurred_at" >= ${start}
        AND e."occurred_at" < ${end}
      ORDER BY e."occurred_at" DESC
      LIMIT ${LIMIT}
    `);
    return {
      ...base,
      columns: EVENT_COLUMNS,
      rows: normalize(rows.rows as Array<Record<string, unknown>>),
      note: "Raw public events for this window. The day-scoped visitor hash is not exported.",
    };
  }

  if (input.metric === "requests_created") {
    const rows = await db.execute(sql`
      SELECT "created_at", "title", "status", "source"
      FROM "feedback_posts"
      WHERE "product_id" = ${productId}
        AND "created_at" >= ${start}
        AND "created_at" < ${end}
      ORDER BY "created_at" DESC LIMIT ${LIMIT}
    `);
    return {
      ...base,
      columns: [
        { key: "created_at", label: "Created (UTC)" },
        { key: "title", label: "Request" },
        { key: "status", label: "Status" },
        { key: "source", label: "Source" },
      ],
      rows: normalize(rows.rows as Array<Record<string, unknown>>),
      note: null,
    };
  }

  if (input.metric === "requests_shipped" || input.metric === "feedback_shipped") {
    const rows = await db.execute(sql`
      SELECT h."changed_at", p."title" AS request, h."from_status", h."to_status"
      FROM "feedback_status_history" h
      INNER JOIN "feedback_posts" p ON p."id" = h."feedback_post_id"
      WHERE h."product_id" = ${productId}
        AND h."to_status" = 'shipped'
        AND h."changed_at" >= ${start}
        AND h."changed_at" < ${end}
      ORDER BY h."changed_at" DESC LIMIT ${LIMIT}
    `);
    return {
      ...base,
      columns: [
        { key: "changed_at", label: "Shipped (UTC)" },
        { key: "request", label: "Request" },
        { key: "from_status", label: "From" },
        { key: "to_status", label: "To" },
      ],
      rows: normalize(rows.rows as Array<Record<string, unknown>>),
      note: null,
    };
  }

  if (input.metric === "votes_cast") {
    const rows = await db.execute(sql`
      SELECT v."created_at", p."title" AS request
      FROM "feedback_votes" v
      INNER JOIN "feedback_posts" p ON p."id" = v."feedback_post_id"
      WHERE p."product_id" = ${productId}
        AND v."created_at" >= ${start}
        AND v."created_at" < ${end}
      ORDER BY v."created_at" DESC LIMIT ${LIMIT}
    `);
    return {
      ...base,
      columns: [
        { key: "created_at", label: "Voted (UTC)" },
        { key: "request", label: "Request" },
      ],
      rows: normalize(rows.rows as Array<Record<string, unknown>>),
      note: null,
    };
  }

  if (input.metric === "comments_added") {
    const rows = await db.execute(sql`
      SELECT c."created_at", p."title" AS request, c."author_name", c."author_type"
      FROM "feedback_comments" c
      INNER JOIN "feedback_posts" p ON p."id" = c."feedback_post_id"
      WHERE c."product_id" = ${productId}
        AND c."internal" = false
        AND c."created_at" >= ${start}
        AND c."created_at" < ${end}
      ORDER BY c."created_at" DESC LIMIT ${LIMIT}
    `);
    return {
      ...base,
      columns: [
        { key: "created_at", label: "Commented (UTC)" },
        { key: "request", label: "Request" },
        { key: "author_name", label: "Author" },
        { key: "author_type", label: "Type" },
      ],
      rows: normalize(rows.rows as Array<Record<string, unknown>>),
      note: null,
    };
  }

  if (
    input.metric === "conversations_started" ||
    input.metric === "conversations_resolved"
  ) {
    const resolved = input.metric === "conversations_resolved";
    const rows = await db.execute(sql`
      SELECT c."id", c."subject", c."status", c."created_at", c."resolved_at"
      FROM "conversations" c
      WHERE c."product_id" = ${productId}
        AND ${resolved ? sql`c."resolved_at"` : sql`c."created_at"`} >= ${start}
        AND ${resolved ? sql`c."resolved_at"` : sql`c."created_at"`} < ${end}
      ORDER BY ${resolved ? sql`c."resolved_at"` : sql`c."created_at"`} DESC
      LIMIT ${LIMIT}
    `);
    return {
      ...base,
      columns: [
        { key: "created_at", label: "Started (UTC)" },
        { key: "resolved_at", label: "Resolved (UTC)" },
        { key: "subject", label: "Subject" },
        { key: "status", label: "Status" },
      ],
      rows: normalize(rows.rows as Array<Record<string, unknown>>),
      note: null,
    };
  }

  if (input.metric === "csat_responses") {
    const rows = await db.execute(sql`
      SELECT "csat_rated_at", "subject", "csat_rating"
      FROM "conversations"
      WHERE "product_id" = ${productId}
        AND "csat_rating" IS NOT NULL
        AND "csat_rated_at" >= ${start}
        AND "csat_rated_at" < ${end}
      ORDER BY "csat_rated_at" DESC LIMIT ${LIMIT}
    `);
    return {
      ...base,
      columns: [
        { key: "csat_rated_at", label: "Rated (UTC)" },
        { key: "subject", label: "Conversation" },
        { key: "csat_rating", label: "Rating" },
      ],
      rows: normalize(rows.rows as Array<Record<string, unknown>>),
      note: null,
    };
  }

  if (input.metric === "juno_resolved") {
    const rows = await db.execute(sql`
      SELECT "resolved_at", "state", "conversation_id"
      FROM "juno_conversations"
      WHERE "product_id" = ${productId}
        AND "state" = 'resolved'
        AND "resolved_at" >= ${start}
        AND "resolved_at" < ${end}
      ORDER BY "resolved_at" DESC LIMIT ${LIMIT}
    `);
    return {
      ...base,
      columns: [
        { key: "resolved_at", label: "Resolved (UTC)" },
        { key: "state", label: "State" },
        { key: "conversation_id", label: "Conversation" },
      ],
      rows: normalize(rows.rows as Array<Record<string, unknown>>),
      note: null,
    };
  }

  if (input.metric === "emails_sent" || input.metric === "emails_failed") {
    const status = input.metric === "emails_sent" ? "sent" : "failed";
    const rows = await db.execute(sql`
      SELECT coalesce("sent_at", "updated_at") AS at, "status", "recipient_email", "template"
      FROM "notification_deliveries"
      WHERE "product_id" = ${productId}
        AND "status" = ${status}
        AND coalesce("sent_at", "updated_at") >= ${start}
        AND coalesce("sent_at", "updated_at") < ${end}
      ORDER BY at DESC LIMIT ${LIMIT}
    `);
    return {
      ...base,
      columns: [
        { key: "at", label: "Time (UTC)" },
        { key: "recipient_email", label: "Recipient" },
        { key: "template", label: "Template" },
        { key: "status", label: "Status" },
      ],
      rows: normalize(rows.rows as Array<Record<string, unknown>>),
      note: "Recipient addresses are part of the delivery record.",
    };
  }

  if (input.metric === "time_to_ship_minutes" || input.metric === "time_to_ship_count") {
    const rows = await db.execute(sql`
      WITH first_ship AS (
        SELECT DISTINCT ON (h."feedback_post_id") h."feedback_post_id", h."changed_at"
        FROM "feedback_status_history" h
        WHERE h."product_id" = ${productId} AND h."to_status" = 'shipped'
        ORDER BY h."feedback_post_id", h."changed_at"
      )
      SELECT s."changed_at", p."title" AS request,
             round(extract(epoch from (s."changed_at" - p."created_at")) / 60)::int AS minutes
      FROM first_ship s
      INNER JOIN "feedback_posts" p ON p."id" = s."feedback_post_id"
      WHERE s."changed_at" >= ${start} AND s."changed_at" < ${end}
      ORDER BY s."changed_at" DESC LIMIT ${LIMIT}
    `);
    return {
      ...base,
      columns: [
        { key: "changed_at", label: "Shipped (UTC)" },
        { key: "request", label: "Request" },
        { key: "minutes", label: "Minutes to ship" },
      ],
      rows: normalize(rows.rows as Array<Record<string, unknown>>),
      note: null,
    };
  }

  if (input.metric === "subscribers_added" || input.metric === "subscribers_unsubscribed") {
    const unsubscribed = input.metric === "subscribers_unsubscribed";
    const rows = await db.execute(sql`
      SELECT "email", "created_at", "unsubscribed_at", "status"
      FROM "subscribers"
      WHERE "product_id" = ${productId}
        AND ${unsubscribed ? sql`"unsubscribed_at"` : sql`"created_at"`} >= ${start}
        AND ${unsubscribed ? sql`"unsubscribed_at"` : sql`"created_at"`} < ${end}
      ORDER BY ${unsubscribed ? sql`"unsubscribed_at"` : sql`"created_at"`} DESC
      LIMIT ${LIMIT}
    `);
    return {
      ...base,
      columns: [
        { key: "email", label: "Subscriber" },
        { key: "created_at", label: "Subscribed (UTC)" },
        { key: "unsubscribed_at", label: "Unsubscribed (UTC)" },
        { key: "status", label: "Status" },
      ],
      rows: normalize(rows.rows as Array<Record<string, unknown>>),
      note: null,
    };
  }

  if (input.metric === "survey_responses") {
    const rows = await db.execute(sql`
      SELECT r."created_at", s."name" AS survey, r."customer_id"
      FROM "survey_responses" r
      INNER JOIN "surveys" s ON s."id" = r."survey_id"
      WHERE r."product_id" = ${productId}
        AND r."created_at" >= ${start}
        AND r."created_at" < ${end}
      ORDER BY r."created_at" DESC LIMIT ${LIMIT}
    `);
    return {
      ...base,
      columns: [
        { key: "created_at", label: "Responded (UTC)" },
        { key: "survey", label: "Survey" },
        { key: "customer_id", label: "Customer" },
      ],
      rows: normalize(rows.rows as Array<Record<string, unknown>>),
      note: "Anonymous responses have no customer id.",
    };
  }

  if (input.metric === "tour_completions") {
    const rows = await db.execute(sql`
      SELECT c."completed_at", e."name" AS tour, c."customer_id"
      FROM "widget_experience_completions" c
      INNER JOIN "widget_experiences" e ON e."id" = c."experience_id"
      WHERE c."product_id" = ${productId}
        AND c."completed_at" >= ${start}
        AND c."completed_at" < ${end}
      ORDER BY c."completed_at" DESC LIMIT ${LIMIT}
    `);
    return {
      ...base,
      columns: [
        { key: "completed_at", label: "Completed (UTC)" },
        { key: "tour", label: "Tour" },
        { key: "customer_id", label: "Customer" },
      ],
      rows: normalize(rows.rows as Array<Record<string, unknown>>),
      note: null,
    };
  }

  throw new Error("Drill-down is not available for this metric.");
}
