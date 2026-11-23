import "server-only";

import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  webhookDeliveries,
  webhooks,
  type WebhookDeliveryStatus,
  type WebhookEvent,
} from "@/db/schema";
import { recordWorkspaceAudit } from "@/features/data-controls/service";
import { logEvent, serializeError } from "@/lib/logger";
import { currentRequestId } from "@/lib/observability/context";
import { withSpan } from "@/lib/observability/tracing";
import { isSandboxMode } from "@/lib/sandbox";

import { webhookExampleEnvelope } from "./catalog";
import {
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_SECRET_OVERLAP_MS,
  createWebhookSecret,
  nextAttemptDelayMs,
  signWebhookPayload,
  validateWebhookUrl,
} from "./sign";

/**
 * Outbound webhook storage and delivery.
 *
 * Enqueue and mutation commit together when possible: the v1 service calls the
 * emitter after its write, and the emitter swallows failures so a broken
 * webhook configuration can never fail a customer request.
 *
 * Delivery workers claim due rows with `FOR UPDATE SKIP LOCKED` and push
 * `next_attempt_at` forward as a lease before calling out. A retry therefore
 * cannot send the same row twice concurrently, and a crash after the lease is
 * recoverable after the lease window.
 */

const LEASE_MS = 60_000;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_ERROR_LENGTH = 500;

