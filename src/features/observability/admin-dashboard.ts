import "server-only";

import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";

import { db } from "@/db";
import { jobRuns, jobs } from "@/db/schema/jobs";
import { notificationDeliveries } from "@/db/schema/notifications";
import {
  aiUsageEvents,
  backupVerifications,
  requestMetrics,
} from "@/db/schema/observability";
import { webhookDeliveries } from "@/db/schema/webhooks";
import {
  getDashboardViewSummary,
  type DashboardViewRow,
} from "@/features/analytics/dashboard-views";
import { getStorage } from "@/features/storage";
import { getCostRates, type CostRates } from "@/lib/observability/config";
import { estimateMonthlyCost, type CostEstimate } from "@/lib/observability/cost";
import { getReleaseInfo } from "@/lib/observability/release";

/**
 * Internal operations dashboard.
 *
 * Aggregate counts only. There is deliberately no query that selects a
 * workspace name, product name, member email, customer record, job payload or
 * error text: a deployment operator needs to know whether the system is
 * healthy, not what a tenant wrote.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export type AdminSlowRoute = {
  route: string;
  method: string;
  requests: number;
  avgMs: number;
  maxMs: number;
};

export type AdminDashboard = {
  generatedAt: string;
  release: string;
  environment: string;
  tenants: {
    workspaces: number;
    products: number;
    users: number;
    customers: number;
  };
  jobs: {
    pending: number;
    running: number;
    failed: number;
    succeeded: number;
    failed24h: number;
    overdue: number;
    oldestDueMinutes: number | null;
    runs30m: number;
    runFailures30m: number;
  };
  http: {
    requests15m: number;
    errors15m: number;
    errorRatePct: number;
    slowRoutes: AdminSlowRoute[];
  };
  email: {
    sent24h: number;
    failed24h: number;
    bounced24h: number;
    complained24h: number;
    bounceRatePct: number;
    sent30d: number;
  };
  webhooks: {
    succeeded24h: number;
    failed24h: number;
    failureRatePct: number;
  };
  ai: {
    promptTokens24h: number;
    completionTokens24h: number;
    cost24hUsd: number;
    cost30dUsd: number;
  };
  storage: {
    ok: boolean;
    objects: number;
    bytes: number;
  };
  database: {
    bytes: number;
    migrations: number | null;
  };
  backups: Array<{
    kind: string;
    status: string;
    checkedAt: string;
    ageHours: number;
  }>;
  dashboardViews: {
    total: number;
    top: DashboardViewRow[];
  };
  costs: CostEstimate & { rates: CostRates };
};

function percentage(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 10_000) / 100;
}

let storageSnapshot: {
  at: number;
  ok: boolean;
  objects: number;
  bytes: number;
} | null = null;

async function getStorageSnapshot(now: Date): Promise<{
  ok: boolean;
  objects: number;
  bytes: number;
}> {
  if (storageSnapshot && now.getTime() - storageSnapshot.at < MINUTE) {
    return storageSnapshot;
  }

  try {
    const objects = await getStorage().list();
    storageSnapshot = {
      at: now.getTime(),
      ok: true,
      objects: objects.length,
      bytes: objects.reduce((sum, object) => sum + object.byteSize, 0),
    };
  } catch {
    storageSnapshot = { at: now.getTime(), ok: false, objects: 0, bytes: 0 };
  }
  return storageSnapshot;
}

async function scalar(statement: ReturnType<typeof sql>): Promise<number | null> {
  try {
    const result = await db.execute(statement);
    const row = (result as { rows?: Record<string, unknown>[] }).rows?.[0];
    const value = Number(row?.value ?? NaN);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export async function getAdminDashboard(now = new Date()): Promise<AdminDashboard> {
  const since15 = new Date(now.getTime() - 15 * MINUTE);
  const since30m = new Date(now.getTime() - 30 * MINUTE);
  const since24h = new Date(now.getTime() - 24 * HOUR);
  const since30d = new Date(now.getTime() - 30 * DAY);
  const overdueCutoff = new Date(now.getTime() - 10 * MINUTE);
  const release = getReleaseInfo();
  const rates = getCostRates();

  const [
    workspaceCount,
    productCount,
    userCount,
    customerCount,
    jobGroups,
    failedJobs24h,
    oldestDue,
    overdueJobs,
    jobRunTotals,
    requestGroups,
    slowRoutes,
    emailGroups,
    sent30dRows,
    webhookGroups,
    ai24,
    ai30,
    backupRows,
    databaseBytes,
    migrations,
    viewsTotal,
    viewsTop,
    storage,
  ] = await Promise.all([
    scalar(sql`select count(*)::int as value from workspaces`),
    scalar(sql`select count(*)::int as value from products`),
    scalar(sql`select count(*)::int as value from "user"`),
    scalar(sql`select count(*)::int as value from customers`),
    db
      .select({ status: jobs.status, total: sql<number>`count(*)::int` })
      .from(jobs)
      .groupBy(jobs.status),
    scalar(
      sql`select count(*)::int as value from jobs where status = 'failed' and updated_at >= ${since24h}`,
    ),
    db
      .select({ runAt: jobs.runAt })
      .from(jobs)
      .where(and(eq(jobs.status, "pending"), lt(jobs.runAt, now)))
      .orderBy(asc(jobs.runAt))
      .limit(1),
    scalar(
      sql`select count(*)::int as value from jobs where status = 'pending' and run_at < ${overdueCutoff}`,
    ),
    db
      .select({
        claimed: sql<number>`coalesce(sum(${jobRuns.claimed}), 0)::int`,
        failed: sql<number>`coalesce(sum(${jobRuns.failed}), 0)::int`,
      })
      .from(jobRuns)
      .where(gte(jobRuns.startedAt, since30m)),
    db
      .select({
        statusClass: requestMetrics.statusClass,
        requests: sql<number>`coalesce(sum(${requestMetrics.count}), 0)::int`,
      })
      .from(requestMetrics)
      .where(gte(requestMetrics.bucketStart, since15))
      .groupBy(requestMetrics.statusClass),
    db
      .select({
        route: requestMetrics.route,
        method: requestMetrics.method,
        requests: sql<number>`sum(${requestMetrics.count})::int`,
        avgMs: sql<number>`round(avg(case when ${requestMetrics.count} > 0 then ${requestMetrics.totalMs}::float8 / ${requestMetrics.count} else 0 end))::int`,
        maxMs: sql<number>`max(${requestMetrics.maxMs})::int`,
      })
      .from(requestMetrics)
      .where(gte(requestMetrics.bucketStart, since24h))
      .groupBy(requestMetrics.route, requestMetrics.method)
      .orderBy(desc(sql`max(${requestMetrics.maxMs})`))
      .limit(5),
    db
      .select({
        status: notificationDeliveries.status,
        total: sql<number>`count(*)::int`,
      })
      .from(notificationDeliveries)
      .where(gte(notificationDeliveries.createdAt, since24h))
      .groupBy(notificationDeliveries.status),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.status, "sent"),
          gte(notificationDeliveries.createdAt, since30d),
        ),
      ),
    db
      .select({
        status: webhookDeliveries.status,
        total: sql<number>`count(*)::int`,
      })
      .from(webhookDeliveries)
      .where(gte(webhookDeliveries.createdAt, since24h))
      .groupBy(webhookDeliveries.status),
    db
      .select({
        prompt: sql<number>`coalesce(sum(${aiUsageEvents.promptTokens}), 0)::int`,
        completion: sql<number>`coalesce(sum(${aiUsageEvents.completionTokens}), 0)::int`,
        cost: sql<number>`coalesce(sum(${aiUsageEvents.estimatedCostMicros}), 0)::float8 / 1000000`,
      })
      .from(aiUsageEvents)
      .where(gte(aiUsageEvents.createdAt, since24h)),
    db
      .select({
        cost: sql<number>`coalesce(sum(${aiUsageEvents.estimatedCostMicros}), 0)::float8 / 1000000`,
      })
      .from(aiUsageEvents)
      .where(gte(aiUsageEvents.createdAt, since30d)),
    db
      .select({
        kind: backupVerifications.kind,
        status: backupVerifications.status,
        checkedAt: backupVerifications.checkedAt,
      })
      .from(backupVerifications)
      .orderBy(desc(backupVerifications.checkedAt))
      .limit(9),
    scalar(sql`select pg_database_size(current_database())::float8 as value`),
    scalar(sql`select count(*)::int as value from drizzle.__drizzle_migrations`),
    scalar(sql`select count(*)::int as value from dashboard_view_events where created_at >= ${since30d}`),
    getDashboardViewSummary({ days: 30, limit: 10, now }),
    getStorageSnapshot(now),
  ]);

  const jobByStatus = new Map(jobGroups.map((row) => [row.status, row.total]));
  const requestByClass = new Map(requestGroups.map((row) => [row.statusClass, row.requests]));
  const requests15m = requestGroups.reduce((sum, row) => sum + row.requests, 0);
  const errors15m = requestByClass.get("5xx") ?? 0;

  const emailByStatus = new Map(emailGroups.map((row) => [row.status, row.total]));
  const sent24h = emailByStatus.get("sent") ?? 0;
  const failed24h = emailByStatus.get("failed") ?? 0;
  const bounced24h = emailByStatus.get("bounced") ?? 0;
  const complained24h = emailByStatus.get("complained") ?? 0;

  const webhookByStatus = new Map(webhookGroups.map((row) => [row.status, row.total]));
  const webhookSucceeded = webhookByStatus.get("succeeded") ?? 0;
  const webhookFailed = webhookByStatus.get("failed") ?? 0;

  const ai24Row = ai24[0];
  const ai30Cost = ai30[0]?.cost ?? 0;
  const databaseBytesValue = databaseBytes ?? 0;
  const emailsLast30Days = sent30dRows[0]?.total ?? 0;

  const costs = estimateMonthlyCost({
    databaseBytes: databaseBytesValue,
    storageBytes: storage.bytes,
    emailsLast30Days,
    aiCost30dUsd: ai30Cost,
    rates,
  });

  return {
    generatedAt: now.toISOString(),
    release: release.release,
    environment: release.environment,
    tenants: {
      workspaces: workspaceCount ?? 0,
      products: productCount ?? 0,
      users: userCount ?? 0,
      customers: customerCount ?? 0,
    },
    jobs: {
      pending: jobByStatus.get("pending") ?? 0,
      running: jobByStatus.get("running") ?? 0,
      failed: jobByStatus.get("failed") ?? 0,
      succeeded: jobByStatus.get("succeeded") ?? 0,
      failed24h: failedJobs24h ?? 0,
      overdue: overdueJobs ?? 0,
      oldestDueMinutes:
        oldestDue[0] === undefined
          ? null
          : Math.max(0, Math.round((now.getTime() - oldestDue[0].runAt.getTime()) / MINUTE)),
      runs30m: jobRunTotals[0]?.claimed ?? 0,
      runFailures30m: jobRunTotals[0]?.failed ?? 0,
    },
    http: {
      requests15m,
      errors15m,
      errorRatePct: percentage(errors15m, requests15m),
      slowRoutes: slowRoutes.map((row) => ({
        route: row.route,
        method: row.method,
        requests: row.requests,
        avgMs: row.avgMs,
        maxMs: row.maxMs,
      })),
    },
    email: {
      sent24h,
      failed24h,
      bounced24h,
      complained24h,
      bounceRatePct: percentage(
        bounced24h + complained24h,
        sent24h + bounced24h + complained24h,
      ),
      sent30d: emailsLast30Days,
    },
    webhooks: {
      succeeded24h: webhookSucceeded,
      failed24h: webhookFailed,
      failureRatePct: percentage(webhookFailed, webhookSucceeded + webhookFailed),
    },
    ai: {
      promptTokens24h: ai24Row?.prompt ?? 0,
      completionTokens24h: ai24Row?.completion ?? 0,
      cost24hUsd: Math.round((ai24Row?.cost ?? 0) * 100) / 100,
      cost30dUsd: Math.round(ai30Cost * 100) / 100,
    },
    storage,
    database: {
      bytes: databaseBytesValue,
      migrations: migrations ?? null,
    },
    backups: backupRows.map((row) => ({
      kind: row.kind,
      status: row.status,
      checkedAt: row.checkedAt.toISOString(),
      ageHours:
        Math.round(((now.getTime() - row.checkedAt.getTime()) / HOUR) * 10) / 10,
    })),
    dashboardViews: {
      total: viewsTotal ?? 0,
      top: viewsTop,
    },
    costs: { ...costs, rates },
  };
}
