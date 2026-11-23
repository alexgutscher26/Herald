import "server-only";

import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { user } from "@/db/schema/auth";
import {
  conversationMessages,
  conversationNotifications,
  conversations,
  type Conversation,
} from "@/db/schema/conversations";
import { notificationDeliveries } from "@/db/schema/notifications";
import { productEmailSettings, workspaceOperators } from "@/db/schema/support";
import { workspaceMembers } from "@/db/schema/workspaces";
import { teamPresence } from "@/features/operators/service";
import { emailKey, isValidEmail } from "@/lib/email";

/**
 * Team-facing conversation alerts and the one-shot away reply.
 *
 * Both functions run inside the transaction that inserts the customer message.
 * Notification preferences live on the operator row; an eligible operator who
 * has never saved settings gets the documented defaults (everything on, away
 * reply off), so a new workspace is not silent by accident.
 */

type Executor = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function queueCustomerMessageNotifications(
  tx: Executor,
  input: {
    workspaceId: string;
    productId: string;
    conversationId: string;
    messageId: string;
    subject: string;
    body: string;
    customerName: string;
    kind: "new_conversation" | "reply";
    now: Date;
  },
): Promise<number> {
  const recipients = await tx
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
      notifyEmail: workspaceOperators.notifyEmail,
      notifyInApp: workspaceOperators.notifyInApp,
      notifyNewConversations: workspaceOperators.notifyNewConversations,
      notifyReplies: workspaceOperators.notifyReplies,
    })
    .from(workspaceMembers)
    .innerJoin(user, eq(workspaceMembers.userId, user.id))
    .leftJoin(
      workspaceOperators,
      and(
        eq(workspaceOperators.workspaceId, workspaceMembers.workspaceId),
        eq(workspaceOperators.userId, workspaceMembers.userId),
      ),
    )
    .where(
      and(
        eq(workspaceMembers.workspaceId, input.workspaceId),
        inArray(workspaceMembers.role, ["owner", "admin"]),
      ),
    );

  const title =
    input.kind === "new_conversation"
      ? `New conversation from ${input.customerName}`
      : `New reply from ${input.customerName}`;

  let created = 0;

  for (const recipient of recipients) {
    const wantsKind =
      input.kind === "new_conversation"
        ? (recipient.notifyNewConversations ?? true)
        : (recipient.notifyReplies ?? true);
    if (!wantsKind) continue;

    if (recipient.notifyInApp ?? true) {
      const inserted = await tx
        .insert(conversationNotifications)
        .values({
          workspaceId: input.workspaceId,
          productId: input.productId,
          conversationId: input.conversationId,
          messageId: input.messageId,
          userId: recipient.userId,
          kind: input.kind,
          title,
          body: input.body.slice(0, 240),
          dedupeKey: `conversation-notice:${input.messageId}:${recipient.userId}`,
          createdAt: input.now,
        })
        .onConflictDoNothing()
        .returning({ id: conversationNotifications.id });
      created += inserted.length;
    }

    if (
      (recipient.notifyEmail ?? true) &&
      isValidEmail(recipient.email)
    ) {
      await tx
        .insert(notificationDeliveries)
        .values({
          workspaceId: input.workspaceId,
          productId: input.productId,
          template: "conversation_notification",
          conversationId: input.conversationId,
          conversationMessageId: input.messageId,
          recipientEmail: recipient.email,
          recipientEmailNormalized: emailKey(recipient.email),
          dedupeKey: `conversation-notify:${input.messageId}:${recipient.userId}`,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .onConflictDoNothing();
    }
  }

  return created;
}

/**
 * One in-app alert per operator when a waiting thread crosses its SLA.
 *
 * Email is deliberately not duplicated here: the alert is an operational
 * reminder, and the existing conversation notification email still covers the
 * customer's message. `dedupeKey` is scoped to the waiting period, so a later
 * customer message can produce a new breach alert.
 */
export async function queueSlaBreachNotifications(
  tx: Executor,
  input: {
    workspaceId: string;
    productId: string;
    conversationId: string;
    subject: string;
    customerName: string;
    targetMinutes: number;
    waitingSince: Date;
    now: Date;
  },
): Promise<number> {
  const recipients = await tx
    .select({
      userId: user.id,
      notifyInApp: workspaceOperators.notifyInApp,
    })
    .from(workspaceMembers)
    .innerJoin(user, eq(workspaceMembers.userId, user.id))
    .leftJoin(
      workspaceOperators,
      and(
        eq(workspaceOperators.workspaceId, workspaceMembers.workspaceId),
        eq(workspaceOperators.userId, workspaceMembers.userId),
      ),
    )
    .where(
      and(
        eq(workspaceMembers.workspaceId, input.workspaceId),
        inArray(workspaceMembers.role, ["owner", "admin"]),
      ),
    );

  let created = 0;
  for (const recipient of recipients) {
    if (!(recipient.notifyInApp ?? true)) continue;
    const inserted = await tx
      .insert(conversationNotifications)
      .values({
        workspaceId: input.workspaceId,
        productId: input.productId,
        conversationId: input.conversationId,
        userId: recipient.userId,
        kind: "sla_breach",
        title: `SLA breach: ${input.subject}`,
        body: `${input.customerName} has been waiting more than ${input.targetMinutes} business minutes.`,
        dedupeKey: `conversation-sla:${input.conversationId}:${input.waitingSince.toISOString()}`,
        createdAt: input.now,
      })
      .onConflictDoNothing()
      .returning({ id: conversationNotifications.id });
    created += inserted.length;
  }
  return created;
}

/**
 * Insert the configured away reply when nobody is available.
 *
 * Returns the system message id, or null when the team is online, nobody
 * enabled an away reply, or this thread already received one. A human team
 * reply clears `awayReplySentAt`, so a later customer message may trigger a
 * fresh away reply.
 */
export async function queueAwayReply(
  tx: Executor,
  input: {
    conversation: Conversation;
    customerEmail: string | null;
    now: Date;
  },
): Promise<string | null> {
  const { conversation } = input;
  if (conversation.awayReplySentAt) return null;
  if (conversation.status === "spam" || conversation.status === "archived") return null;

  // Read presence on the same connection as the insert: a nested pool query
  // inside an open transaction would wait on itself behind a single-connection
  // pooler.
  if (await teamPresence(conversation.workspaceId, input.now, tx)) return null;

  const operators = await tx
    .select({ body: workspaceOperators.awayReplyBody })
    .from(workspaceOperators)
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, workspaceOperators.workspaceId),
        eq(workspaceMembers.userId, workspaceOperators.userId),
      ),
    )
    .where(
      and(
        eq(workspaceOperators.workspaceId, conversation.workspaceId),
        eq(workspaceOperators.awayReplyEnabled, true),
        inArray(workspaceMembers.role, ["owner", "admin"]),
      ),
    )
    .orderBy(desc(workspaceOperators.updatedAt))
    .limit(1);

  const body = operators[0]?.body.trim().slice(0, 2000) ?? "";
  if (body === "") return null;

  const inserted = await tx
    .insert(conversationMessages)
    .values({
      conversationId: conversation.id,
      productId: conversation.productId,
      authorType: "system",
      channel: "team",
      body,
      createdAt: input.now,
    })
    .returning({ id: conversationMessages.id });

  const message = inserted[0];
  if (!message) return null;

  await tx
    .update(conversations)
    .set({
      awayReplySentAt: input.now,
      unreadForCustomer: sql`${conversations.unreadForCustomer} + 1`,
      lastMessagePreview: body.slice(0, 160),
      lastMessageAt: input.now,
      updatedAt: input.now,
    })
    .where(eq(conversations.id, conversation.id));

  const email = input.customerEmail?.trim() ?? "";
  if (email !== "" && isValidEmail(email) && conversation.replyToken) {
    const settings = await tx
      .select({ enabled: productEmailSettings.enabled })
      .from(productEmailSettings)
      .where(eq(productEmailSettings.productId, conversation.productId))
      .limit(1);

    if (settings[0]?.enabled) {
      await tx
        .insert(notificationDeliveries)
        .values({
          workspaceId: conversation.workspaceId,
          productId: conversation.productId,
          template: "conversation_away_reply",
          conversationId: conversation.id,
          conversationMessageId: message.id,
          recipientEmail: email,
          recipientEmailNormalized: emailKey(email),
          dedupeKey: `conversation-away:${message.id}`,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .onConflictDoNothing();
    }
  }

  return message.id;
}
