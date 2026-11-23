import { and, eq, gt, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { apiTokens, mcpOauthClients, mcpOauthCodes } from "@/db/schema";
import { createApiTokenMaterial } from "@/features/api-v1/token";
import { recordWorkspaceAudit } from "@/features/data-controls/service";
import {
  MCP_OAUTH_ACCESS_TTL_SECONDS,
  hashOAuthValue,
  verifyPkce,
} from "@/features/mcp/oauth";
import { logEvent, serializeError } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = {
  "cache-control": "no-store",
  pragma: "no-cache",
} as const;

type TokenRequest = {
  grantType: string;
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
};

async function readTokenRequest(request: Request): Promise<TokenRequest | null> {
  const contentType = request.headers.get("content-type") ?? "";
  let values: Record<string, unknown> = {};

  try {
    if (contentType.includes("application/json")) {
      const body: unknown = await request.json();
      if (body && typeof body === "object") values = body as Record<string, unknown>;
    } else {
      const form = await request.formData();
      values = Object.fromEntries(form.entries());
    }
  } catch {
    return null;
  }

  const string = (key: string) => (typeof values[key] === "string" ? values[key] : "");
  return {
    grantType: string("grant_type"),
    code: string("code"),
    clientId: string("client_id"),
    redirectUri: string("redirect_uri"),
    codeVerifier: string("code_verifier"),
  };
}

function failure(error: string, description: string): NextResponse {
  return NextResponse.json(
    { error, error_description: description },
    { status: 400, headers: NO_STORE },
  );
}

/**
 * Exchange an authorization code for a workspace API token.
 *
 * The code is consumed in the same transaction that creates the token, so a
 * replay race cannot mint two credentials. No refresh token is issued:
 * ChatGPT-style connectors re-run authorization when the 30-day access token
 * expires, and the issued token is visible and revocable under Settings.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const input = await readTokenRequest(request);
  if (!input) return failure("invalid_request", "Send form-encoded or JSON fields.");
  if (input.grantType !== "authorization_code") {
    return failure("unsupported_grant_type", "Only authorization_code is supported.");
  }
  if (!input.code || !input.clientId || !input.codeVerifier) {
    return failure("invalid_request", "code, client_id and code_verifier are required.");
  }

  const rows = await db
    .select({
      id: mcpOauthCodes.id,
      clientId: mcpOauthCodes.clientId,
      clientName: mcpOauthClients.name,
      userId: mcpOauthCodes.userId,
      workspaceId: mcpOauthCodes.workspaceId,
      redirectUri: mcpOauthCodes.redirectUri,
      codeChallenge: mcpOauthCodes.codeChallenge,
      scopes: mcpOauthCodes.scopes,
      expiresAt: mcpOauthCodes.expiresAt,
      usedAt: mcpOauthCodes.usedAt,
    })
    .from(mcpOauthCodes)
    .innerJoin(mcpOauthClients, eq(mcpOauthCodes.clientId, mcpOauthClients.clientId))
    .where(eq(mcpOauthCodes.codeHash, hashOAuthValue(input.code)))
    .limit(1);

  const code = rows[0];
  if (
    !code ||
    code.usedAt !== null ||
    code.expiresAt.getTime() <= Date.now() ||
    code.clientId !== input.clientId ||
    // OAuth requires redirect_uri here when it was sent to authorize. Some
    // clients omit it; the code is already bound to the registered URI, so an
    // absent value is safe while a mismatched one is rejected.
    (input.redirectUri !== "" && code.redirectUri !== input.redirectUri)
  ) {
    return failure("invalid_grant", "The authorization code is invalid or expired.");
  }

  if (!verifyPkce({ verifier: input.codeVerifier, challenge: code.codeChallenge })) {
    return failure("invalid_grant", "The PKCE verifier does not match.");
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + MCP_OAUTH_ACCESS_TTL_SECONDS * 1000);
  const material = createApiTokenMaterial();

  const created = await db.transaction(async (tx) => {
    const consumed = await tx
      .update(mcpOauthCodes)
      .set({ usedAt: now })
      .where(
        and(
          eq(mcpOauthCodes.id, code.id),
          isNull(mcpOauthCodes.usedAt),
          gt(mcpOauthCodes.expiresAt, now),
        ),
      )
      .returning({ id: mcpOauthCodes.id });
    if (!consumed[0]) return null;

    const inserted = await tx
      .insert(apiTokens)
      .values({
        workspaceId: code.workspaceId,
        name: `MCP · ${code.clientName}`.slice(0, 120),
        tokenHash: material.tokenHash,
        prefix: material.prefix,
        scopes: code.scopes,
        createdBy: code.userId,
        expiresAt,
      })
      .returning({ id: apiTokens.id });
    return inserted[0] ?? null;
  });

  if (!created) {
    return failure("invalid_grant", "The authorization code was already used.");
  }

  try {
    await recordWorkspaceAudit({
      workspaceId: code.workspaceId,
      actorUserId: code.userId,
      action: "api_token.created",
      targetType: "api_token",
      targetId: created.id,
      metadata: {
        scopes: code.scopes.join(","),
        oauthClient: code.clientName,
        expiresAt: expiresAt.toISOString(),
      },
    });
  } catch (error) {
    // The credential is already issued; a failed audit write must not turn a
    // successful exchange into a 500 that the client will retry with a spent code.
    logEvent("error", "api.oauth_audit_failed", {
      tokenId: created.id,
      workspaceId: code.workspaceId,
      error: serializeError(error),
    });
  }

  await db
    .update(mcpOauthClients)
    .set({ lastUsedAt: now })
    .where(eq(mcpOauthClients.clientId, code.clientId))
    .catch(() => {});

  return NextResponse.json(
    {
      access_token: material.token,
      token_type: "Bearer",
      expires_in: MCP_OAUTH_ACCESS_TTL_SECONDS,
      scope: code.scopes.join(" "),
    },
    { headers: NO_STORE },
  );
}

export function GET(): NextResponse {
  return NextResponse.json(
    { error: "invalid_request", error_description: "Use POST to exchange a code." },
    { status: 405, headers: { ...NO_STORE, allow: "POST" } },
  );
}
