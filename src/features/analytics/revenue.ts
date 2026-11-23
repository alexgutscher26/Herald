import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { workspaceSubscriptions } from "@/db/schema/billing";
import { PLANS, PLAN_PRICING, toPlanId, type PlanId } from "@/features/entitlements/plans";

/**
 * Workspace revenue from the local billing mirror.
 *
 * MRR uses the plan catalogue's monthly display price; Stripe remains the
 * source of truth for what is actually charged. Lifetime is excluded because it
 * is a one-time payment, not recurring revenue.
 *
 * Churn and expansion are changes recorded in the last 30 days. Expansion and
 * contraction require the webhook to have recorded a plan change; subscriptions
 * created before that column existed simply have no movement to report.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export type RevenueMovement = {
  workspaceCount: number;
  mrr: number;
};

export type RevenueAnalytics = {
  mrr: number;
  active: number;
  trialing: number;
  churn: RevenueMovement;
  expansion: RevenueMovement;
  contraction: RevenueMovement;
  planMix: Array<{ plan: PlanId; name: string; count: number; mrr: number }>;
};

function monthlyPrice(plan: PlanId): number {
  return plan === "lifetime" ? 0 : PLAN_PRICING[plan].monthly;
}

export async function getRevenueAnalytics(workspaceId: string): Promise<RevenueAnalytics> {
  const rows = await db
    .select()
    .from(workspaceSubscriptions)
    .where(eq(workspaceSubscriptions.workspaceId, workspaceId));
  const since = Date.now() - 30 * DAY_MS;
  const active = rows.filter(
    (row) => row.status === "active" || row.status === "trialing",
  );

  let mrr = 0;
  const mix = new Map<PlanId, { count: number; mrr: number }>();
  for (const row of active) {
    const plan = toPlanId(row.plan);
    const price = monthlyPrice(plan);
    mrr += price;
    const entry = mix.get(plan) ?? { count: 0, mrr: 0 };
    entry.count += 1;
    entry.mrr += price;
    mix.set(plan, entry);
  }

  const churnRows = rows.filter(
    (row) =>
      (row.status === "canceled" || row.status === "past_due" || row.status === "unpaid") &&
      row.updatedAt.getTime() >= since,
  );
  const expansionRows = rows.filter((row) => {
    if (!row.previousPlan || !row.planChangedAt) return false;
    if (row.planChangedAt.getTime() < since) return false;
    if (row.status !== "active" && row.status !== "trialing") return false;
    return monthlyPrice(toPlanId(row.plan)) > monthlyPrice(toPlanId(row.previousPlan));
  });
  const contractionRows = rows.filter((row) => {
    if (!row.previousPlan || !row.planChangedAt) return false;
    if (row.planChangedAt.getTime() < since) return false;
    if (row.status !== "active" && row.status !== "trialing") return false;
    return monthlyPrice(toPlanId(row.plan)) < monthlyPrice(toPlanId(row.previousPlan));
  });

  return {
    mrr,
    active: rows.filter((row) => row.status === "active").length,
    trialing: rows.filter((row) => row.status === "trialing").length,
    churn: {
      workspaceCount: churnRows.length,
      mrr: churnRows.reduce((sum, row) => sum + monthlyPrice(toPlanId(row.plan)), 0),
    },
    expansion: {
      workspaceCount: expansionRows.length,
      mrr: expansionRows.reduce(
        (sum, row) =>
          sum +
          monthlyPrice(toPlanId(row.plan)) -
          monthlyPrice(toPlanId(row.previousPlan!)),
        0,
      ),
    },
    contraction: {
      workspaceCount: contractionRows.length,
      mrr: contractionRows.reduce(
        (sum, row) =>
          sum +
          monthlyPrice(toPlanId(row.previousPlan!)) -
          monthlyPrice(toPlanId(row.plan)),
        0,
      ),
    },
    planMix: [...mix.entries()]
      .map(([plan, entry]) => ({
        plan,
        name: PLANS[plan].name,
        ...entry,
      }))
      .sort((left, right) => right.mrr - left.mrr),
  };
}
