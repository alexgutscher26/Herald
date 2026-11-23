import { NextResponse } from "next/server";

import { authorizationServerMetadata, mcpOAuthOrigin } from "@/features/mcp/oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** RFC 8414 authorization-server metadata for the MCP OAuth flow. */
export function GET(): NextResponse {
  return NextResponse.json(authorizationServerMetadata(mcpOAuthOrigin()), {
    headers: {
      "cache-control": "public, max-age=300",
      "content-type": "application/json; charset=utf-8",
    },
  });
}
