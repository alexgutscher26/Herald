import "server-only";

import { and, count, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { customers } from "@/db/schema/customers";
import {
  conversationAttachments,
  conversationDrafts,
  conversationMerges,
  conversationMessages,
  conversationParticipants,
  conversationReminders,
  conversationTagLinks,
  conversationTags,
  conversations,
  type ConversationStatus,
} from "@/db/schema/conversations";
import { blockedCustomers } from "@/db/schema/feedback-extensions";
import { recordSpamFeedback } from "./spam-settings";
import { workspaceOperators } from "@/db/schema/support";
import { user } from "@/db/schema/auth";
import {
  queueConversationCsatNotification,
  queueConversationReplyNotification,
} from "@/features/email/inbound";
import { queueSlackSupportMirror } from "@/features/slack/support";
import { recordHumanTakeover } from "@/features/juno/answer";
import { normalizeEmail } from "@/lib/email";
import { workspaceMembers } from "@/db/schema/workspaces";

import { pickLeastLoaded } from "./assignment";
import { parseComposerInput, parseSnoozeMinutes } from "./commands";
import { normalizeTagName } from "./macro-rules";

/**
 * Conversation writes.
 *
 * These functions assume the caller has already authorized the product; the
 * server actions do that, and the integration suite calls them directly to
 * exercise the same transactions without a request context.
 *
 * Every query is scoped by `productId`. Status, preview and unread updates
 * happen in the same transaction as the message insert, so the inbox can never
 * show a preview from a message that was rolled back.
 */

export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

type ModerationStatus = "open" | "resolved" | "spam" | "archived";

function scopedConversation(productId: string, conversationId: string) {
  return and(
    eq(conversations.id, conversationId),
    eq(conversations.productId, productId),
  );
}

/**
 * Apply one composer submission: a reply, a note, or a slash command.
 *
 * A reply on a queued thread opens it. Notes never open, preview or count as a
 * customer-facing message. A status command wins over the implicit open.
 */
export async function appendTeamMessage(input: {
  productId: string;
  conversationId: string;
  userId: string;
  body: string;
  /**
   * Uploaded attachment rows waiting for this message. They were stored by the
   * upload route with `messageId` null; this transaction consumes them so an
   * unsent file is never shown to the customer.
   */
  attachmentIds?: string[] | undefined;
  /**
   * Optional explicit shape. The composer leaves this unset so slash commands
   * still work; the REST API sets `note` for a private note and `message` for a
   * reply, because an API body that happens to start with `/` is content, not
   * a command.
   */
  kind?: "message" | "note";
  now?: Date;
}): Promise<
  ServiceResult<{ messageId: string | null; status: ConversationStatus }>
> {
  const attachmentIds = [...new Set(input.attachmentIds ?? [])];
  if (attachmentIds.length > 5) {
    return { ok: false, error: "Attach at most 5 files to one message." };
  }
  const attachmentOnly = input.body.trim() === "" && attachmentIds.length > 0;
  const parsed: ReturnType<typeof parseComposerInput> =
    input.kind === undefined
      ? attachmentOnly
        ? { kind: "message", body: "" }
        : parseComposerInput(input.body)
      : input.body.trim() === "" && !attachmentOnly
        ? { kind: "error", error: "Write something first." }
        : { kind: input.kind, body: input.body.trim() };
  if (parsed.kind === "error") return { ok: false, error: parsed.error };
  if (attachmentIds.length > 0 && parsed.kind !== "message") {
    return {
      ok: false,
      error: "Attachments can only be sent with a customer reply, not a note or command.",
    };
  }

  const now = input.now ?? new Date();

  const result = await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(conversations)
      .where(scopedConversation(input.productId, input.conversationId))
      .limit(1)
      .for("update");

    const conversation = rows[0];
    if (!conversation) {
      return { ok: false as const, error: "That conversation no longer exists." };
    }

    if (attachmentIds.length > 0) {
      const available = await tx
        .select({ id: conversationAttachments.id })
        .from(conversationAttachments)
        .where(
          and(
            eq(conversationAttachments.productId, input.productId),
            eq(conversationAttachments.conversationId, conversation.id),
            inArray(conversationAttachments.id, attachmentIds),
            isNull(conversationAttachments.messageId),
          ),
        );
      if (available.length !== attachmentIds.length) {
        return {
          ok: false as const,
          error: "One of those attachments is no longer available. Upload it again.",
        };
      }
    }

    let status: ConversationStatus = conversation.status;
    let snoozedUntil = conversation.snoozedUntil;
    let resolvedAt = conversation.resolvedAt;

    if (parsed.kind === "status") {
      status = parsed.status;
      snoozedUntil = null;
      resolvedAt = parsed.status === "resolved" ? now : null;
    } else if (parsed.kind === "snooze") {
      status = "snoozed";
      snoozedUntil = new Date(now.getTime() + parsed.minutes * 60_000);
      resolvedAt = null;
    } else if (
      parsed.kind === "message" &&
      (conversation.status === "queue" || conversation.status === "snoozed")
    ) {
      status = "open";
      snoozedUntil = null;
    }

    // An attachment-only send still needs a customer-visible line in email and
    // previews; the stored message says what happened without inventing a
    // filename list as message text.
    const body =
      parsed.body.trim() === "" && attachmentIds.length > 0
        ? "Sent an attachment"
        : parsed.body;
    const isNote = parsed.kind === "note";
    let messageId: string | null = null;

    if (body !== "") {
      const inserted = await tx
        .insert(conversationMessages)
        .values({
          conversationId: conversation.id,
          productId: conversation.productId,
          authorType: "team",
          authorUserId: input.userId,
          kind: isNote ? "note" : "message",
          body,
          createdAt: now,
        })
        .returning({ id: conversationMessages.id });
      messageId = inserted[0]?.id ?? null;

      if (messageId && attachmentIds.length > 0) {
        await tx
          .update(conversationAttachments)
          .set({ messageId })
          .where(
            and(
              eq(conversationAttachments.productId, input.productId),
              eq(conversationAttachments.conversationId, conversation.id),
              inArray(conversationAttachments.id, attachmentIds),
              isNull(conversationAttachments.messageId),
            ),
          );
      }

      // Email fallback: a reply to a customer with a known address is queued
      // in the same transaction. Paused or unconfigured inbound email makes
      // this a no-op, never an error on the dashboard reply.
      if (messageId && !isNote) {
        const recipient = await tx
          .select({ email: customers.email, emailNormalized: customers.emailNormalized })
          .from(customers)
          .where(eq(customers.id, conversation.customerId))
          .limit(1);
        const email = recipient[0]?.email;
        // A thread created before reply tokens existed cannot accept a reply
        // by email; skip the queue rather than send a dead-end Reply-To.
        if (email && conversation.replyToken) {
          await queueConversationReplyNotification(tx, {
            workspaceId: conversation.workspaceId,
            productId: conversation.productId,
            conversationId: conversation.id,
            conversationMessageId: messageId,
            recipientEmail: email,
            recipientEmailNormalized: recipient[0]?.emailNormalized ?? normalizeEmail(email),
            now,
          });
        }
      }
    }

    await tx
      .update(conversations)
      .set({
        status,
        snoozedUntil,
        resolvedAt,
        updatedAt: now,
        unreadForTeam: 0,
        ...(body !== "" && !isNote
          ? {
              lastMessagePreview: body.slice(0, 160),
              lastMessageAt: now,
              // The customer sees this as unread until they open the thread.
              unreadForCustomer: sql`${conversations.unreadForCustomer} + 1`,
              // A human reply ends the current away period.
              awayReplySentAt: null,
            }
          : {}),
      })
      .where(scopedConversation(input.productId, conversation.id));

    // A human reply is a takeover: Mira stays out of this thread until
    // somebody explicitly hands it back, so a bot never talks over the team.
    if (body !== "" && !isNote) {
      await recordHumanTakeover(tx, {
        conversationId: conversation.id,
        productId: conversation.productId,
        now,
      });
    }

    // Record the read in the same transaction as the reply.
    await tx
      .insert(conversationParticipants)
      .values({
        conversationId: conversation.id,
        productId: conversation.productId,
        role: "team",
        userId: input.userId,
        lastReadAt: now,
      })
      .onConflictDoNothing();
    await tx
      .update(conversationParticipants)
      .set({ lastReadAt: now })
      .where(
        and(
          eq(conversationParticipants.conversationId, conversation.id),
          eq(conversationParticipants.userId, input.userId),
        ),
      );

    // A successful send (reply or note) consumes the personal draft.
    if (body !== "") {
      await tx
        .delete(conversationDrafts)
        .where(
          and(
            eq(conversationDrafts.conversationId, conversation.id),
            eq(conversationDrafts.userId, input.userId),
          ),
        );
    }

    return { ok: true as const, data: { messageId, status } };
  });

  // `/resolve` is a resolution path of its own; queue the same one-time CSAT
  // email after the transaction commits. The queue rechecks channel, email and
  // CSAT eligibility, so a non-email thread or a disabled setting is a no-op.
  if (result.ok && parsed.kind === "status" && parsed.status === "resolved") {
    await queueConversationCsatNotification({
      productId: input.productId,
      conversationId: input.conversationId,
    }).catch((error: unknown) => {
      console.error("[conversations] csat email queue failed", error);
    });
  }

  // A reply on a Slack-originated thread is mirrored back to Slack. Notes,
  // non-Slack threads and enqueue failures leave the dashboard reply intact.
  if (result.ok && result.data.messageId && parsed.kind !== "note") {
    await queueSlackSupportMirror({
      productId: input.productId,
      conversationId: input.conversationId,
      messageId: result.data.messageId,
      body:
        parsed.body.trim() === "" && attachmentIds.length > 0
          ? "Sent an attachment"
          : parsed.body,
    });
  }

  return result;
}

