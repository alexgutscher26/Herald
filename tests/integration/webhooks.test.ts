import { afterAll, beforeAll, describe, expect } from "bun:test";

import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

import { db } from "@/db";
import { apiTokens, webhookDeliveries } from "@/db/schema";
import { handleApiRequest } from "@/features/api-v1/router";
import { createApiTokenMaterial } from "@/features/api-v1/token";
import {
  createWebhook,
  deliverDueWebhooks,
  enqueueWebhookEvent,
  listWorkspaceDeliveries,
  replayDelivery,
  rotateWebhookSecret,
} from "@/features/webhooks/service";
import { verifyWebhookSignature } from "@/features/webhooks/sign";

import {
  createBoard,
  createMember,
  createProduct,
  createWorkspace,
  uniqueLabel,
} from "./factories";
import {
  SETUP_TIMEOUT_MS,
  isolatedTest,
  setupTestDatabase,
  teardownTestDatabase,
} from "./harness";

/**
 * Real outbound delivery against a local HTTP receiver.
 *
 * The receiver records the raw body and headers, so the test verifies the same
 * HMAC a customer would. Retry, exhaustion and replay are exercised through
 * the public service functions the cron route calls.
 */

const previousFlag = process.env.FLAG_API;

let server: ReturnType<typeof Bun.serve> | null = null;
let receiverStatus = 200;
const received: { body: string; headers: Headers }[] = [];

beforeAll(async () => {
  process.env.FLAG_API = "on";
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = await request.text();
      received.push({ body, headers: request.headers });
      return new Response(receiverStatus === 200 ? "ok" : "no", {
        status: receiverStatus,
      });
    },
  });
  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await teardownTestDatabase();
  server?.stop();
  if (previousFlag === undefined) delete process.env.FLAG_API;
  else process.env.FLAG_API = previousFlag;
}, SETUP_TIMEOUT_MS);

function receiverUrl(): string {
  if (!server) throw new Error("Receiver is not running.");
  return `http://127.0.0.1:${server.port}/hook`;
}

async function tokenFor(workspaceId: string, userId: string): Promise<string> {
  const material = createApiTokenMaterial();
  const rows = await db
    .insert(apiTokens)
    .values({
      workspaceId,
      name: "Webhook test token",
      tokenHash: material.tokenHash,
      prefix: material.prefix,
      scopes: ["read", "write"],
      createdBy: userId,
    })
    .returning({ id: apiTokens.id });
  if (!rows[0]) throw new Error("Token insert returned no row.");
  return material.token;
}

async function deliveryRows(workspaceId: string) {
  return db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.workspaceId, workspaceId));
}

