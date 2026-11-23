import "server-only";

import { createHmac } from "node:crypto";

import { and, count, desc, gte, sql } from "drizzle-orm";

import { db } from "@/db";
import { dashboardViewEvents } from "@/db/schema/observability";
import { getServerEnv } from "@/lib/env";
import { logEvent, serializeError } from "@/lib/logger";

/**
 * Dashboard product analytics.
 *
 * The question is narrow: which settings sections do teammates actually open?
 * The answer must not turn into behavioural profiling, so this module stores:
 *
 *  - a fixed surface (`workspace_settings` or `product_settings`);
 *  - a fixed section slug from the server-owned list;
 *  - the workspace (and product, for product settings);
 *  - a keyed, one-way actor reference used only for distinct-people counts.
 *
 * It never stores page content, form values, routes with ids, IP addresses,
 * user agents, referrers or the raw user id. See
 * docs/dashboard-analytics-privacy.md for the review and retention decision.
 */

export const DASHBOARD_SURFACES = ["workspace_settings", "product_settings"] as const;
export type DashboardSurface = (typeof DASHBOARD_SURFACES)[number];

const SECTION_PATTERN = /^[a-z0-9][a-z0-9-]{0,59}$/;
export const MAX_SECTIONS_PER_EVENT = 20;

export function isDashboardSurface(value: unknown): value is DashboardSurface {
  return (
    typeof value === "string" &&
    (DASHBOARD_SURFACES as readonly string[]).includes(value)
  );
}

export function normalizeSections(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const unique = new Set<string>();
  for (const value of input) {
    if (typeof value !== "string") continue;
    const section = value.trim().toLowerCase();
    if (SECTION_PATTERN.test(section)) unique.add(section);
    if (unique.size >= MAX_SECTIONS_PER_EVENT) break;
  }
  return [...unique];
}

/**
 * Pseudo-anonymous actor reference.
 *
 * A keyed hash is stable per user across events (so "3 people" is possible) but
 * is not reversible from the table without the deployment secret and cannot be
 * joined to a Better Auth user id by an analyst. The prefix prevents reuse of
 * the same hash in another context.
 */
export function dashboardActorRef(
  userId: string,
  secret: string = getServerEnv().BETTER_AUTH_SECRET,
): string {
  return createHmac("sha256", secret)
    .update(`dashboard-view:${userId}`)
    .digest("hex")
    .slice(0, 32);
}

export async function recordDashboardViews(input: {
  workspaceId: string;
  productId?: string | null;
  userId: string;
  surface: DashboardSurface;
  sections: string[];
}): Promise<number> {
  const sections = normalizeSections(input.sections);
  if (sections.length === 0) return 0;

  const actorRef = dashboardActorRef(input.userId);
  try {
    const inserted = await db
      .insert(dashboardViewEvents)
      .values(
        sections.map((section) => ({
          workspaceId: input.workspaceId,
          productId: input.productId ?? null,
          surface: input.surface,
          section,
          actorRef,
        })),
      )
      .returning({ id: dashboardViewEvents.id });
    return inserted.length;
  } catch (error) {
    // Analytics is best-effort: a failed write must never block settings.
    logEvent("warn", "dashboard_view.record_failed", {
      surface: input.surface,
      error: serializeError(error),
    });
    return 0;
  }
}

export type DashboardViewRow = {
  surface: string;
  section: string;
  views: number;
  people: number;
};

export async function getDashboardViewSummary(input: {
  days?: number;
  limit?: number;
  now?: Date;
} = {}): Promise<DashboardViewRow[]> {
  const now = input.now ?? new Date();
  const days = Math.min(Math.max(Math.trunc(input.days ?? 30), 1), 365);
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 20), 1), 100);
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  try {
    const rows = await db
      .select({
        surface: dashboardViewEvents.surface,
        section: dashboardViewEvents.section,
        views: sql<number>`count(*)::int`,
        people: sql<number>`count(distinct ${dashboardViewEvents.actorRef})::int`,
      })
      .from(dashboardViewEvents)
      .where(gte(dashboardViewEvents.createdAt, since))
      .groupBy(dashboardViewEvents.surface, dashboardViewEvents.section)
      .orderBy(desc(sql`count(*)`))
      .limit(limit);
    return rows;
  } catch (error) {
    logEvent("warn", "dashboard_view.summary_failed", {
      error: serializeError(error),
    });
    return [];
  }
}

/** Total events in the window, for the header on the internal dashboard. */
export async function countDashboardViews(days = 30, now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  try {
    const rows = await db
      .select({ total: count() })
      .from(dashboardViewEvents)
      .where(and(gte(dashboardViewEvents.createdAt, since)));
    return Number(rows[0]?.total ?? 0);
  } catch {
    return 0;
  }
}