export async function setConversationStatus(input: {
  productId: string;
  conversationId: string;
  status: ModerationStatus;
  now?: Date;
}): Promise<ServiceResult<{ updated: number }>> {
  const now = input.now ?? new Date();
  const updated = await db
    .update(conversations)
    .set({
      status: input.status,
      resolvedAt: input.status === "resolved" ? now : null,
      snoozedUntil: null,
      updatedAt: now,
    })
    .where(scopedConversation(input.productId, input.conversationId))
    .returning({ id: conversations.id, csatRequestedAt: conversations.csatRequestedAt });

  if (updated.length === 0) {
    return { ok: false, error: "That conversation no longer exists." };
  }
  if (input.status === "resolved") {
    await queueConversationCsatNotification({
      productId: input.productId,
      conversationId: input.conversationId,
    }).catch((error: unknown) => {
      console.error("[conversations] csat email queue failed", error);
    });
  }
  return { ok: true, data: { updated: updated.length } };
}

export async function bulkSetConversationStatus(input: {
  productId: string;
  conversationIds: string[];
  status: ModerationStatus;
  now?: Date;
}): Promise<{ updated: number }> {
  const ids = [...new Set(input.conversationIds)];
  if (ids.length === 0) return { updated: 0 };

  const now = input.now ?? new Date();
  const updated = await db
    .update(conversations)
    .set({
      status: input.status,
      resolvedAt: input.status === "resolved" ? now : null,
      snoozedUntil: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(conversations.productId, input.productId),
        inArray(conversations.id, ids),
      ),
    )
    .returning({ id: conversations.id, csatRequestedAt: conversations.csatRequestedAt });

  if (input.status === "resolved") {
    await Promise.all(
      updated
        .filter((row) => row.csatRequestedAt !== null)
        .map((row) =>
          queueConversationCsatNotification({
            productId: input.productId,
            conversationId: row.id,
          }).catch((error: unknown) => {
            console.error("[conversations] csat email queue failed", error);
          }),
        ),
    );
  }

  return { updated: updated.length };
}

