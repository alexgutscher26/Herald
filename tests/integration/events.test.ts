import { afterAll, beforeAll, describe, expect } from "bun:test";

import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

import { db } from "@/db";
import {
  apiTokens,
  customerEvents,
  customers,
  webhookDeliveries,
  type ApiScope,
} from "@/db/schema";
import { handleApiRequest } from "@/features/api-v1/router";
import { createApiTokenMaterial } from "@/features/api-v1/token";
import { createWebhook } from "@/features/webhooks/service";

import { createProduct, createWorkspace } from "./factories";
import {
  SETUP_TIMEOUT_MS,
  isolatedTest,
  setupTestDatabase,
  teardownTestDatabase,
} from "./harness";

/**
 * `POST /api/v1/events` against real Postgres, through the router so bearer
 * auth, scopes, idempotency and validation are exercised end to end.
 */

const previousFlag = process.env.FLAG_API;

beforeAll(async () => {
  process.env.FLAG_API = "on";
  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await teardownTestDatabase();
  if (previousFlag === undefined) delete process.env.FLAG_API;
  else process.env.FLAG_API = previousFlag;
}, SETUP_TIMEOUT_MS);

type ApiResponse = { status: number; body: Record<string, unknown>; headers: Headers };

function segmentsFor(path: string): string[] {
  const url = new URL(`http://localhost/api/v1${path}`);
  return url.pathname.replace(/^\/api\/v1\/?/, "").split("/").filter(Boolean);
}

async function call(
  token: string,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<ApiResponse> {
  const url = new URL(`http://localhost/api/v1${path}`);
  const headers = new Headers({ authorization: `Bearer ${token}` });
  for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value);
  if (body !== undefined) headers.set("content-type", "application/json");

  const request = new NextRequest(url, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const response = await handleApiRequest(request, {
    params: Promise.resolve({ segments: segmentsFor(path) }),
  });
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
    headers: response.headers,
  };
}

async function mintToken(workspaceId: string, scopes: ApiScope[] = ["read", "write"]) {
  const material = createApiTokenMaterial();
  await db.insert(apiTokens).values({
    workspaceId,
    name: "Events test token",
    tokenHash: material.tokenHash,
    prefix: material.prefix,
    scopes,
    createdBy: null,
  });
  return material.token;
}

