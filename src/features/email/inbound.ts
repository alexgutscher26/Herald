import "server-only";

import { and, eq, isNotNull, or } from "drizzle-orm";

import { db } from "@/db";
import { notificationDeliveries } from "@/db/schema/notifications";
import { productEmailSettings, productSupportSettings } from "@/db/schema/support";
import { conversationMessages, conversations } from "@/db/schema/conversations";
import { blockedCustomers } from "@/db/schema/feedback-extensions";
import { customers } from "@/db/schema/customers";
import { products, workspaces } from "@/db/schema/workspaces";
import { queueAwayReply, queueCustomerMessageNotifications } from "@/features/conversations/notify";
import { classifyConversationSpam } from "@/features/conversations/spam";
import { loadSpamRules } from "@/features/conversations/spam-settings";
import { emailKey, isValidEmail, normalizeEmail } from "@/lib/email";

import {
  classifyInboundEmail,
  conversationReplyAddress,
  createInboundToken,
  extractAddress,
  productInboundAddress,
  parseInboundRecipient,
  type JunkReason,
} from "./inbound-address";

/**
 * Inbound mail.
 *
 * The webhook is authenticated by a shared secret, then every message is
 * addressed by plus-token: the product token starts a thread, the conversation
 * token continues one. Sender identity is checked against the stored customer
 * before a reply is accepted, so knowing a reply address is not enough to post
 * into somebody else's thread.
 *
 * A provider retry carries the same Message-ID; `external_id` is unique, so a
 * duplicate delivery is acknowledged without a second message.
 */

type Executor = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type InboundEmailInput = {
  to: string;
  from: string;
  fromName?: string | null | undefined;
  subject?: string | null | undefined;
  text: string;
  messageId?: string | null | undefined;
  headers?: Record<string, string | undefined> | null | undefined;
};

export type InboundEmailResult = {
  status: "accepted" | "ignored" | "rejected";
  reason?:
    | JunkReason
    | "unknown_recipient"
    | "disabled"
    | "blocked"
    | "duplicate"
    | "spam"
    | "invalid_sender"
    | "sender_mismatch";
  conversationId?: string;
  /** Set when a message was stored, so Juno's pickup is idempotent. */
  messageId?: string | null;
};

const MAX_BODY = 20_000;