export async function assignConversation(input: {
  productId: string;
  workspaceId: string;
  conversationId: string;
  assigneeId: string | null;
  now?: Date;
}): Promise<ServiceResult<{ assigneeId: string | null }>> {
  if (input.assigneeId !== null) {
    const member = await db
      .select({ id: workspaceMembers.id })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, input.workspaceId),
          eq(workspaceMembers.userId, input.assigneeId),
        ),
      )
      .limit(1);
    if (!member[0]) {
      return { ok: false, error: "That person is not a member of this workspace." };
    }
  }

  const now = input.now ?? new Date();
  const updated = await db
    .update(conversations)
    .set({ assigneeId: input.assigneeId, updatedAt: now })
    .where(scopedConversation(input.productId, input.conversationId))
    .returning({ id: conversations.id });

  if (updated.length === 0) {
    return { ok: false, error: "That conversation no longer exists." };
  }
  return { ok: true, data: { assigneeId: input.assigneeId } };
}

export async function bulkAssignConversations(input: {
  productId: string;
  workspaceId: string;
  conversationIds: string[];
  assigneeId: string | null;
  now?: Date;
}): Promise<ServiceResult<{ updated: number }>> {
  const ids = [...new Set(input.conversationIds)];
  if (ids.length === 0) return { ok: true, data: { updated: 0 } };

  if (input.assigneeId !== null) {
    const member = await db
      .select({ id: workspaceMembers.id })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, input.workspaceId),
          eq(workspaceMembers.userId, input.assigneeId),
        ),
      )
      .limit(1);
    if (!member[0]) {
      return { ok: false, error: "That person is not a member of this workspace." };
    }
  }

  const updated = await db
    .update(conversations)
    .set({ assigneeId: input.assigneeId, updatedAt: input.now ?? new Date() })
    .where(
      and(
        eq(conversations.productId, input.productId),
        inArray(conversations.id, ids),
      ),
    )
    .returning({ id: conversations.id });

  return { ok: true, data: { updated: updated.length } };
}

