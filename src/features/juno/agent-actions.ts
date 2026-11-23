import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { conversationMessages, conversations } from "@/db/schema/conversations";
import { customers } from "@/db/schema/customers";
import {
  agentActionRuns,
  agentActionSettings,
  type AgentActionRun,
} from "@/db/schema/knowledge";
import { notificationDeliveries, buildDeliveryDedupeKey } from "@/db/schema/notifications";
import { recordWorkspaceAudit } from "@/features/data-controls/service";
import { enqueueJob } from "@/features/jobs/queue";
import { normalizeEmail } from "@/lib/email";
import { logEvent, serializeError } from "@/lib/logger";

import { detectRequestedAgentAction } from "./agent-action-policy";

/**
 * Rule-bounded agent actions.
 *
 * The registry is closed: adding an action requires code, a migration and a
 * reviewed setting. There is deliberately no generic "call this API" action,
 * and no path to settings, billing, deletion or identity. Every action has a
 * durable run row; a queued email also has its normal delivery row.
 */

export const AGENT_ACTIONS = [
  {
    kind: "send_transcript" as const,
    label: "Email a conversation transcript",
    description:
      "When a customer explicitly asks for a copy of the conversation, email up to 50 public messages to the address on the thread.",
  },
] as const;

export type AgentActionKind = (typeof AGENT_ACTIONS)[number]["kind"];

const ACTION_BY_KIND = new Map(AGENT_ACTIONS.map((action) => [action.kind, action]));

export function isAgentActionKind(value: string): value is AgentActionKind {
  return ACTION_BY_KIND.has(value as AgentActionKind);
}

export type AgentActionSettingView = {
  kind: AgentActionKind;
  label: string;
  description: string;
  enabled: boolean;
  reviewedAt: string | null;
};

export async function listAgentActionSettings(
  productId: string,
): Promise<AgentActionSettingView[]> {
  const rows = await db
    .select()
    .from(agentActionSettings)
    .where(eq(agentActionSettings.productId, productId));
  const byKind = new Map(rows.map((row) => [row.action, row]));

  return AGENT_ACTIONS.map((action) => {
    const row = byKind.get(action.kind);
    return {
      ...action,
      enabled: row?.enabled ?? false,
      reviewedAt: row?.reviewedAt?.toISOString() ?? null,
    };
  });
}

