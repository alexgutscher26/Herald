import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/db";
import { mcpOauthClients } from "@/db/schema";
import {
  isAllowedRedirectUri,
  newOAuthClientId,
  normalizeClientName,
} from "@/features/mcp/oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "cache-control": "private, no-store" } as const;

const registrationSchema = z.object({
  client_name: z.string().max(120).optional(),
  redirect_uris: z.array(z.string().min(1).max(2048)).min(1).max(10),
  token_endpoint_auth_method: z.literal("none").optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
});

/**
 * Dynamic client registration (RFC 7591) for public MCP clients.
 *
 * No secret is issued. The redirect list is an exact-match allowlist used by
 * the authorization endpoint, so an attacker cannot register a client and then
 * redirect a code somewhere else.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body: unknown = await request.json().catch(() => null);
  const parsed = registrationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid_client_metadata",
        error_description: "Send 1–10 redirect_uris.",
      },
      { status: 400, headers: NO_STORE },
    );
  }

  if (
    parsed.data.grant_types &&
    parsed.data.grant_types.some((value) => value !== "authorization_code")
  ) {
    return NextResponse.json(
      {
        error: "invalid_client_metadata",
        error_description: "Only the authorization_code grant is supported.",
      },
      { status: 400, headers: NO_STORE },
    );
  }
  if (
    parsed.data.response_types &&
    parsed.data.response_types.some((value) => value !== "code")
  ) {
    return NextResponse.json(
      {
        error: "invalid_client_metadata",
        error_description: "Only the code response type is supported.",
      },
      { status: 400, headers: NO_STORE },
    );
  }
  if (!parsed.data.redirect_uris.every(isAllowedRedirectUri)) {
    return NextResponse.json(
      {
        error: "invalid_redirect_uri",
        error_description:
          "Redirect URIs must be HTTPS, or HTTP on localhost, with no fragment.",
      },
      { status: 400, headers: NO_STORE },
    );
  }

  const clientId = newOAuthClientId();
  const name = normalizeClientName(parsed.data.client_name);
  const redirectUris = [...new Set(parsed.data.redirect_uris)];

  await db.insert(mcpOauthClients).values({
    clientId,
    name,
    redirectUris,
  });

  return NextResponse.json(
    {
      client_id: clientId,
      client_name: name,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
      client_id_issued_at: Math.floor(Date.now() / 1000),
    },
    { status: 201, headers: NO_STORE },
  );
}

export function GET(): NextResponse {
  return NextResponse.json(
    { error: "invalid_request", error_description: "Use POST to register a client." },
    { status: 405, headers: { ...NO_STORE, allow: "POST" } },
  );
}