/** Add one tag to every selected thread, creating the tag on first use. */
export async function bulkTagConversations(input: {
  productId: string;
  conversationIds: string[];
  tagName: string;
}): Promise<ServiceResult<{ updated: number; tagName: string }>> {
  const tagName = normalizeTagName(input.tagName);
  if (!tagName) {
    return {
      ok: false,
      error: "Tags use letters, numbers, spaces, hyphens or underscores, up to 32 characters.",
    };
  }
  const ids = [...new Set(input.conversationIds)];
  if (ids.length === 0) return { ok: true, data: { updated: 0, tagName } };

  return db.transaction(async (tx) => {
    const conversationsInProduct = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.productId, input.productId),
          inArray(conversations.id, ids),
        ),
      );
    if (conversationsInProduct.length === 0) {
      return { ok: true as const, data: { updated: 0, tagName } };
    }

    const inserted = await tx
      .insert(conversationTags)
      .values({ productId: input.productId, name: tagName })
      .onConflictDoNothing()
      .returning({ id: conversationTags.id });
    const tagId =
      inserted[0]?.id ??
      (
        await tx
          .select({ id: conversationTags.id })
          .from(conversationTags)
          .where(
            and(
              eq(conversationTags.productId, input.productId),
              eq(conversationTags.name, tagName),
            ),
          )
          .limit(1)
      )[0]?.id;
    if (!tagId) return { ok: false as const, error: "Could not create that tag." };

    const linked = await tx
      .insert(conversationTagLinks)
      .values(
        conversationsInProduct.map((conversation) => ({
          conversationId: conversation.id,
          productId: input.productId,
          tagId,
        })),
      )
      .onConflictDoNothing()
      .returning({ conversationId: conversationTagLinks.conversationId });

    return { ok: true as const, data: { updated: linked.length, tagName } };
  });
}

export async function addConversationTag(input: {
  productId: string;
  conversationId: string;
  tagName: string;
}): Promise<ServiceResult<{ tagName: string }>> {
  const result = await bulkTagConversations({
    productId: input.productId,
    conversationIds: [input.conversationId],
    tagName: input.tagName,
  });
  return result.ok
    ? { ok: true, data: { tagName: result.data.tagName } }
    : result;
}

export async function removeConversationTag(input: {
  productId: string;
  conversationId: string;
  tagId: string;
}): Promise<ServiceResult<{ removed: boolean }>> {
  const removed = await db
    .delete(conversationTagLinks)
    .where(
      and(
        eq(conversationTagLinks.conversationId, input.conversationId),
        eq(conversationTagLinks.productId, input.productId),
        eq(conversationTagLinks.tagId, input.tagId),
      ),
    )
    .returning({ tagId: conversationTagLinks.tagId });
  return { ok: true, data: { removed: removed.length > 0 } };
}

export async function bulkSnoozeConversations(input: {
  productId: string;
  conversationIds: string[];
  minutes: number;
  now?: Date;
}): Promise<ServiceResult<{ updated: number; snoozedUntil: string }>> {
  if (parseSnoozeMinutes(String(input.minutes)) === null) {
    return { ok: false, error: "Snooze between 5 minutes and 30 days." };
  }
  const ids = [...new Set(input.conversationIds)];
  if (ids.length === 0) {
    return { ok: true, data: { updated: 0, snoozedUntil: "" } };
  }

  const now = input.now ?? new Date();
  const snoozedUntil = new Date(now.getTime() + input.minutes * 60_000);
  const updated = await db
    .update(conversations)
    .set({ status: "snoozed", snoozedUntil, resolvedAt: null, updatedAt: now })
    .where(
      and(
        eq(conversations.productId, input.productId),
        inArray(conversations.id, ids),
      ),
    )
    .returning({ id: conversations.id });

  return {
    ok: true,
    data: { updated: updated.length, snoozedUntil: snoozedUntil.toISOString() },
  };
}

