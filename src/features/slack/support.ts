import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  conversationMessages,
  conversations,
  slackConversationLinks,
  slackIntegrations,
  type SlackConversationLink,
  type SlackIntegration,
} from "@/db/schema";
import { resolveCustomer } from "@/features/api-v1/service";
import { enqueueJob } from "@/features/jobs/queue";
import { logEvent, serializeError } from "@/lib/logger";

/**
 * Slack as a support channel.
 *
 * A top-level `!support …` message starts a conversation; replies in that
 * thread append customer messages. The link row is the only mapping: the
 * channel integration is resolved first, then the thread must belong to the
 * same product. A reply in any other thread is ignored, so filing feedback from
 * Slack keeps working unchanged.
 */

const MAX_MESSAGE_CHARS = 20_000;

export type SlackSupportCommand = { body: string };

/** Returns the support body for `!support …`; null for ordinary messages. */
export function parseSupportCommand(text: string): SlackSupportCommand | null {
  const match = /^!support\b[ \t]*([\s\S]*)$/i.exec(text.trim());
  if (!match) return null;
  return { body: (match[1] ?? "").trim().slice(0, MAX_MESSAGE_CHARS) };
}

export async function findSlackSupportLink(input: {
  teamId: string;
  channelId: string;
  threadTs: string;
}): Promise<SlackConversationLink | null> {
  const rows = await db
    .select()
    .from(slackConversationLinks)
    .where(
      and(
        eq(slackConversationLinks.teamId, input.teamId),
        eq(slackConversationLinks.channelId, input.channelId),
        eq(slackConversationLinks.threadTs, input.threadTs),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export type SlackSupportResult =
  | { ok: true; conversationId: string; created: boolean; duplicate: boolean }
  | { ok: false; error: string };

function slackExternalId(input: {
  teamId: string;
  channelId: string;
  messageTs: string;
}): string {
  return `slack:${input.teamId}:${input.channelId}:${input.messageTs}`;
}

function subjectFor(body: string): string {
  const firstLine = body.split("\n")[0]?.replace(/\s+/g, " ").trim() ?? "";
  return (firstLine || "Slack support thread").slice(0, 160);
}

/**
 * Start a conversation from a top-level `!support` message.
 *
 * The Slack user becomes a workspace customer keyed by team + user, so the
 * same person keeps one identity across threads without leaking into another
 * workspace. Repeating the same Slack event returns the original conversation.
 */
export async function startSlackSupportThread(input: {
  integration: SlackIntegration;
  teamId: string;
  channelId: string;
  messageTs: string;
  body: string;
  authorName: string;
  slackUserId: string;
  now?: Date;
}): Promise<SlackSupportResult> {
  const body = input.body.trim();
  if (body === "") {
    return { ok: false, error: "Write a message after `!support`." };
  }

  const existing = await findSlackSupportLink({
    teamId: input.teamId,
    channelId: input.channelId,
    threadTs: input.messageTs,
  });
  if (existing) {
    return {
      ok: true,
      conversationId: existing.conversationId,
      created: false,
      duplicate: true,
    };
  }

  const identity = `${input.teamId}:${input.slackUserId || input.authorName}`;
  const customer = await resolveCustomer(input.integration.workspaceId, {
    external_id: `slack:${identity}`.slice(0, 200),
    name: input.authorName,
  });
  if (!customer) return { ok: false, error: "Could not resolve the Slack author." };

  const now = input.now ?? new Date();
  try {
    const conversationId = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(conversations)
        .values({
          workspaceId: input.integration.workspaceId,
          productId: input.integration.productId,
          customerId: customer.id,
          subject: subjectFor(body),
          status: "queue",
          sourceContext: { channel: "slack" },
          lastMessagePreview: body.slice(0, 160),
          lastMessageAt: now,
          lastCustomerMessageAt: now,
          unreadForTeam: 1,
          updatedAt: now,
        })
        .returning({ id: conversations.id });
      const conversation = inserted[0];
      if (!conversation) throw new Error("Support conversation insert returned no row.");

      await tx
        .insert(conversationMessages)
        .values({
          conversationId: conversation.id,
          productId: input.integration.productId,
          authorType: "customer",
          authorCustomerId: customer.id,
          channel: "slack",
          externalId: slackExternalId(input),
          body,
          createdAt: now,
        })
        .onConflictDoNothing();

      await tx.insert(slackConversationLinks).values({
        workspaceId: input.integration.workspaceId,
        productId: input.integration.productId,
        conversationId: conversation.id,
        teamId: input.teamId,
        channelId: input.channelId,
        threadTs: input.messageTs,
        createdBySlackUser: input.slackUserId || null,
      });

      return conversation.id;
    });

    return { ok: true, conversationId, created: true, duplicate: false };
  } catch (error) {
    // A Slack retry can race the first job; return the winner instead of
    // creating a second thread.
    const raced = await findSlackSupportLink({
      teamId: input.teamId,
      channelId: input.channelId,
      threadTs: input.messageTs,
    });
    if (raced) {
      return {
        ok: true,
        conversationId: raced.conversationId,
        created: false,
        duplicate: true,
      };
    }
    logEvent("warn", "slack.support_start_failed", {
      productId: input.integration.productId,
      error: serializeError(error),
    });
    return { ok: false, error: "Could not start the support thread." };
  }
}

/**
 * Append a reply to the mapped support thread.
 *
 * A reply in an unmapped thread returns null: it is ordinary channel chatter,
 * not a support message. The message id is stored as `externalId` so Slack's
 * retry is inert.
 */
export async function appendSlackSupportReply(input: {
  integration: SlackIntegration;
  teamId: string;
  channelId: string;
  threadTs: string;
  messageTs: string;
  body: string;
  now?: Date;
}): Promise<SlackSupportResult | null> {
  const link = await findSlackSupportLink({
    teamId: input.teamId,
    channelId: input.channelId,
    threadTs: input.threadTs,
  });
  if (!link || link.productId !== input.integration.productId) return null;

  const body = input.body.trim();
  if (body === "") return { ok: false, error: "The reply is empty." };
  const now = input.now ?? new Date();

  const result = await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.id, link.conversationId),
          eq(conversations.productId, input.integration.productId),
        ),
      )
      .limit(1)
      .for("update");
    const conversation = rows[0];
    if (!conversation) return null;

    const inserted = await tx
      .insert(conversationMessages)
      .values({
        conversationId: conversation.id,
        productId: conversation.productId,
        authorType: "customer",
        authorCustomerId: conversation.customerId,
        channel: "slack",
        externalId: slackExternalId(input),
        body,
        createdAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: conversationMessages.id });

    if (!inserted[0]) {
      return { conversationId: conversation.id, duplicate: true };
    }

    // A customer reply reopens a finished thread; other states are kept.
    const status =
      conversation.status === "resolved" || conversation.status === "archived"
        ? "open"
        : conversation.status;

    await tx
      .update(conversations)
      .set({
        status,
        unreadForTeam: sql`${conversations.unreadForTeam} + 1`,
        lastMessagePreview: body.slice(0, 160),
        lastMessageAt: now,
        lastCustomerMessageAt: now,
        updatedAt: now,
      })
      .where(eq(conversations.id, conversation.id));

    return { conversationId: conversation.id, duplicate: false };
  });

  if (!result) return null;
  return {
    ok: true,
    conversationId: result.conversationId,
    created: false,
    duplicate: result.duplicate,
  };
}

