import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { conversations } from "@/db/schema/conversations";
import { junoKnowledgeTasks } from "@/db/schema/knowledge";

/**
 * Knowledge-gap tasks created by a thumbs-down.
 *
 * This is a small to-do list, not a ticketing system: open tasks point at the
 * conversation and the already-redacted question, and a manager can mark one
 * done after adding or fixing the source.
 */

export type JunoKnowledgeTaskRow = {
  id: string;
  question: string;
  conversationId: string;
  conversationSubject: string;
  createdAt: string;
};

export async function listOpenKnowledgeTasks(
  productId: string,
): Promise<JunoKnowledgeTaskRow[]> {
  const rows = await db
    .select({
      id: junoKnowledgeTasks.id,
      question: junoKnowledgeTasks.question,
      conversationId: junoKnowledgeTasks.conversationId,
      conversationSubject: conversations.subject,
      createdAt: junoKnowledgeTasks.createdAt,
    })
    .from(junoKnowledgeTasks)
    .innerJoin(
      conversations,
      and(
        eq(junoKnowledgeTasks.conversationId, conversations.id),
        eq(junoKnowledgeTasks.productId, conversations.productId),
      ),
    )
    .where(
      and(
        eq(junoKnowledgeTasks.productId, productId),
        eq(junoKnowledgeTasks.status, "open"),
      ),
    )
    .orderBy(desc(junoKnowledgeTasks.createdAt))
    .limit(50);

  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function completeKnowledgeTask(input: {
  productId: string;
  taskId: string;
  userId: string;
  now?: Date;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const updated = await db
    .update(junoKnowledgeTasks)
    .set({
      status: "done",
      completedBy: input.userId,
      completedAt: input.now ?? new Date(),
    })
    .where(
      and(
        eq(junoKnowledgeTasks.id, input.taskId),
        eq(junoKnowledgeTasks.productId, input.productId),
        eq(junoKnowledgeTasks.status, "open"),
      ),
    )
    .returning({ id: junoKnowledgeTasks.id });

  return updated[0]
    ? { ok: true }
    : { ok: false, error: "That task is already done or no longer exists." };
}