export type WebhookSummary = {
  id: string;
  name: string;
  url: string;
  events: WebhookEvent[];
  active: boolean;
  previousSecretExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type DeliverySummary = {
  id: string;
  event: string;
  status: WebhookDeliveryStatus;
  attempts: number;
  responseStatus: number | null;
  error: string | null;
  nextAttemptAt: Date;
  lastAttemptAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
};

export async function createWebhook(input: {
  workspaceId: string;
  userId: string | null;
  name: string;
  url: string;
  events: WebhookEvent[];
  allowPrivate?: boolean;
}): Promise<{ ok: true; id: string; secret: string } | { ok: false; error: string }> {
  const url = validateWebhookUrl(input.url, { allowPrivate: input.allowPrivate });
  if (!url.ok) return { ok: false, error: url.reason };

  const events = [...new Set(input.events)];
  if (events.length === 0) {
    return { ok: false, error: "Choose at least one event." };
  }

  const secret = createWebhookSecret();
  const inserted = await db
    .insert(webhooks)
    .values({
      workspaceId: input.workspaceId,
      name: input.name,
      url: url.url.toString(),
      secret,
      events,
      createdBy: input.userId,
    })
    .returning({ id: webhooks.id });

  const id = inserted[0]?.id;
  if (!id) throw new Error("Webhook insert returned no row.");
  return { ok: true, id, secret };
}

export async function listWebhooks(workspaceId: string): Promise<WebhookSummary[]> {
  return db
    .select({
      id: webhooks.id,
      name: webhooks.name,
      url: webhooks.url,
      events: webhooks.events,
      active: webhooks.active,
      previousSecretExpiresAt: webhooks.previousSecretExpiresAt,
      createdAt: webhooks.createdAt,
      updatedAt: webhooks.updatedAt,
    })
    .from(webhooks)
    .where(eq(webhooks.workspaceId, workspaceId))
    .orderBy(desc(webhooks.createdAt));
}

export async function revokeWebhook(
  workspaceId: string,
  webhookId: string,
): Promise<boolean> {
  const rows = await db
    .update(webhooks)
    .set({ active: false, updatedAt: new Date() })
    .where(and(eq(webhooks.id, webhookId), eq(webhooks.workspaceId, workspaceId)))
    .returning({ id: webhooks.id });
  return Boolean(rows[0]);
}

/**
 * Rotate a signing secret with an overlap window.
 *
 * The old secret stays valid (and is sent as a second signature) for 24 hours,
 * so a receiver can deploy the replacement without losing deliveries already
 * in flight. The new secret is returned once and never listed.
 */
export async function rotateWebhookSecret(input: {
  workspaceId: string;
  webhookId: string;
  userId: string | null;
  now?: Date;
}): Promise<{ secret: string; previousValidUntil: Date } | null> {
  const now = input.now ?? new Date();
  const secret = createWebhookSecret();
  const previousValidUntil = new Date(now.getTime() + WEBHOOK_SECRET_OVERLAP_MS);

  const rows = await db
    .update(webhooks)
    .set({
      previousSecret: sql`${webhooks.secret}`,
      previousSecretExpiresAt: previousValidUntil,
      secret,
      updatedAt: now,
    })
    .where(
      and(eq(webhooks.id, input.webhookId), eq(webhooks.workspaceId, input.workspaceId)),
    )
    .returning({ id: webhooks.id });
  if (!rows[0]) return null;

  await recordWorkspaceAudit({
    workspaceId: input.workspaceId,
    actorUserId: input.userId,
    action: "webhook.secret_rotated",
    targetType: "webhook",
    targetId: input.webhookId,
    metadata: { overlap_ends_at: previousValidUntil.toISOString() },
  });

  return { secret, previousValidUntil };
}

/** Queue one real test delivery through the normal signed delivery path. */
export async function enqueueTestWebhookDelivery(input: {
  workspaceId: string;
  webhookId: string;
  event: WebhookEvent;
  userId: string | null;
  now?: Date;
}): Promise<{ id: string } | { error: string }> {
  const rows = await db
    .select({ id: webhooks.id, events: webhooks.events, active: webhooks.active })
    .from(webhooks)
    .where(and(eq(webhooks.id, input.webhookId), eq(webhooks.workspaceId, input.workspaceId)))
    .limit(1);
  const hook = rows[0];
  if (!hook) return { error: "Webhook not found." };
  if (!hook.active) return { error: "Enable this endpoint before sending a test event." };
  if (!hook.events.includes(input.event)) {
    return { error: "This endpoint does not subscribe to that event." };
  }

  const now = input.now ?? new Date();
  const payload = webhookExampleEnvelope(input.event, { test: true });
  const inserted = await db
    .insert(webhookDeliveries)
    .values({
      workspaceId: input.workspaceId,
      webhookId: input.webhookId,
      event: input.event,
      payload,
      status: "pending",
      attempts: 0,
      nextAttemptAt: now,
      createdAt: now,
    })
    .returning({ id: webhookDeliveries.id });
  const id = inserted[0]?.id;
  if (!id) return { error: "The test delivery could not be queued." };

  await recordWorkspaceAudit({
    workspaceId: input.workspaceId,
    actorUserId: input.userId,
    action: "webhook.test_queued",
    targetType: "webhook",
    targetId: input.webhookId,
    metadata: { event: input.event, delivery_id: id },
  });
  return { id };
}

export async function listDeliveries(input: {
  workspaceId: string;
  webhookId: string;
  limit?: number | undefined;
  status?: WebhookDeliveryStatus | undefined;
}): Promise<DeliverySummary[] | null> {
  const hook = await db
    .select({ id: webhooks.id })
    .from(webhooks)
    .where(and(eq(webhooks.id, input.webhookId), eq(webhooks.workspaceId, input.workspaceId)))
    .limit(1);
  if (!hook[0]) return null;

  return db
    .select({
      id: webhookDeliveries.id,
      event: webhookDeliveries.event,
      status: webhookDeliveries.status,
      attempts: webhookDeliveries.attempts,
      responseStatus: webhookDeliveries.responseStatus,
      error: webhookDeliveries.error,
      nextAttemptAt: webhookDeliveries.nextAttemptAt,
      lastAttemptAt: webhookDeliveries.lastAttemptAt,
      deliveredAt: webhookDeliveries.deliveredAt,
      createdAt: webhookDeliveries.createdAt,
    })
    .from(webhookDeliveries)
    .where(
      and(
        eq(webhookDeliveries.workspaceId, input.workspaceId),
        eq(webhookDeliveries.webhookId, input.webhookId),
        ...(input.status ? [eq(webhookDeliveries.status, input.status)] : []),
      ),
    )
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(Math.min(Math.max(input.limit ?? 25, 1), 100));
}

export type WorkspaceDeliverySummary = DeliverySummary & {
  webhook: { id: string; name: string; url: string };
};

/** The workspace-wide log, used for the failed-delivery (dead-letter) view. */
export async function listWorkspaceDeliveries(input: {
  workspaceId: string;
  status?: WebhookDeliveryStatus;
  limit?: number;
}): Promise<WorkspaceDeliverySummary[]> {
  const rows = await db
    .select({
      id: webhookDeliveries.id,
      event: webhookDeliveries.event,
      status: webhookDeliveries.status,
      attempts: webhookDeliveries.attempts,
      responseStatus: webhookDeliveries.responseStatus,
      error: webhookDeliveries.error,
      nextAttemptAt: webhookDeliveries.nextAttemptAt,
      lastAttemptAt: webhookDeliveries.lastAttemptAt,
      deliveredAt: webhookDeliveries.deliveredAt,
      createdAt: webhookDeliveries.createdAt,
      webhookId: webhooks.id,
      webhookName: webhooks.name,
      webhookUrl: webhooks.url,
    })
    .from(webhookDeliveries)
    .innerJoin(webhooks, eq(webhookDeliveries.webhookId, webhooks.id))
    .where(
      and(
        eq(webhookDeliveries.workspaceId, input.workspaceId),
        ...(input.status ? [eq(webhookDeliveries.status, input.status)] : []),
      ),
    )
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(Math.min(Math.max(input.limit ?? 50, 1), 100));

  return rows.map((row) => ({
    id: row.id,
    event: row.event,
    status: row.status,
    attempts: row.attempts,
    responseStatus: row.responseStatus,
    error: row.error,
    nextAttemptAt: row.nextAttemptAt,
    lastAttemptAt: row.lastAttemptAt,
    deliveredAt: row.deliveredAt,
    createdAt: row.createdAt,
    webhook: { id: row.webhookId, name: row.webhookName, url: row.webhookUrl },
  }));
}

/**
 * Create one pending delivery per active webhook subscribed to the event.
 *
 * The payload is built once, so every receiver and every later retry sees the
 * same event id and bytes.
 */
export async function enqueueWebhookEvent(input: {
  workspaceId: string;
  event: WebhookEvent;
  data: Record<string, unknown>;
}): Promise<number> {
  const subscribers = await db
    .select({ id: webhooks.id })
    .from(webhooks)
    .where(
      and(
        eq(webhooks.workspaceId, input.workspaceId),
        eq(webhooks.active, true),
        sql`${webhooks.events} @> ${JSON.stringify([input.event])}::jsonb`,
      ),
    );

  if (subscribers.length === 0) return 0;

  const now = new Date();
  const payload = {
    id: randomUUID(),
    type: input.event,
    created_at: now.toISOString(),
    workspace_id: input.workspaceId,
    data: input.data,
  };

  await db.insert(webhookDeliveries).values(
    subscribers.map((subscriber) => ({
      workspaceId: input.workspaceId,
      webhookId: subscriber.id,
      event: input.event,
      payload,
      status: "pending" as const,
      attempts: 0,
      nextAttemptAt: now,
      createdAt: now,
    })),
  );

  return subscribers.length;
}

/** Best-effort emit: a webhook problem must never fail the mutation. */
export async function emitWebhookEvent(input: {
  workspaceId: string;
  event: WebhookEvent;
  data: Record<string, unknown>;
}): Promise<void> {
  try {
    await enqueueWebhookEvent(input);
  } catch (error) {
    logEvent("warn", "webhook.enqueue_failed", {
      workspaceId: input.workspaceId,
      event: input.event,
      error: serializeError(error),
    });
  }
}

type ClaimedDelivery = {
  id: string;
  webhookId: string;
  event: string;
  payload: unknown;
  attempts: number;
  url: string;
  secret: string;
  previousSecret: string | null;
  previousSecretExpiresAt: Date | null;
  active: boolean;
};

async function claimDue(limit: number, now: Date): Promise<ClaimedDelivery[]> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: webhookDeliveries.id,
        webhookId: webhookDeliveries.webhookId,
        event: webhookDeliveries.event,
        payload: webhookDeliveries.payload,
        attempts: webhookDeliveries.attempts,
        url: webhooks.url,
        secret: webhooks.secret,
        previousSecret: webhooks.previousSecret,
        previousSecretExpiresAt: webhooks.previousSecretExpiresAt,
        active: webhooks.active,
      })
      .from(webhookDeliveries)
      .innerJoin(webhooks, eq(webhookDeliveries.webhookId, webhooks.id))
      .where(
        and(
          eq(webhookDeliveries.status, "pending"),
          lte(webhookDeliveries.nextAttemptAt, now),
        ),
      )
      .orderBy(asc(webhookDeliveries.nextAttemptAt), asc(webhookDeliveries.id))
      .limit(limit)
      .for("update", { skipLocked: true });

    if (rows.length === 0) return [];

    await tx
      .update(webhookDeliveries)
      .set({
        nextAttemptAt: new Date(now.getTime() + LEASE_MS),
        lastAttemptAt: now,
        attempts: sql`${webhookDeliveries.attempts} + 1`,
      })
      .where(
        inArray(
          webhookDeliveries.id,
          rows.map((row) => row.id),
        ),
      );

    return rows;
  });
}