/**
 * Mirror a team reply into the Slack thread, when the conversation came from
 * Slack. Best-effort: the dashboard write must never fail because Slack is
 * down, and the job dedupe key makes a re-run inert.
 */
export async function queueSlackSupportMirror(input: {
  productId: string;
  conversationId: string;
  messageId: string;
  body: string;
}): Promise<void> {
  try {
    const rows = await db
      .select({
        teamId: slackConversationLinks.teamId,
        channelId: slackConversationLinks.channelId,
        threadTs: slackConversationLinks.threadTs,
      })
      .from(slackConversationLinks)
      .innerJoin(
        slackIntegrations,
        and(
          eq(slackIntegrations.teamId, slackConversationLinks.teamId),
          eq(slackIntegrations.channelId, slackConversationLinks.channelId),
          eq(slackIntegrations.active, true),
        ),
      )
      .where(
        and(
          eq(slackConversationLinks.conversationId, input.conversationId),
          eq(slackConversationLinks.productId, input.productId),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return;

    await enqueueJob({
      type: "slack_support_mirror",
      dedupeKey: `slack-support-mirror:${input.messageId}`,
      payload: {
        messageId: input.messageId,
        teamId: row.teamId,
        channelId: row.channelId,
        threadTs: row.threadTs,
        text: input.body.slice(0, 10_000),
      },
    });
  } catch (error) {
    logEvent("warn", "slack.support_mirror_enqueue_failed", {
      productId: input.productId,
      conversationId: input.conversationId,
      error: serializeError(error),
    });
  }
}