export async function readProductEmailSettings(
  productId: string,
): Promise<{
  token: string;
  address: string;
  enabled: boolean;
  displayName: string;
} | null> {
  const rows = await db
    .select({
      token: productEmailSettings.token,
      enabled: productEmailSettings.enabled,
      displayName: productEmailSettings.displayName,
    })
    .from(productEmailSettings)
    .where(eq(productEmailSettings.productId, productId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return {
    token: row.token,
    address: productInboundAddress(row.token),
    enabled: row.enabled,
    displayName: row.displayName,
  };
}

/** Create the address on first visit so the settings card can show it. */
export async function ensureProductEmailSettings(productId: string): Promise<{
  token: string;
  address: string;
  enabled: boolean;
  displayName: string;
}> {
  const existing = await readProductEmailSettings(productId);
  if (existing) return existing;

  await db
    .insert(productEmailSettings)
    .values({ productId, token: createInboundToken() })
    .onConflictDoNothing();

  const created = await readProductEmailSettings(productId);
  if (!created) throw new Error("Could not create the inbound email address.");
  return created;
}

export async function saveProductEmailSettings(input: {
  productId: string;
  enabled: boolean;
  displayName: string;
  regenerate?: boolean;
  now?: Date;
}): Promise<{ ok: true; address: string } | { ok: false; error: string }> {
  const displayName = input.displayName.trim();
  if (displayName.length === 0 || displayName.length > 80) {
    return { ok: false, error: "Use a sender name between 1 and 80 characters." };
  }

  const now = input.now ?? new Date();
  const current = await ensureProductEmailSettings(input.productId);

  await db
    .update(productEmailSettings)
    .set({
      enabled: input.enabled,
      displayName,
      ...(input.regenerate ? { token: createInboundToken() } : {}),
      updatedAt: now,
    })
    .where(eq(productEmailSettings.productId, input.productId));

  const updated = await readProductEmailSettings(input.productId);
  return { ok: true, address: updated?.address ?? current.address };
}

export async function handleInboundEmail(
  input: InboundEmailInput,
): Promise<InboundEmailResult> {
  // `From` may be `Name <address>`; validate the mailbox, not the header.
  const from = normalizeEmail(extractAddress(input.from));
  if (!isValidEmail(from)) {
    return { status: "rejected", reason: "invalid_sender" };
  }

  const junk = classifyInboundEmail({
    from,
    subject: input.subject,
    headers: input.headers,
  });
  if (junk === "auto_reply") {
    const recipient = parseInboundRecipient(input.to);
    if (recipient?.kind === "conversation") {
      await recordAutoReply({
        token: recipient.token,
        messageId: input.messageId?.trim().slice(0, 512) || null,
        now: new Date(),
      });
    }
    return { status: "ignored", reason: junk };
  }
  if (junk) return { status: "ignored", reason: junk };

  const recipient = parseInboundRecipient(input.to);
  if (!recipient) return { status: "ignored", reason: "unknown_recipient" };

  const body = input.text.trim().slice(0, MAX_BODY);
  if (body.length === 0) return { status: "ignored", reason: "unknown_recipient" };

  const externalId = input.messageId?.trim().slice(0, 512) || null;
  const now = new Date();

  if (recipient.kind === "conversation") {
    return handleConversationReply({
      token: recipient.token,
      from,
      fromName: input.fromName ?? null,
      body,
      externalId,
      now,
    });
  }

  return handleNewThread({
    token: recipient.token,
    from,
    fromName: input.fromName ?? null,
    subject: input.subject ?? null,
    body,
    externalId,
    now,
  });
}

/**
 * An auto-reply is not a customer message, but it is useful context on an
 * outbound support thread. Record one idempotent internal note and leave the
 * conversation status, unread count and last-message preview untouched.
 */
async function recordAutoReply(input: {
  token: string;
  messageId: string | null;
  now: Date;
}): Promise<void> {
  const rows = await db
    .select({ id: conversations.id, productId: conversations.productId })
    .from(conversations)
    .where(eq(conversations.replyToken, input.token))
    .limit(1);
  const conversation = rows[0];
  if (!conversation) return;

  await db
    .insert(conversationMessages)
    .values({
      conversationId: conversation.id,
      productId: conversation.productId,
      authorType: "system",
      kind: "note",
      channel: "team",
      body: "An automatic reply was received for this conversation. No customer message was added.",
      externalId:
        input.messageId !== null
          ? `auto-reply:${input.messageId}`
          : `auto-reply:${conversation.id}:${input.now.toISOString()}`,
      createdAt: input.now,
    })
    .onConflictDoNothing();
}

async function isBlocked(
  executor: Executor,
  input: { workspaceId: string; customerId: string; emailNormalized: string },
): Promise<boolean> {
  const rows = await executor
    .select({ id: blockedCustomers.id })
    .from(blockedCustomers)
    .where(
      and(
        eq(blockedCustomers.workspaceId, input.workspaceId),
        or(
          eq(blockedCustomers.customerId, input.customerId),
          and(
            isNotNull(blockedCustomers.emailNormalized),
            eq(blockedCustomers.emailNormalized, input.emailNormalized),
          ),
        ),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function handleConversationReply(input: {
  token: string;
  from: string;
  fromName: string | null;
  body: string;
  externalId: string | null;
  now: Date;
}): Promise<InboundEmailResult> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        conversation: conversations,
        customerEmail: customers.email,
        customerEmailNormalized: customers.emailNormalized,
      })
      .from(conversations)
      .innerJoin(customers, eq(conversations.customerId, customers.id))
      .where(eq(conversations.replyToken, input.token))
      .limit(1)
      .for("update");

    const row = rows[0];
    if (!row) return { status: "rejected", reason: "unknown_recipient" };

    const { conversation } = row;
    const emailNormalized = emailKey(input.from);

    if (
      row.customerEmailNormalized &&
      row.customerEmailNormalized !== emailNormalized
    ) {
      return { status: "rejected", reason: "sender_mismatch" };
    }

    if (
      await isBlocked(tx, {
        workspaceId: conversation.workspaceId,
        customerId: conversation.customerId,
        emailNormalized,
      })
    ) {
      return { status: "ignored", reason: "blocked" };
    }

    if (conversation.status === "spam") {
      return { status: "ignored", reason: "spam" };
    }

    if (!row.customerEmailNormalized) {
      await tx
        .update(customers)
        .set({ email: input.from, emailNormalized, updatedAt: input.now })
        .where(eq(customers.id, conversation.customerId));
    }

    const verdict = classifyConversationSpam(
      {
        subject: conversation.subject,
        body: input.body,
      },
      await loadSpamRules(tx, conversation.productId),
    );

    const inserted = await tx
      .insert(conversationMessages)
      .values({
        conversationId: conversation.id,
        productId: conversation.productId,
        authorType: "customer",
        authorCustomerId: conversation.customerId,
        channel: "email",
        externalId: input.externalId,
        body: input.body,
        createdAt: input.now,
      })
      .onConflictDoNothing()
      .returning({ id: conversationMessages.id });

    if (inserted.length === 0) {
      return { status: "ignored", reason: "duplicate" };
    }

    const reopened =
      conversation.status === "resolved" ||
      conversation.status === "snoozed" ||
      conversation.status === "archived";

    await tx
      .update(conversations)
      .set({
        status: verdict.spam ? "spam" : reopened ? "queue" : conversation.status,
        spamReason: verdict.spam ? verdict.reason : conversation.spamReason,
        snoozedUntil: reopened ? null : conversation.snoozedUntil,
        resolvedAt: reopened ? null : conversation.resolvedAt,
        unreadForTeam: verdict.spam ? 0 : conversation.unreadForTeam + 1,
        lastMessagePreview: input.body.slice(0, 160),
        lastMessageAt: input.now,
        lastCustomerMessageAt: input.now,
        updatedAt: input.now,
      })
      .where(eq(conversations.id, conversation.id));

    if (inserted[0] && !verdict.spam) {
      await queueCustomerMessageNotifications(tx, {
        workspaceId: conversation.workspaceId,
        productId: conversation.productId,
        conversationId: conversation.id,
        messageId: inserted[0].id,
        subject: conversation.subject,
        body: input.body,
        customerName: input.fromName ?? row.customerEmail ?? input.from,
        kind: "reply",
        now: input.now,
      });
      await queueAwayReply(tx, {
        conversation,
        customerEmail: row.customerEmail ?? input.from,
        now: input.now,
      });
    }

    return {
      status: "accepted",
      conversationId: conversation.id,
      messageId: inserted[0]?.id ?? null,
    };
  });
}