async function finish(
  delivery: ClaimedDelivery,
  outcome: {
    ok: boolean;
    responseStatus: number | null;
    error: string | null;
    attempt: number;
    now: Date;
  },
): Promise<"succeeded" | "failed" | "retrying"> {
  if (outcome.ok) {
    await db
      .update(webhookDeliveries)
      .set({
        status: "succeeded",
        responseStatus: outcome.responseStatus,
        error: null,
        deliveredAt: outcome.now,
        nextAttemptAt: outcome.now,
      })
      .where(eq(webhookDeliveries.id, delivery.id));
    return "succeeded";
  }

  const exhausted = outcome.attempt >= WEBHOOK_MAX_ATTEMPTS;
  await db
    .update(webhookDeliveries)
    .set({
      status: exhausted ? "failed" : "pending",
      responseStatus: outcome.responseStatus,
      error: outcome.error?.slice(0, MAX_ERROR_LENGTH) ?? "Delivery failed.",
      nextAttemptAt: exhausted
        ? outcome.now
        : new Date(outcome.now.getTime() + nextAttemptDelayMs(outcome.attempt)),
    })
    .where(eq(webhookDeliveries.id, delivery.id));

  return exhausted ? "failed" : "retrying";
}

export async function deliverDueWebhooks(
  input: {
    limit?: number;
    now?: Date;
    allowPrivate?: boolean;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<{
  checkedAt: string;
  claimed: number;
  succeeded: number;
  failed: number;
  retrying: number;
  skipped: number;
}> {
  const now = input.now ?? new Date();
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const fetchImpl = input.fetchImpl ?? fetch;
  const claimed = await claimDue(limit, now);

  let succeeded = 0;
  let failed = 0;
  let retrying = 0;
  let skipped = 0;

  for (const delivery of claimed) {
    const attempt = delivery.attempts + 1;

    if (!delivery.active) {
      const result = await finish(delivery, {
        ok: false,
        responseStatus: null,
        error: "Webhook is disabled.",
        attempt: WEBHOOK_MAX_ATTEMPTS,
        now,
      });
      if (result === "failed") failed += 1;
      continue;
    }

    if (isSandboxMode()) {
      await db
        .update(webhookDeliveries)
        .set({
          status: "skipped",
          responseStatus: null,
          error: "Sandbox mode: webhook delivery suppressed.",
          deliveredAt: null,
          nextAttemptAt: now,
        })
        .where(eq(webhookDeliveries.id, delivery.id));
      skipped += 1;
      continue;
    }

    const target = validateWebhookUrl(delivery.url, {
      allowPrivate: input.allowPrivate,
    });
    if (!target.ok) {
      const result = await finish(delivery, {
        ok: false,
        responseStatus: null,
        error: target.reason,
        attempt: WEBHOOK_MAX_ATTEMPTS,
        now,
      });
      if (result === "failed") failed += 1;
      continue;
    }

    const body = JSON.stringify(delivery.payload);
    const timestamp = Math.floor(now.getTime() / 1000).toString();
    let responseStatus: number | null = null;
    let error: string | null = null;

    const headers: Record<string, string> = {
      "content-type": "application/json",
      "user-agent": "Herald-Webhooks/1",
      "x-herald-event": delivery.event,
      "x-herald-delivery": delivery.id,
      "x-herald-timestamp": timestamp,
      "x-herald-signature": signWebhookPayload(delivery.secret, timestamp, body),
    };
    if (
      delivery.previousSecret &&
      delivery.previousSecretExpiresAt &&
      delivery.previousSecretExpiresAt.getTime() > now.getTime()
    ) {
      headers["x-herald-signature-previous"] = signWebhookPayload(
        delivery.previousSecret,
        timestamp,
        body,
      );
    }
    // Correlate the receiver's log with the originating request. This header is
    // informational; the signature still covers the timestamp and raw body.
    const requestId = currentRequestId();
    if (requestId) headers["x-herald-request-id"] = requestId;

    try {
      const response = await withSpan(
        "webhook.delivery",
        { event: delivery.event },
        () =>
          fetchImpl(target.url, {
            method: "POST",
            redirect: "error",
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            headers,
            body,
          }),
      );
      responseStatus = response.status;
      if (!response.ok) error = `Receiver answered ${response.status}.`;
    } catch (fetchError) {
      error = fetchError instanceof Error ? fetchError.message : "Delivery failed.";
    }

    const result = await finish(delivery, {
      ok: responseStatus !== null && responseStatus >= 200 && responseStatus < 300,
      responseStatus,
      error,
      attempt,
      now,
    });
    if (result === "succeeded") succeeded += 1;
    else if (result === "failed") failed += 1;
    else retrying += 1;
  }

  if (claimed.length > 0) {
    logEvent("info", "webhook.delivery_run", {
      claimed: claimed.length,
      succeeded,
      failed,
      retrying,
      skipped,
    });
  }

  return {
    checkedAt: now.toISOString(),
    claimed: claimed.length,
    succeeded,
    failed,
    retrying,
    skipped,
  };
}

/** Put a finished or stuck delivery back at the front of the queue. */
export async function replayDelivery(input: {
  workspaceId: string;
  webhookId: string;
  deliveryId: string;
}): Promise<boolean> {
  const rows = await db
    .update(webhookDeliveries)
    .set({
      status: "pending",
      attempts: 0,
      responseStatus: null,
      error: null,
      deliveredAt: null,
      nextAttemptAt: new Date(),
    })
    .where(
      and(
        eq(webhookDeliveries.id, input.deliveryId),
        eq(webhookDeliveries.webhookId, input.webhookId),
        eq(webhookDeliveries.workspaceId, input.workspaceId),
      ),
    )
    .returning({ id: webhookDeliveries.id });
  return Boolean(rows[0]);
}

/** Bulk replay for the dead-letter view; only failed or skipped rows qualify. */
export async function replayDeliveries(input: {
  workspaceId: string;
  deliveryIds: string[];
  userId: string | null;
}): Promise<{ replayed: number }> {
  const ids = [...new Set(input.deliveryIds)].slice(0, 100);
  if (ids.length === 0) return { replayed: 0 };

  const rows = await db
    .update(webhookDeliveries)
    .set({
      status: "pending",
      attempts: 0,
      responseStatus: null,
      error: null,
      deliveredAt: null,
      nextAttemptAt: new Date(),
    })
    .where(
      and(
        eq(webhookDeliveries.workspaceId, input.workspaceId),
        inArray(webhookDeliveries.id, ids),
        inArray(webhookDeliveries.status, ["failed", "skipped"]),
      ),
    )
    .returning({ id: webhookDeliveries.id });

  if (rows.length > 0) {
    await recordWorkspaceAudit({
      workspaceId: input.workspaceId,
      actorUserId: input.userId,
      action: "webhook.deliveries_replayed",
      targetType: "webhook_delivery",
      targetId: null,
      metadata: { count: rows.length },
    });
  }

  return { replayed: rows.length };
}
