import { afterAll, beforeAll, describe, expect } from "bun:test";

import { eq } from "drizzle-orm";

import { POST as mcpPost } from "@/app/api/mcp/route";
import { db } from "@/db";
import { apiTokens, feedbackComments, type ApiScope } from "@/db/schema";
import { createApiTokenMaterial } from "@/features/api-v1/token";

import {
  createBoard,
  createFeedbackPost,
  createMember,
  createProduct,
  createWorkspace,
} from "./factories";
import {
  SETUP_TIMEOUT_MS,
  isolatedTest,
  setupTestDatabase,
  teardownTestDatabase,
} from "./harness";

/**
 * The MCP endpoint is exercised over its real JSON-RPC surface. Every tool call
 * goes through the v1 router, so these cases also prove the two surfaces cannot
 * drift on tenancy, scopes or idempotency.
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

type RpcResponse = {
  status: number;
  json: {
    jsonrpc?: string;
    id?: unknown;
    result?: Record<string, unknown>;
    error?: { code: number; message: string };
  } | null;
  headers: Headers;
};

async function mintToken(
  workspaceId: string,
  createdBy: string,
  scopes: ApiScope[] = ["read", "write"],
): Promise<string> {
  const material = createApiTokenMaterial();
  const rows = await db
    .insert(apiTokens)
    .values({
      workspaceId,
      name: "MCP token",
      tokenHash: material.tokenHash,
      prefix: material.prefix,
      scopes,
      createdBy,
    })
    .returning({ id: apiTokens.id });
  if (!rows[0]) throw new Error("Token insert returned no row.");
  return material.token;
}

async function rpc(
  token: string | null,
  method: string,
  params: Record<string, unknown> = {},
  options: {
    id?: number | null;
    version?: string | null;
    headers?: Record<string, string>;
  } = {},
): Promise<RpcResponse> {
  const headers = new Headers({
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  });
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (options.version !== null) {
    headers.set("mcp-protocol-version", options.version ?? "2025-06-18");
  }
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    headers.set(name, value);
  }

  const body = JSON.stringify({
    jsonrpc: "2.0",
    ...(options.id === null ? {} : { id: options.id ?? 1 }),
    method,
    params,
  });

  const response = await mcpPost(
    new Request("http://localhost/api/mcp", { method: "POST", headers, body }),
  );
  const text = await response.text();

  return {
    status: response.status,
    json: text ? (JSON.parse(text) as RpcResponse["json"]) : null,
    headers: response.headers,
  };
}

function toolText(result: Record<string, unknown>): string {
  const content = result.content as { type: string; text: string }[];
  if (!content?.[0]) throw new Error("Tool result has no content.");
  return content[0].text;
}

describe("MCP endpoint", () => {
  isolatedTest("initializes and lists the v1 tool catalog", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const { user } = await createMember(workspace.id, { role: "owner" });
    const token = await mintToken(workspace.id, user.id);

    const initialized = await rpc(token, "initialize", {
      protocolVersion: "2025-06-18",
      clientInfo: { name: "test", version: "1.0.0" },
      capabilities: {},
    });

    expect(initialized.status).toBe(200);
    expect(initialized.json?.result?.protocolVersion).toBe("2025-06-18");
    expect(initialized.json?.result?.serverInfo).toMatchObject({ name: "herald" });

    const list = await rpc(token, "tools/list");
    const tools = list.json?.result?.tools as { name: string; inputSchema: { type: string } }[];
    expect(tools.length).toBeGreaterThanOrEqual(20);
    expect(tools.every((tool) => tool.inputSchema.type === "object")).toBe(true);
    expect(tools.map((tool) => tool.name)).toContain("reply_to_conversation");
    expect(tools.map((tool) => tool.name)).toContain("create_changelog");

    const notification = await rpc(
      token,
      "notifications/initialized",
      {},
      { id: null },
    );
    expect(notification.status).toBe(202);
    expect(notification.json).toBeNull();
  });

  isolatedTest("creates a comment once and replays the same tool result", async () => {
    const workspace = await createWorkspace({ plan: "pro" });
    const product = await createProduct(workspace.id);
    const board = await createBoard(product.id);
    const { user } = await createMember(workspace.id, { role: "owner" });
    const token = await mintToken(workspace.id, user.id);
    const request = await createFeedbackPost({ productId: product.id, boardId: board.id });

    const args = {
      request_id: request.id,
      body: "Reply from an agent.",
      idempotency_key: "mcp-comment-key-1",
    };

    const first = await rpc(token, "tools/call", {
      name: "create_comment",
      arguments: args,
    });
    expect(first.status).toBe(200);
    const firstResult = first.json?.result as Record<string, unknown>;
    expect(firstResult.isError).toBeUndefined();
    const firstPayload = JSON.parse(toolText(firstResult)) as {
      data: { id: string };
    };

    const replay = await rpc(token, "tools/call", {
      name: "create_comment",
      arguments: args,
    });
    const replayPayload = JSON.parse(
      toolText(replay.json?.result as Record<string, unknown>),
    ) as { data: { id: string } };

    expect(replayPayload.data.id).toBe(firstPayload.data.id);

    const stored = await db
      .select({ id: feedbackComments.id })
      .from(feedbackComments)
      .where(eq(feedbackComments.feedbackPostId, request.id));
    expect(stored).toHaveLength(1);
  });

  isolatedTest("scopes reads to the token and enforces write scope", async () => {
    const workspaceA = await createWorkspace({ plan: "pro" });
    const productA = await createProduct(workspaceA.id);
    const boardA = await createBoard(productA.id);
    const { user: userA } = await createMember(workspaceA.id, { role: "owner" });
    const tokenA = await mintToken(workspaceA.id, userA.id);

    const workspaceB = await createWorkspace({ plan: "pro" });
    const productB = await createProduct(workspaceB.id);
    const boardB = await createBoard(productB.id);
    const foreignRequest = await createFeedbackPost({
      productId: productB.id,
      boardId: boardB.id,
    });

    const foreign = await rpc(tokenA, "tools/call", {
      name: "get_request",
      arguments: { request_id: foreignRequest.id },
    });
    const foreignResult = foreign.json?.result as Record<string, unknown>;
    expect(foreignResult.isError).toBe(true);
    expect(toolText(foreignResult)).toContain("not_found");

    const readOnly = await mintToken(workspaceA.id, userA.id, ["read"]);
    const denied = await rpc(readOnly, "tools/call", {
      name: "create_request",
      arguments: { board_id: boardA.id, title: "Denied", body: "No write scope." },
    });
    const deniedResult = denied.json?.result as Record<string, unknown>;
    expect(deniedResult.isError).toBe(true);
    expect(toolText(deniedResult)).toContain("forbidden");
  });

  isolatedTest("rejects missing tokens and unsupported protocol versions", async () => {
    const anonymous = await rpc(null, "tools/list");
    expect(anonymous.status).toBe(401);
    expect(anonymous.json?.error?.code).toBe(-32001);

    const workspace = await createWorkspace({ plan: "pro" });
    const { user } = await createMember(workspace.id, { role: "owner" });
    const token = await mintToken(workspace.id, user.id);

    const unsupported = await rpc(token, "tools/list", {}, { version: "1999-01-01" });
    expect(unsupported.status).toBe(400);
    expect(unsupported.json?.error?.code).toBe(-32600);

    const missingTool = await rpc(token, "tools/call", {
      name: "publish_changelog",
      arguments: {},
    });
    const result = missingTool.json?.result as Record<string, unknown>;
    expect(result.isError).toBe(true);
  });
});
