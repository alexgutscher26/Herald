import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db";

import { buildPortalFunnel, type PortalFunnelStep } from "./portal-funnel";

/**
 * Portal analytics over the existing event rows.
 *
 * `analytics_events` is the single source for public behaviour: board and
 * request views already live there, and roadmap/changelog visits use the same
 * table with `portal_page_view`. Nothing here writes a second page-view store.
 * Visitor counts are day-scoped hashes, so they are reported as visitor-days,
 * not unique people.
 */

export type PortalPageBreakdown = { page: string; views: number };
export type PortalTopBoard = { id: string; name: string; views: number };

export type PortalAnalytics = {
  days: number;
  from: string;
  to: string;
  visitorDays: number;
  pageViews: number;
  funnel: PortalFunnelStep[];
  pages: PortalPageBreakdown[];
  topBoards: PortalTopBoard[];
};

type TypeRow = { type: string; value: number | string };
type PageRow = { page: string; value: number | string };
type BoardRow = { id: string; name: string; value: number | string };

export async function getPortalAnalytics(input: {
  workspaceId: string;
  productId: string;
  days?: number;
  now?: Date;
}): Promise<PortalAnalytics> {
  const days = Math.min(Math.max(Math.trunc(input.days ?? 30), 1), 90);
  const now = input.now ?? new Date();
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const from = start.toISOString().slice(0, 10);
  const to = now.toISOString().slice(0, 10);

  const [typeRows, pageRows, boardRows, visitorRows] = await Promise.all([
    db.execute(sql`
      SELECT "type", count(*)::int AS value
      FROM "analytics_events"
      WHERE "workspace_id" = ${input.workspaceId}
        AND "product_id" = ${input.productId}
        AND "occurred_at" >= ${start}
        AND "occurred_at" <= ${now}
      GROUP BY "type"
    `),
    db.execute(sql`
      SELECT 'Board' AS page, count(*)::int AS value
      FROM "analytics_events"
      WHERE "workspace_id" = ${input.workspaceId}
        AND "product_id" = ${input.productId}
        AND "type" = 'board_view'
        AND "occurred_at" >= ${start} AND "occurred_at" <= ${now}
      UNION ALL
      SELECT 'Request', count(*)::int
      FROM "analytics_events"
      WHERE "workspace_id" = ${input.workspaceId}
        AND "product_id" = ${input.productId}
        AND "type" = 'request_view'
        AND "occurred_at" >= ${start} AND "occurred_at" <= ${now}
      UNION ALL
      SELECT coalesce(nullif("metadata"->>'page', ''), 'Other'), count(*)::int
      FROM "analytics_events"
      WHERE "workspace_id" = ${input.workspaceId}
        AND "product_id" = ${input.productId}
        AND "type" = 'portal_page_view'
        AND "occurred_at" >= ${start} AND "occurred_at" <= ${now}
      GROUP BY 1
      ORDER BY value DESC
    `),
    db.execute(sql`
      SELECT b."id", b."name", count(*)::int AS value
      FROM "analytics_events" e
      INNER JOIN "boards" b ON b."id" = e."board_id"
      WHERE e."workspace_id" = ${input.workspaceId}
        AND e."product_id" = ${input.productId}
        AND e."type" IN ('board_view', 'request_view')
        AND e."occurred_at" >= ${start} AND e."occurred_at" <= ${now}
      GROUP BY b."id", b."name"
      ORDER BY value DESC
      LIMIT 5
    `),
    db.execute(sql`
      SELECT count(DISTINCT "visitor_hash")::int AS value
      FROM "analytics_events"
      WHERE "workspace_id" = ${input.workspaceId}
        AND "product_id" = ${input.productId}
        AND "occurred_at" >= ${start} AND "occurred_at" <= ${now}
        AND "visitor_hash" IS NOT NULL
    `),
  ]);

  const counts = new Map<string, number>();
  for (const row of typeRows.rows as TypeRow[]) {
    counts.set(row.type, Number(row.value));
  }

  const views =
    (counts.get("board_view") ?? 0) +
    (counts.get("request_view") ?? 0) +
    (counts.get("portal_page_view") ?? 0);

  const visitorDays = Number((visitorRows.rows[0] as { value?: number | string } | undefined)?.value ?? 0);

  return {
    days,
    from,
    to,
    visitorDays,
    pageViews: views,
    funnel: buildPortalFunnel({
      views,
      submitStarts: counts.get("submit_started") ?? 0,
      submissions: counts.get("submission") ?? 0,
    }),
    pages: (pageRows.rows as PageRow[]).map((row) => ({
      page: row.page,
      views: Number(row.value),
    })),
    topBoards: (boardRows.rows as BoardRow[]).map((row) => ({
      id: row.id,
      name: row.name,
      views: Number(row.value),
    })),
  };
}
