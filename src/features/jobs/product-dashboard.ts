import "server-only";

import { desc, sql } from "drizzle-orm";

import { db } from "@/db";
import { jobs } from "@/db/schema/jobs";

/**
 * Product-scoped operations view.
 *
 * Jobs do not expose their payload here: some payloads contain customer ids or
 * provider message ids. We filter by the product id carried in the payload and
 * return only type/status/attempt/error metadata.
 */

export type ProductJobRow = {
  id: string;
  type: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  updatedAt: string;
};

export type ProductJobDashboard = {
  counts: Record<string, number>;
  byType: Array<{ type: string; count: number }>;
  recent: ProductJobRow[];
  failed: ProductJobRow[];
};

export async function getProductJobDashboard(
  productId: string,
): Promise<ProductJobDashboard> {
  const where = sql`${jobs.payload} ->> 'productId' = ${productId}`;
  const [statusRows, typeRows, recentRows, failedRows] = await Promise.all([
    db
      .select({ status: jobs.status, count: sql<number>`count(*)::int` })
      .from(jobs)
      .where(where)
      .groupBy(jobs.status),
    db
      .select({ type: jobs.type, count: sql<number>`count(*)::int` })
      .from(jobs)
      .where(where)
      .groupBy(jobs.type),
    db
      .select({
        id: jobs.id,
        type: jobs.type,
        status: jobs.status,
        attempts: jobs.attempts,
        maxAttempts: jobs.maxAttempts,
        lastError: jobs.lastError,
        updatedAt: jobs.updatedAt,
      })
      .from(jobs)
      .where(where)
      .orderBy(desc(jobs.updatedAt))
      .limit(25),
    db
      .select({
        id: jobs.id,
        type: jobs.type,
        status: jobs.status,
        attempts: jobs.attempts,
        maxAttempts: jobs.maxAttempts,
        lastError: jobs.lastError,
        updatedAt: jobs.updatedAt,
      })
      .from(jobs)
      .where(sql`${jobs.payload} ->> 'productId' = ${productId} AND ${jobs.status} = 'failed'`)
      .orderBy(desc(jobs.updatedAt))
      .limit(10),
  ]);

  const normalize = (row: (typeof recentRows)[number]): ProductJobRow => ({
    ...row,
    updatedAt: row.updatedAt.toISOString(),
  });

  return {
    counts: Object.fromEntries(statusRows.map((row) => [row.status, row.count])),
    byType: typeRows.map((row) => ({ type: row.type, count: row.count })),
    recent: recentRows.map(normalize),
    failed: failedRows.map(normalize),
  };
}
