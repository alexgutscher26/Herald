import { NextResponse } from "next/server";

import { mcpOAuthOrigin, protectedResourceMetadata } from "@/features/mcp/oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** RFC 9728 protected-resource metadata for `/api/mcp`. */
export function GET(): NextResponse {
  return NextResponse.json(protectedResourceMetadata(mcpOAuthOrigin()), {
    headers: {
      "cache-control": "public, max-age=300",
      "content-type": "application/json; charset=utf-8",
    },
  });
}