describe("POST /api/v1/events", () => {
  isolatedTest("records an event, resolves the customer and queues customer.event", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const product = await createProduct(workspace.id);
    const token = await mintToken(workspace.id);
    const webhook = await createWebhook({
      workspaceId: workspace.id,
      userId: null,
      name: "CRM",
      url: "https://example.com/herald",
      events: ["customer.event"],
      allowPrivate: true,
    });
    expect(webhook.ok).toBe(true);

    const response = await call(token, "POST", "/events", {
      product_id: product.id,
      name: "report.exported",
      customer: { external_id: "user_123", email: "ada@example.com", name: "Ada" },
      event_id: "evt_01HZX5R8K4",
      properties: { format: "csv", rows: 1200 },
    });

    expect(response.status).toBe(201);
    const data = response.body.data as Record<string, unknown>;
    expect(data).toMatchObject({
      name: "report.exported",
      external_id: "user_123",
      duplicate: false,
    });

    const eventRows = await db
      .select()
      .from(customerEvents)
      .where(eq(customerEvents.id, String(data.id)));
    expect(eventRows[0]).toMatchObject({
      productId: product.id,
      workspaceId: workspace.id,
      name: "report.exported",
      eventId: "evt_01HZX5R8K4",
      properties: { format: "csv", rows: 1200 },
    });

    const customerRows = await db
      .select()
      .from(customers)
      .where(eq(customers.id, eventRows[0]!.customerId));
    expect(customerRows[0]).toMatchObject({
      workspaceId: workspace.id,
      externalId: "user_123",
      email: "ada@example.com",
    });

    const deliveries = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.event, "customer.event"));
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.status).toBe("pending");
    expect(deliveries[0]?.payload).toMatchObject({
      type: "customer.event",
      data: {
        name: "report.exported",
        customer_id: eventRows[0]!.customerId,
        external_id: "user_123",
        properties: { format: "csv", rows: 1200 },
      },
    });
  });

  isolatedTest("replays an idempotency key and dedupes an event id", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const product = await createProduct(workspace.id);
    const token = await mintToken(workspace.id);
    const body = {
      product_id: product.id,
      name: "trial.started",
      customer: { external_id: "user_replay" },
      event_id: "evt_replay_1",
    };

    const first = await call(token, "POST", "/events", body, {
      "idempotency-key": "events-replay-0001",
    });
    expect(first.status).toBe(201);
    const firstId = (first.body.data as { id: string }).id;

    const replay = await call(token, "POST", "/events", body, {
      "idempotency-key": "events-replay-0001",
    });
    expect(replay.status).toBe(201);
    expect((replay.body.data as { id: string }).id).toBe(firstId);
    expect(replay.headers.get("idempotency-replayed")).toBe("true");

    const dedupe = await call(token, "POST", "/events", body, {
      "idempotency-key": "events-replay-0002",
    });
    expect(dedupe.status).toBe(200);
    expect((dedupe.body.data as { duplicate: boolean }).duplicate).toBe(true);

    const rows = await db
      .select()
      .from(customerEvents)
      .where(eq(customerEvents.productId, product.id));
    expect(rows).toHaveLength(1);
  });

  isolatedTest("requires write scope and a product in the token's workspace", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const product = await createProduct(workspace.id);
    const readToken = await mintToken(workspace.id, ["read"]);

    const forbidden = await call(readToken, "POST", "/events", {
      product_id: product.id,
      name: "page.viewed",
      customer: { external_id: "user_read" },
    });
    expect(forbidden.status).toBe(403);

    const otherWorkspace = await createWorkspace({ plan: "pro" });
    const otherProduct = await createProduct(otherWorkspace.id);
    const token = await mintToken(workspace.id);

    const missing = await call(token, "POST", "/events", {
      product_id: otherProduct.id,
      name: "page.viewed",
      customer: { external_id: "user_other" },
    });
    expect(missing.status).toBe(404);

    const rows = await db
      .select()
      .from(customerEvents)
      .where(eq(customerEvents.productId, otherProduct.id));
    expect(rows).toHaveLength(0);
  });

  isolatedTest("keeps identical external ids separate per workspace", async () => {
    const firstWorkspace = await createWorkspace({ plan: "pro" });
    const firstProduct = await createProduct(firstWorkspace.id);
    const firstToken = await mintToken(firstWorkspace.id);

    const secondWorkspace = await createWorkspace({ plan: "pro" });
    const secondProduct = await createProduct(secondWorkspace.id);
    const secondToken = await mintToken(secondWorkspace.id);

    const first = await call(firstToken, "POST", "/events", {
      product_id: firstProduct.id,
      name: "login",
      customer: { external_id: "shared_external_id" },
    });
    const second = await call(secondToken, "POST", "/events", {
      product_id: secondProduct.id,
      name: "login",
      customer: { external_id: "shared_external_id" },
    });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect((first.body.data as { customer_id: string }).customer_id).not.toBe(
      (second.body.data as { customer_id: string }).customer_id,
    );

    const firstCustomers = await db
      .select()
      .from(customers)
      .where(eq(customers.workspaceId, firstWorkspace.id));
    expect(firstCustomers).toHaveLength(1);
    expect(firstCustomers[0]?.externalId).toBe("shared_external_id");
  });

  isolatedTest("rejects future timestamps and oversized properties", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const product = await createProduct(workspace.id);
    const token = await mintToken(workspace.id);

    const future = await call(token, "POST", "/events", {
      product_id: product.id,
      name: "login",
      customer: { external_id: "user_future" },
      occurred_at: new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString(),
    });
    expect(future.status).toBe(400);

    const oversized = await call(token, "POST", "/events", {
      product_id: product.id,
      name: "login",
      customer: { external_id: "user_large" },
      properties: { blob: "x".repeat(5_000) },
    });
    expect(oversized.status).toBe(400);
  });
});