export async function mergeConversation(input: {
  productId: string;
  sourceConversationId: string;
  targetConversationId: string;
  userId: string;
  now?: Date;
}): Promise<ServiceResult<{ targetConversationId: string; movedMessages: number }>> {
  if (input.sourceConversationId === input.targetConversationId) {
    return { ok: false, error: "Choose a different conversation to merge into." };
  }

  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.productId, input.productId),
          inArray(conversations.id, [
            input.sourceConversationId,
            input.targetConversationId,
          ]),
        ),
      );
    const source = rows.find((row) => row.id === input.sourceConversationId);
    const target = rows.find((row) => row.id === input.targetConversationId);
    if (!source || !target) {
      return { ok: false as const, error: "Both conversations must exist in this product." };
    }
    if (source.customerId !== target.customerId) {
      return {
        ok: false as const,
        error: "Only conversations from the same customer can be merged.",
      };
    }
    if (target.status === "archived" || target.status === "spam") {
      return {
        ok: false as const,
        error: "Choose an active target conversation.",
      };
    }

    const now = input.now ?? new Date();
    const moved = await tx
      .update(conversationMessages)
      .set({ conversationId: target.id })
      .where(
        and(
          eq(conversationMessages.conversationId, source.id),
          eq(conversationMessages.productId, input.productId),
        ),
      )
      .returning({ id: conversationMessages.id });

    await tx
      .update(conversationAttachments)
      .set({ conversationId: target.id })
      .where(
        and(
          eq(conversationAttachments.conversationId, source.id),
          eq(conversationAttachments.productId, input.productId),
        ),
      );

    const sourceTags = await tx
      .select({ tagId: conversationTagLinks.tagId })
      .from(conversationTagLinks)
      .where(
        and(
          eq(conversationTagLinks.conversationId, source.id),
          eq(conversationTagLinks.productId, input.productId),
        ),
      );
    let movedTags = 0;
    if (sourceTags.length > 0) {
      await tx
        .delete(conversationTagLinks)
        .where(
          and(
            eq(conversationTagLinks.conversationId, source.id),
            eq(conversationTagLinks.productId, input.productId),
          ),
        );
      const inserted = await tx
        .insert(conversationTagLinks)
        .values(
          sourceTags.map((tag) => ({
            conversationId: target.id,
            productId: input.productId,
            tagId: tag.tagId,
          })),
        )
        .onConflictDoNothing()
        .returning({ tagId: conversationTagLinks.tagId });
      movedTags = inserted.length;
    }

    await tx
      .update(conversations)
      .set({
        lastMessageAt:
          source.lastMessageAt > target.lastMessageAt
            ? source.lastMessageAt
            : target.lastMessageAt,
        lastMessagePreview:
          source.lastMessageAt > target.lastMessageAt
            ? source.lastMessagePreview
            : target.lastMessagePreview,
        unreadForTeam: target.unreadForTeam + source.unreadForTeam,
        updatedAt: now,
      })
      .where(eq(conversations.id, target.id));

    await tx
      .update(conversations)
      .set({ status: "archived", snoozedUntil: null, resolvedAt: null, updatedAt: now })
      .where(eq(conversations.id, source.id));

    await tx.insert(conversationMessages).values({
      conversationId: target.id,
      productId: input.productId,
      authorType: "system",
      kind: "note",
      channel: "team",
      body: `Merged duplicate conversation “${source.subject}” into this thread.`,
      createdAt: now,
    });

    await tx.insert(conversationMerges).values({
      productId: input.productId,
      customerId: source.customerId,
      sourceConversationId: source.id,
      targetConversationId: target.id,
      movedMessages: moved.length,
      movedTags,
      createdBy: input.userId,
      createdAt: now,
    });

    return {
      ok: true as const,
      data: { targetConversationId: target.id, movedMessages: moved.length },
    };
  });
}

export async function assignNextConversation(input: {
  productId: string;
  workspaceId: string;
  conversationId: string;
  now?: Date;
}): Promise<
  ServiceResult<{ assigneeId: string; assigneeName: string }>
