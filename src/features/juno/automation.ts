import "server-only";

import { and, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  conversationMessages,
  conversations,
  type ConversationSourceContext,
} from "@/db/schema/conversations";
import { junoConversations, junoSettings } from "@/db/schema/knowledge";
import { queueConversationCsatNotification } from "@/features/email/inbound";

/**
 * Auto-resolve threads Juno answered and nobody touched afterwards.
 *
 * Chat resolves after 30 minutes of silence and email after 72 hours by
 * default. A later customer reply, a team reply or a note keeps the thread out
 * of this sweep, and a resolved thread reopens normally when the customer
 * writes again (Juno then treats the new message as a fresh pickup).
 */

const SWEEP_LIMIT = 50;

export async function sweepJunoAutoResolve(input: { now?: Date } = {}): Promise<{
  checked: number;
  resolved: number;
}> {
  const now = input.now ?? new Date();

  const rows = await db
    .select({
      state: junoConversations,
      conversation: conversations,
      settings: junoSettings,
    })
    .from(junoConversations)
    .innerJoin(
      conversations,
      eq(junoConversations.conversationId, conversations.id),
    )
    .innerJoin(junoSettings, eq(junoConversations.productId, junoSettings.productId))
    .where(
      and(
        eq(junoConversations.state, "active"),
        isNotNull(junoConversations.lastJunoMessageAt),
        inArray(conversations.status, ["queue", "open"]),
      ),
    )
    .limit(SWEEP_LIMIT);

  let resolved = 0;

  for (const row of rows) {
    const lastJunoAt = row.state.lastJunoMessageAt;
    if (!lastJunoAt) continue;

    const context = (row.conversation.sourceContext ?? null) as
      | ConversationSourceContext
      | null;
    const channel = context?.channel === "email" ? "email" : "chat";
    const minutes =
      channel === "email"
        ? row.settings.autoResolveEmailMinutes
        : row.settings.autoResolveChatMinutes;

    if (minutes <= 0) continue;

    const dueAt = new Date(lastJunoAt.getTime() + minutes * 60_000);
    if (now.getTime() < dueAt.getTime()) continue;

    if (
      row.conversation.lastCustomerMessageAt &&
      row.conversation.lastCustomerMessageAt.getTime() > lastJunoAt.getTime()
    ) {
      continue;
    }

    const teamAfter = await db
      .select({ id: conversationMessages.id })
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.conversationId, row.conversation.id),
          eq(conversationMessages.authorType, "team"),
          gt(conversationMessages.createdAt, lastJunoAt),
        ),
      )
      .limit(1);
    if (teamAfter[0]) continue;

    const didResolve = await db.transaction(async (tx) => {
      const updated = await tx
        .update(conversations)
        .set({
          status: "resolved",
          resolvedAt: now,
          updatedAt: now,
          unreadForTeam: 0,
        })
        .where(
          and(
            eq(conversations.id, row.conversation.id),
            inArray(conversations.status, ["queue", "open"]),
          ),
        )
        .returning({ id: conversations.id });

      if (updated.length === 0) return false;

      await tx
        .update(junoConversations)
        .set({ state: "resolved", resolvedAt: now, updatedAt: now })
        .where(eq(junoConversations.conversationId, row.conversation.id));

      return true;
    });

    if (didResolve) {
      resolved += 1;
      await queueConversationCsatNotification({
        productId: row.conversation.productId,
        conversationId: row.conversation.id,
      }).catch((error: unknown) => {
        console.error("[juno] csat email queue failed", error);
      });
    }
  }

  return { checked: rows.length, resolved };
}

/** Count threads currently waiting on a human after a Juno handoff. */
export async function countJunoHandoffs(productId: string): Promise<number> {
  const rows = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(junoConversations)
    .where(
      and(
        eq(junoConversations.productId, productId),
        eq(junoConversations.state, "handed_off"),
      ),
    );
  return rows[0]?.value ?? 0;
}