async function handleNewThread(input: {
  token: string;
  from: string;
  fromName: string | null;
  subject: string | null;
  body: string;
  externalId: string | null;
  now: Date;
}): Promise<InboundEmailResult> {
  return db.transaction(async (tx) => {
    const settingsRows = await tx
      .select({
        productId: products.id,
        workspaceId: products.workspaceId,
        enabled: productEmailSettings.enabled,
      })
      .from(productEmailSettings)
      .innerJoin(products, eq(productEmailSettings.productId, products.id))
      .innerJoin(workspaces, eq(products.workspaceId, workspaces.id))
      .where(eq(productEmailSettings.token, input.token))
      .limit(1);

    const settings = settingsRows[0];
    if (!settings) return { status: "ignored", reason: "unknown_recipient" };
    if (!settings.enabled) return { status: "ignored", reason: "disabled" };

    const emailNormalized = emailKey(input.from);
    const existing = await tx
      .select({
        id: customers.id,
        email: customers.email,
        bannedAt: customers.bannedAt,
      })
      .from(customers)
      .where(
        and(
          eq(customers.workspaceId, settings.workspaceId),
          eq(customers.emailNormalized, emailNormalized),
        ),
      )
      .limit(1);

    let customer = existing[0];
    if (!customer) {
      const name =
        input.fromName?.trim().slice(0, 120) ||
        input.from.slice(0, input.from.lastIndexOf("@")) ||
        null;
      const inserted = await tx
        .insert(customers)
        .values({
          workspaceId: settings.workspaceId,
          email: input.from,
          emailNormalized,
          name,
          lastSeenAt: input.now,
        })
        .onConflictDoNothing()
        .returning({
          id: customers.id,
          email: customers.email,
          bannedAt: customers.bannedAt,
        });
      customer = inserted[0];
    }

    if (!customer) return { status: "ignored", reason: "unknown_recipient" };

    if (
      await isBlocked(tx, {
        workspaceId: settings.workspaceId,
        customerId: customer.id,
        emailNormalized,
      })
    ) {
      return { status: "ignored", reason: "blocked" };
    }
    if (customer.bannedAt) return { status: "ignored", reason: "blocked" };

    const subject =
      input.subject?.replace(/[\r\n]+/g, " ").trim().slice(0, 160) ||
      "Support request";
    const verdict = classifyConversationSpam(
      { subject, body: input.body },
      await loadSpamRules(tx, settings.productId),
    );

    const created = await tx
      .insert(conversations)
      .values({
        workspaceId: settings.workspaceId,
        productId: settings.productId,
        customerId: customer.id,
        subject,
        replyToken: createInboundToken(),
        status: verdict.spam ? "spam" : "queue",
        spamReason: verdict.reason,
        sourceContext: { channel: "email" },
        lastMessagePreview: input.body.slice(0, 160),
        lastMessageAt: input.now,
        lastCustomerMessageAt: input.now,
        unreadForTeam: verdict.spam ? 0 : 1,
        updatedAt: input.now,
      })
      .returning();

    const conversation = created[0];
    if (!conversation) return { status: "rejected", reason: "unknown_recipient" };

    const inserted = await tx
      .insert(conversationMessages)
      .values({
        conversationId: conversation.id,
        productId: settings.productId,
        authorType: "customer",
        authorCustomerId: customer.id,
        channel: "email",
        externalId: input.externalId,
        body: input.body,
        createdAt: input.now,
      })
      .onConflictDoNothing()
      .returning({ id: conversationMessages.id });

    if (inserted.length === 0) {
      // A retry of the very message that created the thread. Drop the thread
      // rather than leaving an empty conversation behind.
      await tx.delete(conversations).where(eq(conversations.id, conversation.id));
      return { status: "ignored", reason: "duplicate" };
    }

    if (inserted[0] && !verdict.spam) {
      const customerEmail = customer.email ?? input.from;
      await queueCustomerMessageNotifications(tx, {
        workspaceId: settings.workspaceId,
        productId: settings.productId,
        conversationId: conversation.id,
        messageId: inserted[0].id,
        subject,
        body: input.body,
        customerName: customer.id ? (input.fromName ?? input.from) : input.from,
        kind: "new_conversation",
        now: input.now,
      });
      await queueAwayReply(tx, {
        conversation,
        customerEmail,
        now: input.now,
      });
    }

    return {
      status: "accepted",
      conversationId: conversation.id,
      messageId: inserted[0]?.id ?? null,
    };
  });
}

