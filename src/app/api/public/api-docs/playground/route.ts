import { NextResponse } from "next/server";

import { authenticateApiRequest, requireScope } from "@/features/api-v1/auth";
import { ApiFailure } from "@/features/api-v1/http";
import {
  isPlaygroundMethod,
  playgroundNeedsWriteScope,
} from "@/features/api-docs/playground-policy";

export const dynamic = "force-dynamic";

/**
 * Server proxy for the public API playground.
 *
 * A token is authenticated here and its scope checked before a write is
 * forwarded. The target is restricted to this deployment's `/api/v1` tree, so
 * the proxy cannot be turned into an SSRF gadget.
 */
export async function POST(request: Request) {
  let body: {
    token?: unknown;
    method?: unknown;
    path?: unknown;
    body?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON." } }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token : "";
  const method = typeof body.method === "string" ? body.method.toUpperCase() : "";
  const path = typeof body.path === "string" ? body.path.trim() : "";
  const payload = typeof body.body === "string" ? body.body.slice(0, 100_000) : "";

  if (!token || !isPlaygroundMethod(method) || !path) {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "token, method and path are required." } },
      { status: 400 },
    );
  }

  try {
    const authRequest = new Request(request.url, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    });
    const auth = await authenticateApiRequest(authRequest);
    if (playgroundNeedsWriteScope(method)) {
      requireScope(auth, "write");
    }

    let target: URL;
    try {
      target = new URL(path, request.url);
    } catch {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "Invalid path." } },
        { status: 400 },
      );
    }
    if (
      target.origin !== new URL(request.url).origin ||
      !target.pathname.startsWith("/api/v1/")
    ) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "Only /api/v1 paths are allowed." } },
        { status: 400 },
      );
    }

    const headers = new Headers({ authorization: `Bearer ${token}` });
    if (payload) headers.set("content-type", "application/json");
    const response = await fetch(target, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? null : payload || null,
      redirect: "manual",
      cache: "no-store",
    });
    const text = await response.text();
    return NextResponse.json(
      {
        status: response.status,
        contentType: response.headers.get("content-type"),
        body: text.slice(0, 100_000),
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof ApiFailure) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }
    console.error("[api-docs] playground failed", error);
    return NextResponse.json(
      { error: { code: "internal_error", message: "The playground request failed." } },
      { status: 500 },
    );
  }
}