export async function saveAgentActionSetting(input: {
  workspaceId: string;
  productId: string;
  action: AgentActionKind;
  enabled: boolean;
  userId: string;
  now?: Date;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const now = input.now ?? new Date();
  const definition = ACTION_BY_KIND.get(input.action);
  if (!definition) return { ok: false, error: "Choose a supported action." };

  if (input.enabled) {
    await db
      .insert(agentActionSettings)
      .values({
        productId: input.productId,
        action: input.action,
        enabled: true,
        reviewedBy: input.userId,
        reviewedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [agentActionSettings.productId, agentActionSettings.action],
        set: {
          enabled: true,
          reviewedBy: input.userId,
          reviewedAt: now,
          updatedAt: now,
        },
      });
  } else {
    await db
      .insert(agentActionSettings)
      .values({
        productId: input.productId,
        action: input.action,
        enabled: false,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [agentActionSettings.productId, agentActionSettings.action],
        set: { enabled: false, updatedAt: now },
      });
  }

  await recordWorkspaceAudit({
    workspaceId: input.workspaceId,
    actorUserId: input.userId,
    action: input.enabled
      ? "agent_action.enabled"
      : "agent_action.disabled",
    targetType: "agent_action",
    targetId: input.action,
  }).catch(() => undefined);

  return { ok: true };
}

export async function listAgentActionRuns(
  productId: string,
  limit = 10,
): Promise<
  (Pick<AgentActionRun, "id" | "action" | "status" | "detail" | "createdAt"> & {
    conversationSubject: string | null;
    customerName: string | null;
  })[]
> {
  const rows = await db
    .select({
      id: agentActionRuns.id,
      action: agentActionRuns.action,
      status: agentActionRuns.status,
      detail: agentActionRuns.detail,
      createdAt: agentActionRuns.createdAt,
      conversationSubject: conversations.subject,
      customerName: customers.name,
    })
    .from(agentActionRuns)
    .innerJoin(
      conversations,
      and(
        eq(agentActionRuns.conversationId, conversations.id),
        eq(agentActionRuns.productId, conversations.productId),
      ),
    )
    .innerJoin(customers, eq(conversations.customerId, customers.id))
    .where(eq(agentActionRuns.productId, productId))
    .orderBy(desc(agentActionRuns.createdAt))
    .limit(Math.min(Math.max(limit, 1), 50));

  return rows;
}

type ActionExecution =
  | { handled: false }
  | { handled: true; queued: true; messageId: string; runId: string }
  | { handled: true; queued: false; reason: string; detail: string };

async function recordRun(input: {
  productId: string;
  conversationId: string;
  action: AgentActionKind;
  status: "queued" | "skipped" | "failed";
  detail: string;
  deliveryId?: string | null;
  messageId?: string | null;
}): Promise<string> {
  const rows = await db
    .insert(agentActionRuns)
    .values({
      productId: input.productId,
      conversationId: input.conversationId,
      action: input.action,
      status: input.status,
      detail: input.detail.slice(0, 1_000),
      deliveryId: input.deliveryId ?? null,
      messageId: input.messageId ?? null,
    })
    .returning({ id: agentActionRuns.id });
  const id = rows[0]?.id;
  if (!id) throw new Error("Agent action run insert returned no row.");
  return id;
}

export async function executeRequestedAgentAction(input: {
  productId: string;
  conversationId: string;
  question: string;
  now?: Date;
}): Promise<ActionExecution> {
  const action = detectRequestedAgentAction(input.question);
  if (!action) return { handled: false };

  const now = input.now ?? new Date();
  const settings = await db
    .select()
    .from(agentActionSettings)
    .where(
      and(
        eq(agentActionSettings.productId, input.productId),
        eq(agentActionSettings.action, action),
      ),
    )
    .limit(1);
  const setting = settings[0];
  if (!setting?.enabled || !setting.reviewedBy) {
    return {
      handled: true,
      queued: false,
      reason: "disabled",
      detail: "The transcript action is not enabled for this product.",
    };
  }

  const rows = await db
    .select({
      conversation: conversations,
      customerEmail: customers.email,
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
  const row = rows[0];
  if (!row) {
    return {
      handled: true,
      queued: false,
      reason: "missing",
      detail: "The conversation no longer exists.",
    };
  }

  const email = row.customerEmail?.trim() ?? "";
  if (email === "") {
    await recordRun({
      productId: input.productId,
      conversationId: input.conversationId,
      action,
      status: "skipped",
      detail: "No customer email address is available for a transcript.",
    }).catch(() => undefined);
    return {
      handled: true,
      queued: false,
      reason: "no_email",
      detail: "The customer has no email address on this thread.",
    };
  }

  let runId: string | null = null;
  let deliveryId: string | null = null;
  try {
    runId = await recordRun({
      productId: input.productId,
      conversationId: input.conversationId,
      action,
      status: "queued",
      detail: "Transcript email queued.",
    });

    const normalized = normalizeEmail(email);
    const dedupeKey = buildDeliveryDedupeKey({
      template: "conversation_transcript",
      productId: input.productId,
      recipientEmailNormalized: normalized,
      sourceId: `agent-action:${runId}`,
    });
    const deliveries = await db
      .insert(notificationDeliveries)
      .values({
        workspaceId: row.conversation.workspaceId,
        productId: input.productId,
        template: "conversation_transcript",
        conversationId: input.conversationId,
        recipientCustomerId: row.conversation.customerId,
        recipientEmail: email,
        recipientEmailNormalized: normalized,
        dedupeKey,
        status: "pending",
      })
      .returning({ id: notificationDeliveries.id });
    deliveryId = deliveries[0]?.id ?? null;
    if (!deliveryId) throw new Error("Delivery insert returned no row.");

    await db
      .update(agentActionRuns)
      .set({ deliveryId })
      .where(eq(agentActionRuns.id, runId));

    await enqueueJob({
      type: "send_email",
      payload: { deliveryId },
      dedupeKey: `agent-action:${runId}`,
    });

    const messageRows = await db
      .insert(conversationMessages)
      .values({
        conversationId: input.conversationId,
        productId: input.productId,
        authorType: "juno",
        channel: "team",
        body: "I’ve emailed a copy of this conversation to the address on file.",
        createdAt: now,
      })
      .returning({ id: conversationMessages.id });
    const messageId = messageRows[0]?.id;
    if (!messageId) throw new Error("Action message insert returned no row.");

    await db
      .update(conversations)
      .set({
        lastMessagePreview: "I’ve emailed a copy of this conversation to the address on file.",
        lastMessageAt: now,
        updatedAt: now,
        unreadForCustomer: sql`${conversations.unreadForCustomer} + 1`,
      })
      .where(eq(conversations.id, input.conversationId));

    await db
      .update(agentActionRuns)
      .set({ messageId })
      .where(eq(agentActionRuns.id, runId));

    await recordWorkspaceAudit({
      workspaceId: row.conversation.workspaceId,
      actorUserId: null,
      action: "agent_action.send_transcript",
      targetType: "conversation",
      targetId: input.conversationId,
      metadata: { deliveryId, actionRunId: runId },
    }).catch(() => undefined);

    return { handled: true, queued: true, messageId, runId };
  } catch (error) {
    logEvent("error", "agent_action.failed", { error: serializeError(error) });
    if (runId) {
      await db
        .update(agentActionRuns)
        .set({ status: "failed", detail: "Could not queue the transcript email." })
        .where(eq(agentActionRuns.id, runId))
        .catch(() => undefined);
    }
    return {
      handled: true,
      queued: false,
      reason: "failed",
      detail: "The transcript could not be queued.",
    };
  }
}
