import "server-only";

import { and, asc, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { boards } from "@/db/schema/boards";
import { conversationMessages, conversations } from "@/db/schema/conversations";
import { customers } from "@/db/schema/customers";
import { feedbackPosts } from "@/db/schema/feedback";
import { feedbackInsights } from "@/db/schema/feedback-extensions";

import type { ServiceResult } from "./service";

/**
 * Conversation → feedback request handoff.
 *
 * The request is authored by the conversation's customer, with the same title
 * and body already on screen, so nobody retypes context. A team-only internal
 * note records the handoff in the thread, and the customer's request history
 * (already shown on the thread) links to it without a second table.
 */

/**
 * Attach one support message to a request that already exists.
 *
 * "Create request" is the right move for a new problem. Repeating it for every
 * customer who reports the same one is not: this path records the message as
 * evidence (source `support`, the conversation as `source_ref`) so the count of
 * people asking grows without a duplicate request and without copying the
 * thread into the dashboard.
 */
export async function linkConversationMessageToRequest(input: {
  productId: string;
  conversationId: string;
  messageId: string;
  postId: string;
  userId: string;
  now?: Date;
}): Promise<ServiceResult<{ insightId: string }>> {
  const now = input.now ?? new Date();

  const rows = await db
    .select({
      conversationId: conversations.id,
      customerId: conversations.customerId,
      customerName: customers.name,
    })
    .from(conversations)
    .innerJoin(customers, eq(conversations.customerId, customers.id))
    .where(
      and(
        eq(conversations.id, input.conversationId),
        eq(conversations.productId, input.productId),
      ),
    )
    .limit(1);

  const conversation = rows[0];
  if (!conversation) {
    return { ok: false, error: "That conversation no longer exists." };
  }

  const messageRows = await db
    .select({ body: conversationMessages.body })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.id, input.messageId),
        eq(conversationMessages.conversationId, conversation.conversationId),
        eq(conversationMessages.productId, input.productId),
        eq(conversationMessages.authorType, "customer"),
        eq(conversationMessages.kind, "message"),
      ),
    )
    .limit(1);

  const quote = messageRows[0]?.body.trim().slice(0, 2_000) ?? "";
  if (quote.length < 3) {
    return { ok: false, error: "Choose a customer message with something to quote." };
  }

  return db.transaction(async (tx) => {
    const postRows = await tx
      .select({ id: feedbackPosts.id, title: feedbackPosts.title })
      .from(feedbackPosts)
      .where(
        and(
          eq(feedbackPosts.id, input.postId),
          eq(feedbackPosts.productId, input.productId),
        ),
      )
      .limit(1);

    const post = postRows[0];
    if (!post) {
      return { ok: false as const, error: "That request no longer exists." };
    }

    // Attaching the same message twice is a no-op: evidence should not grow
    // just because someone clicked again.
    const already = await tx
      .select({ id: feedbackInsights.id })
      .from(feedbackInsights)
      .where(
        and(
          eq(feedbackInsights.productId, input.productId),
          eq(feedbackInsights.feedbackPostId, post.id),
          eq(feedbackInsights.sourceRef, conversation.conversationId),
          eq(feedbackInsights.quote, quote),
        ),
      )
      .limit(1);
    if (already[0]) {
      return { ok: true as const, data: { insightId: already[0].id } };
    }

    const inserted = await tx
      .insert(feedbackInsights)
      .values({
        productId: input.productId,
        feedbackPostId: post.id,
        source: "support",
        sourceRef: conversation.conversationId,
        quote,
        authorCustomerId: conversation.customerId,
        authorLabel: conversation.customerName,
        occurredAt: now,
        createdBy: input.userId,
      })
      .returning({ id: feedbackInsights.id });

    const insight = inserted[0];
    if (!insight) {
      return { ok: false as const, error: "Could not attach that message." };
    }

    await tx.insert(conversationMessages).values({
      conversationId: conversation.conversationId,
      productId: input.productId,
      authorType: "team",
      authorUserId: input.userId,
      kind: "note",
      body: `Linked this message to feedback request: ${post.title}`,
      createdAt: now,
    });

    await tx
      .update(conversations)
      .set({ updatedAt: now })
      .where(eq(conversations.id, conversation.conversationId));

    return { ok: true as const, data: { insightId: insight.id } };
  });
}

export async function createRequestFromConversation(input: {
  productId: string;
  conversationId: string;
  userId: string;
  boardId: string;
  title?: string | null;
  body?: string | null;
  now?: Date;
}): Promise<ServiceResult<{ postId: string }>> {
  const now = input.now ?? new Date();

  const rows = await db
    .select({
      conversation: conversations,
      customerName: customers.name,
      customerEmail: customers.email,
    })
    .from(conversations)
    .innerJoin(customers, eq(conversations.customerId, customers.id))
    .where(
      and(
        eq(conversations.id, input.conversationId),
        eq(conversations.productId, input.productId),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return { ok: false, error: "That conversation no longer exists." };

  const boardRows = await db
    .select({ id: boards.id })
    .from(boards)
    .where(
      and(
        eq(boards.id, input.boardId),
        eq(boards.productId, input.productId),
        isNull(boards.archivedAt),
      ),
    )
    .limit(1);
  if (!boardRows[0]) {
    return { ok: false, error: "Choose an active board in this product." };
  }

  const firstCustomerMessage = await db
    .select({ body: conversationMessages.body })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.conversationId, row.conversation.id),
        eq(conversationMessages.authorType, "customer"),
        eq(conversationMessages.kind, "message"),
      ),
    )
    .orderBy(asc(conversationMessages.createdAt))
    .limit(1);

  const fallbackBody =
    firstCustomerMessage[0]?.body ??
    row.conversation.lastMessagePreview ??
    "";

  const title =
    input.title?.trim().slice(0, 160) || row.conversation.subject.slice(0, 160);
  const body = input.body?.trim().slice(0, 10_000) || fallbackBody.slice(0, 10_000);

  if (title.length === 0 || body.length === 0) {
    return { ok: false, error: "Write a title and a description first." };
  }

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(feedbackPosts)
      .values({
        productId: input.productId,
        boardId: input.boardId,
        authorCustomerId: row.conversation.customerId,
        authorLabel: row.customerName,
        authorEmail: row.customerEmail,
        title,
        body,
        status: "open",
        category: "feature_request",
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: feedbackPosts.id });

    const post = inserted[0];
    if (!post) return { ok: false as const, error: "Could not create the request." };

    // The customer's own words become the first piece of evidence on the
    // request, so "who asked and what they said" survives independently of the
    // thread and of any later merge.
    if (fallbackBody.trim().length >= 3) {
      await tx.insert(feedbackInsights).values({
        productId: input.productId,
        feedbackPostId: post.id,
        source: "support",
        sourceRef: row.conversation.id,
        quote: fallbackBody.slice(0, 2_000),
        authorCustomerId: row.conversation.customerId,
        authorLabel: row.customerName,
        occurredAt: now,
        createdBy: input.userId,
      });
    }

    await tx.insert(conversationMessages).values({
      conversationId: row.conversation.id,
      productId: input.productId,
      authorType: "team",
      authorUserId: input.userId,
      kind: "note",
      body: `Created feedback request: ${title}`,
      createdAt: now,
    });

    await tx
      .update(conversations)
      .set({ updatedAt: now })
      .where(eq(conversations.id, row.conversation.id));

    return { ok: true as const, data: { postId: post.id } };
  });
}
