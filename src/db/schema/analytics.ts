import {
  bigint,
  date,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { boards } from "@/db/schema/boards";
import { feedbackPosts } from "@/db/schema/feedback";
import { products, workspaces } from "@/db/schema/workspaces";

const tz = { withTimezone: true } as const;

/**
 * The small set of public interactions worth counting.
 *
 * Keep this deliberately narrow: these are product metrics, not a second
 * request log. Customer identifiers are never stored — `visitorHash` is a
 * one-way, day-scoped hash used only to avoid counting the same board view
 * repeatedly.
 */
export const ANALYTICS_EVENT_TYPES = [
  "board_view",
  "request_view",
  "submit_started",
  "submission",
  "vote",
  "widget_open",
  "widget_install",
  "portal_page_view",
] as const;

export type AnalyticsEventType = (typeof ANALYTICS_EVENT_TYPES)[number];

export const analyticsEventTypeEnum = pgEnum(
  "analytics_event_type",
  ANALYTICS_EVENT_TYPES,
);

/**
 * Raw analytics events.
 *
 * Partitioning is intentionally not required at this scale; the product/day
 * indexes and the daily rollup keep the common read path small. Events carry no
 * email, IP address, user agent or customer id. The metadata object is limited
 * to non-identifying dimensions such as the widget panel name.
 */
export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    boardId: uuid("board_id").references(() => boards.id, { onDelete: "set null" }),
    feedbackPostId: uuid("feedback_post_id").references(() => feedbackPosts.id, {
      onDelete: "set null",
    }),
    type: analyticsEventTypeEnum("type").notNull(),
    /** One-way, day-scoped view dedupe key; null for anonymous interactions. */
    visitorHash: text("visitor_hash"),
    metadata: jsonb("metadata").$type<Record<string, string | number | boolean>>(),
    occurredAt: timestamp("occurred_at", tz).notNull().defaultNow(),
  },
  (t) => [
    index("analytics_events_product_time_idx").on(t.productId, t.occurredAt),
    index("analytics_events_product_type_time_idx").on(
      t.productId,
      t.type,
      t.occurredAt,
    ),
    index("analytics_events_workspace_time_idx").on(t.workspaceId, t.occurredAt),
    index("analytics_events_board_time_idx").on(t.boardId, t.occurredAt),
  ],
);

/**
 * Daily rollups, one row per product/metric/day.
 *
 * The analytics page reads these rows; it does not aggregate raw events on
 * every request. The nightly job recomputes the last two days so late events
 * and a timezone boundary cannot leave a permanently wrong number.
 */
export const analyticsDaily = pgTable(
  "analytics_daily",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    metric: text("metric").notNull(),
    value: bigint("value", { mode: "number" }).notNull().default(0),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("analytics_daily_product_day_metric_unique").on(
      t.productId,
      t.day,
      t.metric,
    ),
    index("analytics_daily_workspace_day_idx").on(t.workspaceId, t.day),
    index("analytics_daily_product_day_idx").on(t.productId, t.day),
  ],
);

export type AnalyticsEvent = typeof analyticsEvents.$inferSelect;
export type NewAnalyticsEvent = typeof analyticsEvents.$inferInsert;
export type AnalyticsDaily = typeof analyticsDaily.$inferSelect;
export type NewAnalyticsDaily = typeof analyticsDaily.$inferInsert;