describe("webhooks", () => {
  isolatedTest("delivers a signed event and records success", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const { user } = await createMember(workspace.id, { role: "owner" });
    const created = await createWebhook({
      workspaceId: workspace.id,
      userId: user.id,
      name: "Local receiver",
      url: receiverUrl(),
      events: ["request.created"],
      allowPrivate: true,
    });
    if (!created.ok) throw new Error(created.error);

    received.length = 0;
    receiverStatus = 200;

    await enqueueWebhookEvent({
      workspaceId: workspace.id,
      event: "request.created",
      data: { request_id: "5f0c8f9a-6a2e-4f0e-9d4a-1c2b3a4d5e6f" },
    });

    const summary = await deliverDueWebhooks({ allowPrivate: true });
    expect(summary).toMatchObject({ claimed: 1, succeeded: 1, failed: 0 });

    expect(received).toHaveLength(1);
    const delivered = received[0]!;
    const timestamp = delivered.headers.get("x-herald-timestamp");
    const signature = delivered.headers.get("x-herald-signature");
    expect(timestamp).toBeTruthy();
    expect(signature).toBeTruthy();
    expect(delivered.headers.get("x-herald-event")).toBe("request.created");

    expect(
      verifyWebhookSignature({
        secret: created.secret,
        timestamp: timestamp!,
        signature: signature!,
        body: delivered.body,
        now: Date.now(),
      }),
    ).toBe(true);

    const payload = JSON.parse(delivered.body) as {
      type: string;
      workspace_id: string;
      data: { request_id: string };
    };
    expect(payload.type).toBe("request.created");
    expect(payload.workspace_id).toBe(workspace.id);
    expect(payload.data.request_id).toBe(
      "5f0c8f9a-6a2e-4f0e-9d4a-1c2b3a4d5e6f",
    );

    const rows = await deliveryRows(workspace.id);
    expect(rows[0]).toMatchObject({ status: "succeeded", attempts: 1, responseStatus: 200 });
  });

  isolatedTest("retries a failed delivery with a growing delay", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const { user } = await createMember(workspace.id, { role: "owner" });
    const created = await createWebhook({
      workspaceId: workspace.id,
      userId: user.id,
      name: "Flaky receiver",
      url: receiverUrl(),
      events: ["comment.created"],
      allowPrivate: true,
    });
    if (!created.ok) throw new Error(created.error);

    await enqueueWebhookEvent({
      workspaceId: workspace.id,
      event: "comment.created",
      data: { comment_id: "5f0c8f9a-6a2e-4f0e-9d4a-1c2b3a4d5e6f" },
    });

    receiverStatus = 503;
    const first = await deliverDueWebhooks({ allowPrivate: true });
    expect(first).toMatchObject({ claimed: 1, retrying: 1 });

    const [afterFirst] = await deliveryRows(workspace.id);
    expect(afterFirst).toMatchObject({ status: "pending", attempts: 1, responseStatus: 503 });
    expect(afterFirst!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 20_000);

    await db
      .update(webhookDeliveries)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(webhookDeliveries.id, afterFirst!.id));

    receiverStatus = 200;
    const second = await deliverDueWebhooks({ allowPrivate: true });
    expect(second).toMatchObject({ claimed: 1, succeeded: 1 });

    const [afterSecond] = await deliveryRows(workspace.id);
    expect(afterSecond).toMatchObject({
      status: "succeeded",
      attempts: 2,
      responseStatus: 200,
    });
  });

  isolatedTest("sends the previous signature during the rotation overlap", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const { user } = await createMember(workspace.id, { role: "owner" });
    const created = await createWebhook({
      workspaceId: workspace.id,
      userId: user.id,
      name: "Rotating receiver",
      url: receiverUrl(),
      events: ["request.created"],
      allowPrivate: true,
    });
    if (!created.ok) throw new Error(created.error);

    const rotated = await rotateWebhookSecret({
      workspaceId: workspace.id,
      webhookId: created.id,
      userId: user.id,
    });
    expect(rotated?.secret).not.toBe(created.secret);

    received.length = 0;
    receiverStatus = 200;
    await enqueueWebhookEvent({
      workspaceId: workspace.id,
      event: "request.created",
      data: { request_id: "5f0c8f9a-6a2e-4f0e-9d4a-1c2b3a4d5e6f" },
    });
    await deliverDueWebhooks({ allowPrivate: true });

    const delivered = received[0]!;
    const timestamp = delivered.headers.get("x-herald-timestamp")!;
    expect(
      verifyWebhookSignature({
        secret: rotated!.secret,
        timestamp,
        signature: delivered.headers.get("x-herald-signature")!,
        body: delivered.body,
        now: Date.now(),
      }),
    ).toBe(true);
    expect(
      verifyWebhookSignature({
        secret: created.secret,
        timestamp,
        signature: delivered.headers.get("x-herald-signature-previous")!,
        body: delivered.body,
        now: Date.now(),
      }),
    ).toBe(true);
  });

  isolatedTest("marks a delivery failed after the attempt limit and can replay it", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const { user } = await createMember(workspace.id, { role: "owner" });
    const created = await createWebhook({
      workspaceId: workspace.id,
      userId: user.id,
      name: "Replay receiver",
      url: receiverUrl(),
      events: ["message.created"],
      allowPrivate: true,
    });
    if (!created.ok) throw new Error(created.error);

    await enqueueWebhookEvent({
      workspaceId: workspace.id,
      event: "message.created",
      data: { conversation_id: "5f0c8f9a-6a2e-4f0e-9d4a-1c2b3a4d5e6f" },
    });
    const [row] = await deliveryRows(workspace.id);

    await db
      .update(webhookDeliveries)
      .set({ attempts: 4, nextAttemptAt: new Date(0), status: "pending" })
      .where(eq(webhookDeliveries.id, row!.id));

    receiverStatus = 500;
    const exhausted = await deliverDueWebhooks({ allowPrivate: true });
    expect(exhausted).toMatchObject({ claimed: 1, failed: 1 });

    const [failed] = await deliveryRows(workspace.id);
    expect(failed).toMatchObject({ status: "failed", attempts: 5, responseStatus: 500 });

    const dead = await listWorkspaceDeliveries({
      workspaceId: workspace.id,
      status: "failed",
    });
    expect(dead).toHaveLength(1);
    expect(dead[0]?.webhook.name).toBe("Replay receiver");

    expect(
      await replayDelivery({
        workspaceId: workspace.id,
        webhookId: created.id,
        deliveryId: failed!.id,
      }),
    ).toBe(true);
    const [queued] = await deliveryRows(workspace.id);
    expect(queued).toMatchObject({ status: "pending", attempts: 0, responseStatus: null });
    expect(
      await listWorkspaceDeliveries({ workspaceId: workspace.id, status: "failed" }),
    ).toHaveLength(0);

    receiverStatus = 200;
    const replayed = await deliverDueWebhooks({ allowPrivate: true });
    expect(replayed).toMatchObject({ claimed: 1, succeeded: 1 });
    const [done] = await deliveryRows(workspace.id);
    expect(done).toMatchObject({ status: "succeeded", attempts: 1 });
  });

  isolatedTest("sandbox mode records a skipped delivery without calling the receiver", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const { user } = await createMember(workspace.id, { role: "owner" });
    const created = await createWebhook({
      workspaceId: workspace.id,
      userId: user.id,
      name: "Sandbox receiver",
      url: receiverUrl(),
      events: ["request.created"],
      allowPrivate: true,
    });
    if (!created.ok) throw new Error(created.error);

    const previousSandbox = process.env.SANDBOX_MODE;
    process.env.SANDBOX_MODE = "on";
    try {
      received.length = 0;
      await enqueueWebhookEvent({
        workspaceId: workspace.id,
        event: "request.created",
        data: { request_id: "5f0c8f9a-6a2e-4f0e-9d4a-1c2b3a4d5e6f" },
      });

      const summary = await deliverDueWebhooks({ allowPrivate: true });
      expect(summary).toMatchObject({ claimed: 1, skipped: 1, succeeded: 0, failed: 0 });
      expect(received).toHaveLength(0);

      const [row] = await deliveryRows(workspace.id);
      expect(row).toMatchObject({ status: "skipped", error: "Sandbox mode: webhook delivery suppressed." });
    } finally {
      if (previousSandbox === undefined) delete process.env.SANDBOX_MODE;
      else process.env.SANDBOX_MODE = previousSandbox;
    }
  });

  isolatedTest("the API emits request.created for subscribed webhooks", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const product = await createProduct(workspace.id);
    const board = await createBoard(product.id);
    const { user } = await createMember(workspace.id, { role: "owner" });
    const token = await tokenFor(workspace.id, user.id);

    const created = await createWebhook({
      workspaceId: workspace.id,
      userId: user.id,
      name: "API events",
      url: receiverUrl(),
      events: ["request.created"],
      allowPrivate: true,
    });
    if (!created.ok) throw new Error(created.error);

    const response = await handleApiRequest(
      new NextRequest("http://localhost/api/v1/requests", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "idempotency-key": uniqueLabel("webhook-request"),
        },
        body: JSON.stringify({
          board_id: board.id,
          title: "A request that triggers a webhook",
          body: "Emit one event.",
        }),
      }),
      { params: Promise.resolve({ segments: ["requests"] }) },
    );
    expect(response.status).toBe(201);

    const rows = await deliveryRows(workspace.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ event: "request.created", status: "pending" });
  });
});