> {
  const members = await db
    .select({
      id: user.id,
      name: user.name,
      lastSeenAt: workspaceOperators.lastSeenAt,
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

  if (members.length === 0) {
    return {
      ok: false,
      error: "Add an owner or admin before assigning conversations.",
    };
  }

  const workload = await db
    .select({
      assigneeId: conversations.assigneeId,
      active: count(),
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.productId, input.productId),
        inArray(conversations.status, ["queue", "open", "snoozed"]),
        isNotNull(conversations.assigneeId),
      ),
    )
    .groupBy(conversations.assigneeId);

  const activeByUser = new Map(
    workload
      .filter((row): row is { assigneeId: string; active: number } =>
        Boolean(row.assigneeId),
      )
      .map((row) => [row.assigneeId, row.active]),
  );

  const picked = pickLeastLoaded(
    members.map((member) => ({
      id: member.id,
      name: member.name,
      active: activeByUser.get(member.id) ?? 0,
      lastSeenAt: member.lastSeenAt?.getTime() ?? null,
    })),
  );
  if (!picked) {
    return { ok: false, error: "No operator is available to assign." };
  }

  const now = input.now ?? new Date();
  const updated = await db
    .update(conversations)
    .set({ assigneeId: picked.id, updatedAt: now })
    .where(scopedConversation(input.productId, input.conversationId))
    .returning({ id: conversations.id });

  if (updated.length === 0) {
    return { ok: false, error: "That conversation no longer exists." };
  }
  return {
    ok: true,
    data: { assigneeId: picked.id, assigneeName: picked.name },
  };
}

export async function snoozeConversation(input: {
  productId: string;
  conversationId: string;
  minutes: number;
  now?: Date;
}): Promise<ServiceResult<{ snoozedUntil: string }>> {
  if (parseSnoozeMinutes(String(input.minutes)) === null) {
    return { ok: false, error: "Snooze between 5 minutes and 30 days." };
  }

  const now = input.now ?? new Date();
  const snoozedUntil = new Date(now.getTime() + input.minutes * 60_000);
  const updated = await db
    .update(conversations)
    .set({
      status: "snoozed",
      snoozedUntil,
      resolvedAt: null,
      updatedAt: now,
    })
    .where(scopedConversation(input.productId, input.conversationId))
    .returning({ id: conversations.id });

  if (updated.length === 0) {
    return { ok: false, error: "That conversation no longer exists." };
  }
  return { ok: true, data: { snoozedUntil: snoozedUntil.toISOString() } };
}

/**
 * Block the sender and move the thread to Spam.
 *
 * The workspace-level block is what prevents new threads; the status change
 * takes the current one out of the inbox in the same transaction.
 */
export async function blockConversationSender(input: {
  productId: string;
  workspaceId: string;
  conversationId: string;
  userId: string;
  now?: Date;
}): Promise<ServiceResult<{ blocked: true }>> {
  const rows = await db
    .select({ conversation: conversations, customer: customers })
    .from(conversations)
    .innerJoin(customers, eq(conversations.customerId, customers.id))
    .where(scopedConversation(input.productId, input.conversationId))
    .limit(1);

  const row = rows[0];
  if (!row) return { ok: false, error: "That conversation no longer exists." };

  const now = input.now ?? new Date();

  await db.transaction(async (tx) => {
    await tx
      .insert(blockedCustomers)
      .values({
        workspaceId: input.workspaceId,
        customerId: row.customer.id,
        emailNormalized: row.customer.emailNormalized,
        reason: "Blocked from a conversation",
        createdBy: input.userId,
      })
      .onConflictDoNothing();

    await tx
      .update(conversations)
      .set({ status: "spam", snoozedUntil: null, updatedAt: now })
      .where(scopedConversation(input.productId, row.conversation.id));
  });

  return { ok: true, data: { blocked: true } };
}

/**
 * Move a held thread back to Queue and preserve why the rule was wrong.
 *
 * The feedback row is the false-positive loop: the spam screen can report which
 * reason codes keep being overruled without changing the message itself.
 */
export async function markConversationNotSpam(input: {
  productId: string;
  conversationId: string;
  userId: string;
  now?: Date;
}): Promise<ServiceResult<{ updated: number }>> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ spamReason: conversations.spamReason })
      .from(conversations)
      .where(scopedConversation(input.productId, input.conversationId))
      .limit(1);
    const row = rows[0];
    if (!row) return { ok: false as const, error: "That conversation no longer exists." };

    const updated = await tx
      .update(conversations)
      .set({ status: "queue", resolvedAt: null, snoozedUntil: null, updatedAt: now })
      .where(scopedConversation(input.productId, input.conversationId))
      .returning({ id: conversations.id });

    await tx.insert(conversationMessages).values({
      conversationId: input.conversationId,
      productId: input.productId,
      authorType: "system",
      kind: "note",
      channel: "team",
      body: row.spamReason
        ? `Marked not spam. The pre-inbox rule reported: ${row.spamReason}.`
        : "Marked not spam by an operator.",
      createdAt: now,
    });

    await recordSpamFeedback({
      productId: input.productId,
      conversationId: input.conversationId,
      reasons: row.spamReason,
      userId: input.userId,
      now,
    });

    return { ok: true as const, data: { updated: updated.length } };
  });
}