/**
 * Queue the transactional reply mail for one team message.
 *
 * Called inside the same transaction that inserts the message. It is a no-op
 * when inbound email is not configured or paused, or when the customer has no
 * address yet — the widget keeps working, there is just nothing to email.
 */
export async function queueConversationReplyNotification(
  tx: Executor,
  input: {
    workspaceId: string;
    productId: string;
    conversationId: string;
    conversationMessageId: string;
    recipientEmail: string;
    recipientEmailNormalized: string;
    now: Date;
  },
): Promise<boolean> {
  const settings = await tx
    .select({ enabled: productEmailSettings.enabled })
    .from(productEmailSettings)
    .where(eq(productEmailSettings.productId, input.productId))
    .limit(1);

  if (!settings[0]?.enabled) return false;

  const inserted = await tx
    .insert(notificationDeliveries)
    .values({
      workspaceId: input.workspaceId,
      productId: input.productId,
      template: "conversation_reply",
      conversationId: input.conversationId,
      conversationMessageId: input.conversationMessageId,
      recipientEmail: input.recipientEmail,
      recipientEmailNormalized: input.recipientEmailNormalized,
      dedupeKey: `conversation-reply:${input.conversationMessageId}`,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoNothing()
    .returning({ id: notificationDeliveries.id });

  return inserted.length > 0;
}

/**
 * Queue the one CSAT email for an email-born thread.
 *
 * It is deliberately limited to threads whose source channel is email: a
 * widget customer already gets the in-widget prompt on the same row. The
 * unique dedupe key makes reopening and resolving again a no-op.
 */
export async function queueConversationCsatNotification(input: {
  productId: string;
  conversationId: string;
}): Promise<boolean> {
  const [row] = await db
    .select({
      workspaceId: conversations.workspaceId,
      sourceContext: conversations.sourceContext,
      replyToken: conversations.replyToken,
      csatRequestedAt: conversations.csatRequestedAt,
      email: customers.email,
      emailNormalized: customers.emailNormalized,
      emailEnabled: productEmailSettings.enabled,
      csatEnabled: productSupportSettings.csatEnabled,
    })
    .from(conversations)
    .innerJoin(customers, eq(conversations.customerId, customers.id))
    .leftJoin(
      productEmailSettings,
      eq(productEmailSettings.productId, conversations.productId),
    )
    .leftJoin(
      productSupportSettings,
      eq(productSupportSettings.productId, conversations.productId),
    )
    .where(
      and(
        eq(conversations.id, input.conversationId),
        eq(conversations.productId, input.productId),
      ),
    )
    .limit(1);

  if (
    !row ||
    row.sourceContext?.channel !== "email" ||
    !row.replyToken ||
    !row.csatRequestedAt ||
    !row.email ||
    !row.emailNormalized ||
    !row.emailEnabled ||
    !row.csatEnabled
  ) {
    return false;
  }

  const inserted = await db
    .insert(notificationDeliveries)
    .values({
      workspaceId: row.workspaceId,
      productId: input.productId,
      template: "conversation_csat",
      conversationId: input.conversationId,
      recipientEmail: row.email,
      recipientEmailNormalized: row.emailNormalized,
      dedupeKey: `conversation-csat:${input.conversationId}`,
    })
    .onConflictDoNothing()
    .returning({ id: notificationDeliveries.id });

  return inserted.length > 0;
}

export { conversationReplyAddress };
