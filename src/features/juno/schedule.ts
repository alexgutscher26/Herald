import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { conversations } from "@/db/schema/conversations";
import { junoConversations, junoSettings } from "@/db/schema/knowledge";
import { enqueueJob } from "@/features/jobs/queue";
import { logEvent, serializeError } from "@/lib/logger";

/**
 * Queue one Juno pickup.
 *
 * Enqueuing happens after the message transaction commits, never inside it, so
 * a rolled-back webhook cannot leave a job pointing at a message that does not
 * exist. The job id is derived from the customer message id, so a provider
 * retry of the same email cannot generate a second answer.
 */

export async function scheduleJunoAnswer(input: {
  conversationId: string;
  messageId?: string | null | undefined;
  now?: Date | undefined;
}): Promise<{ scheduled: boolean; reason?: string }> {
  const rows = await db
    .select({
      productId: conversations.productId,
      enabled: junoSettings.enabled,
      state: junoConversations.state,
    })
    .from(conversations)
    .leftJoin(junoSettings, eq(junoSettings.productId, conversations.productId))
    .leftJoin(
      junoConversations,
      eq(junoConversations.conversationId, conversations.id),
    )
    .where(eq(conversations.id, input.conversationId))
    .limit(1);

  const row = rows[0];
  if (!row) return { scheduled: false, reason: "missing" };
  if (!row.enabled) return { scheduled: false, reason: "disabled" };
  if (row.state === "paused" || row.state === "handed_off") {
    return { scheduled: false, reason: "state" };
  }

  const dedupeKey =
    input.messageId && input.messageId !== ""
      ? `juno-answer:${input.messageId}`
      : `juno-answer:${input.conversationId}:${(input.now ?? new Date()).getTime()}`;

  try {
    await enqueueJob({
      type: "juno_answer",
      payload: { conversationId: input.conversationId },
      dedupeKey,
    });
    return { scheduled: true };
  } catch (error) {
    // A queue outage must never fail the customer's message; the thread stays
    // in Queue for a human.
    logEvent("error", "juno.schedule_failed", { error: serializeError(error) });
    return { scheduled: false, reason: "queue" };
  }
}

/**
 * Queue the auto-resolve sweep, but only when a thread is actually waiting on
 * it. Cron runs frequently; an empty workspace should not accumulate jobs.
 */
export async function scheduleJunoAutoResolve(
  now: Date = new Date(),
): Promise<{ scheduled: boolean }> {
  const active = await db
    .select({ id: junoConversations.conversationId })
    .from(junoConversations)
    .where(eq(junoConversations.state, "active"))
    .limit(1);
  if (!active[0]) return { scheduled: false };

  try {
    await enqueueJob({
      type: "juno_auto_resolve",
      dedupeKey: `juno-auto-resolve:${now.toISOString().slice(0, 16)}`,
    });
    return { scheduled: true };
  } catch (error) {
    logEvent("error", "juno.sweep_schedule_failed", { error: serializeError(error) });
    return { scheduled: false };
  }
}

export async function handToJuno(input: {
  productId: string;
  conversationId: string;
  userId: string;
  now?: Date;
}): Promise<{ ok: true; data: { state: "active" } } | { ok: false; error: string }> {
  const now = input.now ?? new Date();

  const exists = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, input.conversationId),
        eq(conversations.productId, input.productId),
      ),
    )
    .limit(1);
  if (!exists[0]) return { ok: false, error: "That conversation no longer exists." };

  await db
    .insert(junoConversations)
    .values({
      conversationId: input.conversationId,
      productId: input.productId,
      state: "active",
      handoffReason: null,
      resolvedAt: null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: junoConversations.conversationId,
      set: {
        state: "active",
        handoffReason: null,
        resolvedAt: null,
        updatedAt: now,
      },
    });

  await enqueueJob({
    type: "juno_answer",
    payload: { conversationId: input.conversationId },
    dedupeKey: `juno-answer:manual:${input.conversationId}:${now.getTime()}`,
  }).catch((error) => {
    logEvent("error", "juno.schedule_failed", { error: serializeError(error) });
  });

  return { ok: true, data: { state: "active" } };
}