export async function setConversationReminder(input: {
  productId: string;
  conversationId: string;
  userId: string;
  remindAt: Date;
  now?: Date;
}): Promise<ServiceResult<{ reminderId: string }>> {
  const now = input.now ?? new Date();
  if (Number.isNaN(input.remindAt.getTime())) {
    return { ok: false, error: "Choose a valid reminder time." };
  }
  if (input.remindAt.getTime() <= now.getTime()) {
    return { ok: false, error: "Choose a time in the future." };
  }
  if (input.remindAt.getTime() > now.getTime() + 90 * 24 * 60 * 60 * 1000) {
    return { ok: false, error: "Reminders can be at most 90 days away." };
  }

  const exists = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(scopedConversation(input.productId, input.conversationId))
    .limit(1);
  if (!exists[0]) {
    return { ok: false, error: "That conversation no longer exists." };
  }

  return db.transaction(async (tx) => {
    const active = await tx
      .select({ id: conversationReminders.id })
      .from(conversationReminders)
      .where(
        and(
          eq(conversationReminders.conversationId, input.conversationId),
          eq(conversationReminders.userId, input.userId),
          isNull(conversationReminders.completedAt),
        ),
      )
      .limit(1);

    if (active[0]) {
      await tx
        .update(conversationReminders)
        .set({ remindAt: input.remindAt })
        .where(eq(conversationReminders.id, active[0].id));
      return { ok: true as const, data: { reminderId: active[0].id } };
    }

    const inserted = await tx
      .insert(conversationReminders)
      .values({
        conversationId: input.conversationId,
        productId: input.productId,
        userId: input.userId,
        remindAt: input.remindAt,
      })
      .returning({ id: conversationReminders.id });

    const reminder = inserted[0];
    if (!reminder) {
      return { ok: false as const, error: "Could not save the reminder." };
    }
    return { ok: true as const, data: { reminderId: reminder.id } };
  });
}

export async function saveConversationDraft(input: {
  productId: string;
  conversationId: string;
  userId: string;
  body: string;
  now?: Date;
}): Promise<ServiceResult<{ saved: boolean }>> {
  const body = input.body.slice(0, 10_000);
  const exists = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(scopedConversation(input.productId, input.conversationId))
    .limit(1);
  if (!exists[0]) {
    return { ok: false, error: "That conversation no longer exists." };
  }

  if (body.trim() === "") {
    await db
      .delete(conversationDrafts)
      .where(
        and(
          eq(conversationDrafts.conversationId, input.conversationId),
          eq(conversationDrafts.userId, input.userId),
        ),
      );
    return { ok: true, data: { saved: false } };
  }

  const now = input.now ?? new Date();
  await db
    .insert(conversationDrafts)
    .values({
      conversationId: input.conversationId,
      productId: input.productId,
      userId: input.userId,
      body,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [conversationDrafts.conversationId, conversationDrafts.userId],
      set: { body, updatedAt: now },
    });

  return { ok: true, data: { saved: true } };
}

export async function completeConversationReminder(input: {
  userId: string;
  reminderId: string;
  now?: Date;
}): Promise<{ updated: number }> {
  const now = input.now ?? new Date();
  const updated = await db
    .update(conversationReminders)
    .set({ completedAt: now })
    .where(
      and(
        eq(conversationReminders.id, input.reminderId),
        eq(conversationReminders.userId, input.userId),
        isNull(conversationReminders.completedAt),
      ),
    )
    .returning({ id: conversationReminders.id });

  return { updated: updated.length };
}
