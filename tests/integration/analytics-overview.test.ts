import { afterAll, beforeAll, describe, expect } from "bun:test";

import { db } from "@/db";
import { analyticsDaily } from "@/db/schema";
import { ANALYTICS_METRICS, type AnalyticsMetric } from "@/features/analytics/rollup";
import { getAnalyticsOverview } from "@/features/reporting/overview";

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

describe("analytics overview through the reporting layer", () => {
  isolatedTest("reads all sixteen product-activity metrics past the report cap", async () => {
    const workspace = await createWorkspace();
    const product = await createProduct(workspace.id);
    const now = new Date(Date.UTC(2026, 10, 7, 12));
    const today = "2026-11-07";
    const seeded = new Map<AnalyticsMetric, number>(
      ANALYTICS_METRICS.map((metric, index) => [metric, index + 1]),
    );

    // Written directly so the read path cannot recalculate over the fixture;
    // a row for today also keeps the overview from refreshing the window.
    await db.insert(analyticsDaily).values(
      [...seeded.entries()].map(([metric, value]) => ({
        workspaceId: workspace.id,
        productId: product.id,
        day: today,
        metric,
        value,
      })),
    );

    const overview = await getAnalyticsOverview({
      workspaceId: workspace.id,
      productId: product.id,
      days: 2,
      now,
    });

    expect(overview.days).toBe(2);
    expect(overview.from).toBe("2026-11-06");
    expect(overview.to).toBe(today);
    expect(overview.series.map((point) => point.day)).toEqual(["2026-11-06", today]);

    const todayPoint = overview.series.find((point) => point.day === today);
    expect(todayPoint).toBeDefined();
    for (const [metric, value] of seeded) {
      expect(overview.totals[metric]).toBe(value);
      expect(todayPoint?.metrics[metric]).toBe(value);
    }

    // The first batch ends at widget_installs; the metrics after it must not be
    // dropped or zeroed when the batches are merged.
    expect(overview.totals.board_views).toBe(1);
    expect(overview.totals.time_to_ship_minutes).toBe(15);
    expect(overview.totals.time_to_ship_count).toBe(16);
  });
});
