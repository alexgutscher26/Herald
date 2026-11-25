import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { junoSettings, junoUsage } from "@/db/schema/knowledge";

import { budgetAlertThreshold } from "./budget-policy";

/**
 * The shared daily AI budget.
 *
 * Every Mira path that spends money (answers, tagging, evaluation) asks this
 * module before calling a provider and records the estimated cost in the same
 * transaction as its result. A budget of zero disables paid generation
 * entirely; callers turn that into a handoff or a skipped job rather than a
 * silent downgrade.
 */

export type BudgetDecision =
  | { allowed: true; spentCents: number; limitCents: number }
  | { allowed: false; spentCents: number; limitCents: number };

export function usageDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export async function getDailySpend(
  productId: string,
  now: Date,
): Promise<{ spentCents: number; limitCents: number; alertedAt: Date | null }> {
  const [settingsRows, usageRows] = await Promise.all([
    db
      .select({ budget: junoSettings.dailyBudgetCents })
      .from(junoSettings)
      .where(eq(junoSettings.productId, productId))
      .limit(1),
    db
      .select({ costCents: junoUsage.costCents, alertedAt: junoUsage.alertedAt })
      .from(junoUsage)
      .where(and(eq(junoUsage.productId, productId), eq(junoUsage.day, usageDay(now))))
      .limit(1),
  ]);

  return {
    spentCents: usageRows[0]?.costCents ?? 0,
    limitCents: settingsRows[0]?.budget ?? 0,
    alertedAt: usageRows[0]?.alertedAt ?? null,
  };
}

export type DailyBudgetStatus = {
  spentCents: number;
  limitCents: number;
  /** 80% threshold in cents; null when the budget is disabled. */
  thresholdCents: number | null;
  percent: number;
  alertedAt: Date | null;
};

/** The alert state for today, used by the Mira activity card. */
export async function getDailyBudgetStatus(
  productId: string,
  now: Date,
): Promise<DailyBudgetStatus> {
  const { spentCents, limitCents, alertedAt } = await getDailySpend(productId, now);
  return {
    spentCents,
    limitCents,
    thresholdCents: budgetAlertThreshold(limitCents),
    percent:
      limitCents > 0
        ? Math.min(100, Math.round((spentCents / limitCents) * 100))
        : 0,
    alertedAt,
  };
}

export async function checkBudget(input: {
  productId: string;
  costCents: number;
  now: Date;
}): Promise<BudgetDecision> {
  const { spentCents, limitCents } = await getDailySpend(input.productId, input.now);
  if (limitCents <= 0 || spentCents + input.costCents > limitCents) {
    return { allowed: false, spentCents, limitCents };
  }
  return { allowed: true, spentCents, limitCents };
}

type Executor = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Record one estimated spend; a zero-cost local run still counts a request.
 *
 * When `dailyLimitCents` is supplied, the row also records the first moment the
 * day crossed 80% of that limit. The alert is part of the same atomic upsert, so
 * two concurrent answers cannot both miss it, and it is written even when the
 * request later fails to produce an answer.
 */
export async function recordAiUsage(
  executor: Executor,
  input: {
    productId: string;
    now: Date;
    costCents: number;
    dailyLimitCents?: number;
  },
): Promise<void> {
  const cost = Math.max(0, input.costCents);
  const limit = Math.max(0, input.dailyLimitCents ?? 0);
  const alertThreshold = budgetAlertThreshold(limit);
  const threshold = alertThreshold ?? 2_147_483_647;

  await executor
    .insert(junoUsage)
    .values({
      productId: input.productId,
      day: usageDay(input.now),
      requests: 1,
      costCents: cost,
      alertedAt:
        alertThreshold !== null && cost >= alertThreshold ? input.now : null,
    })
    .onConflictDoUpdate({
      target: [junoUsage.productId, junoUsage.day],
      set: {
        requests: sql`${junoUsage.requests} + 1`,
        costCents: sql`${junoUsage.costCents} + ${cost}`,
        alertedAt: sql`CASE
          WHEN ${junoUsage.alertedAt} IS NULL
            AND ${junoUsage.costCents} + ${cost} >= ${threshold}
          THEN ${input.now}
          ELSE ${junoUsage.alertedAt}
        END`,
      },
    });
}
