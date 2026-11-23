import { NextResponse } from "next/server";

import { authenticateApiRequest, type ApiAuth } from "@/features/api-v1/auth";
import { ApiFailure, apiRequestId } from "@/features/api-v1/http";
import { runApiRequest } from "@/features/api-v1/router";
import { mcpOAuthOrigin } from "@/features/mcp/oauth";
import { withRouteInstrumentation } from "@/lib/observability/route";
import {
  MCP_DEFAULT_PROTOCOL_VERSION,
  MCP_PROTOCOL_VERSIONS,
  MCP_SERVER_NAME,
  MCP_SERVER_TITLE,
  MCP_SERVER_VERSION,
  McpToolArgumentError,
  findMcpTool,
  mcpToolList,
} from "@/features/mcp/catalog";

/**
 * Remote MCP endpoint (Streamable HTTP, JSON responses).
 *
 * One bearer token authenticates the MCP request; every tool call then runs
 * through the v1 router with that same token, so scopes, tenant isolation,
 * idempotency, moderation and error codes are identical to the REST API.
 * A tool call consumes one rate-limit unit, not two, because authentication
 * happens once per MCP request.
 *
 * No session id is issued: the server is stateless and any client that keeps
 * its `initialize` result works. Both the session-era revisions and the newer
 * stateless revision are accepted, and the negotiated version is echoed.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RpcId = string | number | null;

type RpcCall = {
  id: RpcId | undefined;
  method: string;
  params: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRpc(body: unknown): RpcCall | null {
  if (!isRecord(body)) return null;
  if (body.jsonrpc !== "2.0") return null;
  if (typeof body.method !== "string" || body.method.length === 0) return null;

  const id = body.id;
  if (id !== undefined && id !== null && typeof id !== "string" && typeof id !== "number") {
    return null;
  }
  if (typeof id === "string" && id.length > 200) return null;

  return {
    id: id as RpcId | undefined,
    method: body.method,
    params: isRecord(body.params) ? body.params : {},
  };
}

function rpcResult(id: RpcId | undefined, result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function rpcError(id: RpcId | undefined, code: number, message: string, data?: unknown) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}

function responseHeaders(auth: ApiAuth | null): Headers {
  const headers = new Headers({
    "cache-control": "private, no-store",
    "x-api-version": "1",
  });
  if (auth) {
    headers.set("x-request-id", auth.requestId);
    headers.set("x-ratelimit-limit", String(auth.rateLimit.limit));
    headers.set("x-ratelimit-remaining", String(auth.rateLimit.remaining));
  }
  return headers;
}

function rpcResponse(
  payload: unknown,
  status: number,
  auth: ApiAuth | null,
  extraHeaders: Record<string, string> = {},
): NextResponse {
  const headers = responseHeaders(auth);
  for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value);
  headers.set("content-type", "application/json; charset=utf-8");
  return new NextResponse(JSON.stringify(payload), { status, headers });
}

function ensureRequired(
  tool: { inputSchema: Record<string, unknown> },
  args: Record<string, unknown>,
): string | null {
  const required = tool.inputSchema.required;
  if (!Array.isArray(required)) return null;
  for (const key of required) {
    if (typeof key === "string" && args[key] === undefined) {
      return `\`${key}\` is required.`;
    }
  }
  return null;
}

function segmentsFor(path: string): string[] {
  return path
    .split("?")[0]!
    .split("/")
    .filter((segment) => segment.length > 0);
}

function initializedResult(negotiated: string) {
  return {
    protocolVersion: negotiated,
    capabilities: { tools: { listChanged: false } },
    serverInfo: {
      name: MCP_SERVER_NAME,
      title: MCP_SERVER_TITLE,
      version: MCP_SERVER_VERSION,
    },
    instructions:
      "Herald is a customer-feedback workspace. Read before writing, prefer internal notes over customer replies, and create changelog entries only as drafts. Pass idempotency_key on write tools so retries cannot duplicate content. Scope and tenant rules match the REST API.",
  };
}

async function callTool(
  request: Request,
  auth: ApiAuth,
  params: Record<string, unknown>,
): Promise<unknown> {
  const name = typeof params.name === "string" ? params.name : "";
  const tool = findMcpTool(name);
  if (!tool) {
    return {
      isError: true,
      content: [{ type: "text", text: `Unknown tool: ${name || "(missing name)"}` }],
    };
  }

  const args = isRecord(params.arguments) ? params.arguments : {};
  const missing = ensureRequired(tool, args);
  if (missing) {
    return { isError: true, content: [{ type: "text", text: missing }] };
  }

  let call;
  try {
    call = tool.build(args);
  } catch (error) {
    if (error instanceof McpToolArgumentError) {
      return { isError: true, content: [{ type: "text", text: error.message }] };
    }
    throw error;
  }

  const url = new URL(`/api/v1${call.path}`, request.url);
  const headers = new Headers();
  const authorization = request.headers.get("authorization");
  if (authorization) headers.set("authorization", authorization);
  headers.set("content-type", "application/json");
  for (const [header, value] of Object.entries(call.headers ?? {})) {
    headers.set(header, value);
  }

  const apiRequest = new Request(url, {
    method: call.method,
    headers,
    ...(call.body === undefined ? {} : { body: JSON.stringify(call.body) }),
  });

  const response = await runApiRequest(apiRequest, segmentsFor(call.path), auth);
  const body: unknown = await response.json().catch(() => null);
  const requestId = response.headers.get("x-request-id") ?? auth.requestId;
  const text = JSON.stringify(body);

  if (response.status >= 400) {
    return {
      isError: true,
      content: [{ type: "text", text }],
      _meta: { "herald/request-id": requestId, "herald/status": response.status },
    };
  }

  return {
    content: [{ type: "text", text }],
    ...(isRecord(body) ? { structuredContent: body } : {}),
    _meta: { "herald/request-id": requestId, "herald/status": response.status },
  };
}

async function handlePost(request: Request): Promise<NextResponse> {
  const requestId = apiRequestId(request);

  let auth: ApiAuth;
  try {
    auth = await authenticateApiRequest(request);
    auth.requestId = requestId;
  } catch (error) {
    if (error instanceof ApiFailure) {
      const headers = { ...(error.headers ?? {}) };
      if (error.status === 401) {
        // Point OAuth-capable clients at discovery instead of asking a person
        // to paste a bearer token. The URL is same-origin and public.
        headers["www-authenticate"] =
          `Bearer resource_metadata="${mcpOAuthOrigin()}/.well-known/oauth-protected-resource"`;
      }
      return rpcResponse(rpcError(null, -32001, error.message), error.status, null, headers);
    }
    return rpcResponse(rpcError(null, -32603, "Internal error."), 500, null);
  }

  const headerVersion = request.headers.get("mcp-protocol-version");
  if (
    headerVersion !== null &&
    !(MCP_PROTOCOL_VERSIONS as readonly string[]).includes(headerVersion)
  ) {
    return rpcResponse(
      rpcError(null, -32600, `Unsupported MCP protocol version: ${headerVersion}`),
      400,
      auth,
    );
  }

  const body: unknown = await request.json().catch(() => null);
  const rpc = parseRpc(body);
  if (!rpc) {
    return rpcResponse(rpcError(null, -32600, "Invalid JSON-RPC request."), 400, auth);
  }

  // Notifications have no id and never receive a JSON-RPC response.
  if (rpc.id === undefined) {
    const headers = responseHeaders(auth);
    return new NextResponse(null, { status: 202, headers });
  }

  switch (rpc.method) {
    case "initialize": {
      const requested = rpc.params.protocolVersion;
      const negotiated =
        typeof requested === "string" &&
        (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
          ? requested
          : MCP_DEFAULT_PROTOCOL_VERSION;
      return rpcResponse(rpcResult(rpc.id, initializedResult(negotiated)), 200, auth);
    }

    case "ping":
      return rpcResponse(rpcResult(rpc.id, {}), 200, auth);

    case "tools/list":
      return rpcResponse(
        rpcResult(rpc.id, { tools: mcpToolList() }),
        200,
        auth,
      );

    case "tools/call":
      return rpcResponse(
        rpcResult(rpc.id, await callTool(request, auth, rpc.params)),
        200,
        auth,
      );

    default:
      return rpcResponse(
        rpcError(rpc.id, -32601, `Method not found: ${rpc.method}`),
        200,
        auth,
      );
  }
}

export const POST = withRouteInstrumentation("POST /api/mcp", handlePost);

export const GET = withRouteInstrumentation("GET /api/mcp", () =>
  new NextResponse(JSON.stringify(rpcError(null, -32600, "Use POST.")), {
    status: 405,
    headers: {
      allow: "POST",
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
    },
  }),
);
