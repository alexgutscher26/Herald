import "server-only";

import { and, eq, gte, sql } from "drizzle-orm";

import { db } from "@/db";
import { junoAnswers, junoConversations } from "@/db/schema/knowledge";

import { getDailyBudgetStatus, type DailyBudgetStatus } from "./budget";

/**
 * The activity meter.
 *
 * Everything here is derived from the audit rows Mira already writes; there is
 * no separate counter that can drift. A handoff is an answer row with status
 * `handoff`, a resolution-without-team is a resolved Mira thread with no team
 * message after the last Mira reply, and cost comes from the daily usage rows.
 */

export type JunoHandoffBreakdown = { reason: string; count: number };

export type JunoActivity = {
  windowDays: number;
  answers: number;
  handoffs: number;
  handoffRate: number;
  resolved: number;
  resolvedWithoutTeam: number;
  resolvedWithoutTeamShare: number;
  costCents: number;
  costPerResolvedCents: number;
  handoffReasons: JunoHandoffBreakdown[];
  /** Today's budget, including the persisted 80% alert. */
  dailyBudget: DailyBudgetStatus;
};

export async function getJunoActivity(
  productId: string,
  input: { now?: Date; days?: number } = {},
): Promise<JunoActivity> {
  const now = input.now ?? new Date();
  const days = Math.min(Math.max(Math.trunc(input.days ?? 30), 1), 365);
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const [answerRows, reasonRows, resolvedRows, costRows, dailyBudget] = await Promise.all([
    db
      .select({
        status: junoAnswers.status,
        count: sql<number>`count(*)::int`,
      })
      .from(junoAnswers)
      .where(
        and(eq(junoAnswers.productId, productId), gte(junoAnswers.createdAt, since)),
      )
      .groupBy(junoAnswers.status),
    db
      .select({
        reason: sql<string>`coalesce(${junoAnswers.handoffReason}, 'unknown')`,
        count: sql<number>`count(*)::int`,
      })
      .from(junoAnswers)
      .where(
        and(
          eq(junoAnswers.productId, productId),
          eq(junoAnswers.status, "handoff"),
          gte(junoAnswers.createdAt, since),
        ),
      )
      .groupBy(sql`coalesce(${junoAnswers.handoffReason}, 'unknown')`),
    db
      .select({
        resolved: sql<number>`count(*)::int`,
        withoutTeam: sql<number>`count(*) filter (where not exists (
          select 1 from "conversation_messages" m
          where m."conversation_id" = ${junoConversations.conversationId}
            and m."author_type" = 'team'
            and m."created_at" > coalesce(
              ${junoConversations.lastJunoMessageAt},
              ${junoConversations.createdAt}
            )
        ))::int`,
      })
      .from(junoConversations)
      .where(
        and(
          eq(junoConversations.productId, productId),
          eq(junoConversations.state, "resolved"),
          gte(junoConversations.resolvedAt, since),
        ),
      ),
    db.execute(sql`
      SELECT coalesce(sum("cost_cents"), 0)::int AS "costCents"
      FROM "juno_usage"
      WHERE "product_id" = ${productId}
        AND "day" >= ${since.toISOString().slice(0, 10)}
    `),
    getDailyBudgetStatus(productId, now),
  ]);

  const byStatus = new Map(answerRows.map((row) => [row.status, row.count]));
  const answers = [...byStatus.values()].reduce((sum, value) => sum + value, 0);
  const handoffs = byStatus.get("handoff") ?? 0;
  const resolved = resolvedRows[0]?.resolved ?? 0;
  const resolvedWithoutTeam = resolvedRows[0]?.withoutTeam ?? 0;
  const costCents = Number(
    (costRows.rows[0] as { costCents?: number } | undefined)?.costCents ?? 0,
  );

  return {
    windowDays: days,
    answers,
    handoffs,
    handoffRate: answers > 0 ? handoffs / answers : 0,
    resolved,
    resolvedWithoutTeam,
    resolvedWithoutTeamShare: resolved > 0 ? resolvedWithoutTeam / resolved : 0,
    costCents,
    costPerResolvedCents: resolved > 0 ? Math.round(costCents / resolved) : 0,
    handoffReasons: reasonRows
      .map((row) => ({ reason: row.reason, count: row.count }))
      .sort((a, b) => b.count - a.count),
    dailyBudget,
  };
}
