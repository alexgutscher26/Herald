import { afterAll, beforeAll, describe, expect } from "bun:test";
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { analyticsDaily, analyticsEvents } from "@/db/schema";
import {
  ANALYTICS_METRICS,
  recalculateAnalyticsWindow,
  type AnalyticsMetric,
} from "@/features/analytics/rollup";

import { createProduct, createWorkspace } from "./factories";
import {
  SETUP_TIMEOUT_MS,
  isolatedTest,
  setupTestDatabase,
  teardownTestDatabase,
} from "./harness";

beforeAll(async () => {
  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

const EVENT_METRIC: Record<string, AnalyticsMetric> = {
  board_view: "board_views",
  request_view: "request_views",
  submit_started: "submit_started",
  submission: "submissions",
  vote: "votes",
  widget_open: "widget_opens",
  widget_install: "widget_installs",
  portal_page_view: "portal_page_views",
};

describe("analytics rollup drift guard", () => {
  isolatedTest("daily rollup matches a direct recomputation of the same window", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const now = new Date(Date.UTC(2026, 10, 21, 12));
    const start = new Date(Date.UTC(2026, 10, 19, 0));
    const end = new Date(Date.UTC(2026, 10, 22, 0));

    await db.insert(analyticsEvents).values([
      { workspaceId: workspace.id, productId: product.id, type: "board_view", occurredAt: new Date(Date.UTC(2026, 10, 19, 9)) },
      { workspaceId: workspace.id, productId: product.id, type: "board_view", occurredAt: new Date(Date.UTC(2026, 10, 20, 9)) },
      { workspaceId: workspace.id, productId: product.id, type: "board_view", occurredAt: new Date(Date.UTC(2026, 10, 21, 9)) },
      { workspaceId: workspace.id, productId: product.id, type: "request_view", occurredAt: new Date(Date.UTC(2026, 10, 19, 10)) },
      { workspaceId: workspace.id, productId: product.id, type: "submit_started", occurredAt: new Date(Date.UTC(2026, 10, 20, 10)) },
      { workspaceId: workspace.id, productId: product.id, type: "submission", occurredAt: new Date(Date.UTC(2026, 10, 20, 11)) },
      { workspaceId: workspace.id, productId: product.id, type: "vote", occurredAt: new Date(Date.UTC(2026, 10, 21, 11)) },
      { workspaceId: workspace.id, productId: product.id, type: "widget_open", occurredAt: new Date(Date.UTC(2026, 10, 21, 12)) },
    ]);

    await recalculateAnalyticsWindow({
      workspaceId: workspace.id,
      productId: product.id,
      days: 3,
      now,
    });
    // A repeated run must be idempotent, not add the same events again.
    await recalculateAnalyticsWindow({
      workspaceId: workspace.id,
      productId: product.id,
      days: 3,
      now,
    });

    const rolled = await db
      .select({ metric: analyticsDaily.metric, value: analyticsDaily.value })
      .from(analyticsDaily)
      .where(
        and(
          eq(analyticsDaily.productId, product.id),
          sql`${analyticsDaily.day} >= ${"2026-11-19"}`,
          sql`${analyticsDaily.day} <= ${"2026-11-21"}`,
        ),
      );
    const rollup = Object.fromEntries(
      ANALYTICS_METRICS.map((metric) => [metric, 0]),
    ) as Record<AnalyticsMetric, number>;
    for (const row of rolled) {
      if (row.metric in rollup) {
        rollup[row.metric as AnalyticsMetric] += row.value;
      }
    }

    const direct = await db.execute(sql`
      SELECT "type", count(*)::int AS value
      FROM "analytics_events"
      WHERE "product_id" = ${product.id}
        AND "occurred_at" >= ${start}
        AND "occurred_at" < ${end}
      GROUP BY "type"
    `);
    const expected = Object.fromEntries(
      ANALYTICS_METRICS.map((metric) => [metric, 0]),
    ) as Record<AnalyticsMetric, number>;
    for (const row of direct.rows as Array<{ type: string; value: number | string }>) {
      const metric = EVENT_METRIC[row.type];
      if (metric) expected[metric] += Number(row.value);
    }

    for (const metric of Object.keys(EVENT_METRIC).map((type) => EVENT_METRIC[type]!)) {
      expect(rollup[metric]).toBe(expected[metric]);
    }
    expect(rollup.board_views).toBe(3);
    expect(rollup.submissions).toBe(1);
    expect(rollup.votes).toBe(1);
    expect(rollup.portal_page_views).toBe(0);
  });
});
