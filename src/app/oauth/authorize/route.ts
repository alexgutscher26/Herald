import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { mcpOauthClients, mcpOauthCodes } from "@/db/schema";
import { listWorkspacesForUser } from "@/db/queries/workspaces";
import { isEnterpriseSsoRequired } from "@/db/queries/enterprise";
import { isSameOriginRequest } from "@/features/customer-session/origin";
import {
  MCP_OAUTH_CODE_TTL_MS,
  MCP_OAUTH_SCOPES,
  escapeHtml,
  hashOAuthValue,
  newOAuthCode,
} from "@/features/mcp/oauth";
import { getSessionUser } from "@/lib/authz";
import { hasPermission } from "@/lib/permissions";
import { withRedirectParam } from "@/lib/redirect";
import type { ApiScope } from "@/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AuthRequest = {
  clientId: string;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  scopes: ApiScope[];
};

type ParsedAuth =
  | { ok: true; value: AuthRequest }
  | { ok: false; error: string };

const NO_STORE = { "cache-control": "private, no-store" } as const;
const PAGE_HEADERS = {
  ...NO_STORE,
  "content-type": "text/html; charset=utf-8",
  "referrer-policy": "no-referrer",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
} as const;

function parseAuthRequest(params: URLSearchParams): ParsedAuth {
  const clientId = params.get("client_id") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  const responseType = params.get("response_type") ?? "";
  const method = params.get("code_challenge_method") ?? "";
  const challenge = params.get("code_challenge") ?? "";
  const state = params.get("state");
  const scope = params.get("scope") ?? "";

  if (!clientId || !redirectUri) return { ok: false, error: "Missing client_id or redirect_uri." };
  if (responseType !== "code") return { ok: false, error: "Only response_type=code is supported." };
  if (method !== "S256") return { ok: false, error: "PKCE with code_challenge_method=S256 is required." };
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(challenge)) {
    return { ok: false, error: "code_challenge must be a base64url-encoded SHA-256 digest." };
  }
  if (state !== null && state.length > 500) return { ok: false, error: "state is too long." };

  const requested = scope
    .split(" ")
    .filter((value): value is ApiScope =>
      (MCP_OAUTH_SCOPES as readonly string[]).includes(value),
    );

  return {
    ok: true,
    value: {
      clientId,
      redirectUri,
      state,
      codeChallenge: challenge,
      scopes: requested.length > 0 ? [...new Set(requested)] : ["read", "write"],
    },
  };
}

function errorPage(message: string, status = 400): NextResponse {
  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Herald MCP authorization</title><style>
      :root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f172a;color:#e2e8f0;font:15px/1.5 system-ui,sans-serif}
      main{width:min(520px,calc(100% - 32px));background:#111c33;border:1px solid #26344f;border-radius:14px;padding:28px}
      h1{font-size:20px;margin:0 0 10px}p{color:#a9b6cc;margin:0}
    </style></head><body><main><h1>Authorization failed</h1><p>${escapeHtml(message)}</p></main></body></html>`,
    { status, headers: PAGE_HEADERS },
  );
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const parsed = parseAuthRequest(url.searchParams);
  if (!parsed.ok) return errorPage(parsed.error);

  const clientRows = await db
    .select()
    .from(mcpOauthClients)
    .where(eq(mcpOauthClients.clientId, parsed.value.clientId))
    .limit(1);
  const client = clientRows[0];
  if (!client) return errorPage("Unknown client_id. Register the client again.");
  if (!client.redirectUris.includes(parsed.value.redirectUri)) {
    return errorPage("redirect_uri does not match the registered client.");
  }

  const user = await getSessionUser();
  if (!user) {
    return NextResponse.redirect(
      new URL(withRedirectParam("/sign-in", `${url.pathname}${url.search}`), url.origin),
    );
  }

  const memberships = (await listWorkspacesForUser(user.id)).filter((membership) =>
    hasPermission(membership.role, "settings:manage"),
  );
  if (memberships.length === 0) {
    return errorPage(
      "You need owner or admin access to a workspace to authorize an MCP connection.",
      403,
    );
  }

  const hidden = (name: string, value: string) =>
    `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`;

  const workspaceOptions = memberships
    .map(
      (membership) =>
        `<option value="${escapeHtml(membership.workspace.slug)}">${escapeHtml(
          membership.workspace.name,
        )}</option>`,
    )
    .join("");

  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Authorize ${escapeHtml(
      client.name,
    )} · Herald</title><style>
      :root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f172a;color:#e2e8f0;font:15px/1.5 system-ui,sans-serif}
      main{width:min(560px,calc(100% - 32px));background:#111c33;border:1px solid #26344f;border-radius:14px;padding:28px}
      h1{font-size:22px;margin:0 0 6px}p{color:#a9b6cc;margin:0 0 16px}
      .client{color:#f8fafc;font-weight:600}label{display:block;font-size:13px;margin:18px 0 6px;color:#cbd5e1}
      select{width:100%;padding:10px;border-radius:8px;border:1px solid #334155;background:#0b1426;color:#e2e8f0}
      ul{margin:8px 0 0;padding-left:20px;color:#cbd5e1}li{margin:4px 0}
      .actions{display:flex;gap:10px;margin-top:24px}button{flex:1;padding:11px 14px;border-radius:9px;border:0;font:inherit;font-weight:600;cursor:pointer}
      .allow{background:#2563eb;color:#fff}.deny{background:#1e293b;color:#e2e8f0;border:1px solid #334155}
      .note{font-size:12px;color:#8291a9;margin-top:16px}
    </style></head><body><main>
      <h1>Authorize MCP access</h1>
      <p><span class="client">${escapeHtml(
        client.name,
      )}</span> wants to read and change workspace data through Herald’s MCP server.</p>
      <form method="post" action="/oauth/authorize">
        ${hidden("client_id", parsed.value.clientId)}
        ${hidden("redirect_uri", parsed.value.redirectUri)}
        ${hidden("state", parsed.value.state ?? "")}
        ${hidden("code_challenge", parsed.value.codeChallenge)}
        ${hidden("scope", parsed.value.scopes.join(" "))}
        <label for="workspace">Workspace</label>
        <select id="workspace" name="workspace" required>${workspaceOptions}</select>
        <label>Granted scopes</label>
        <ul>${parsed.value.scopes
          .map(
            (scope) =>
              `<li><strong>${escapeHtml(scope)}</strong> — ${
                scope === "read"
                  ? "read boards, requests, changelogs, companies and conversations"
                  : "create and update resources, reply and add notes"
              }</li>`,
          )
          .join("")}</ul>
        <div class="actions">
          <button class="deny" type="submit" name="decision" value="deny">Cancel</button>
          <button class="allow" type="submit" name="decision" value="allow">Allow access</button>
        </div>
      </form>
      <p class="note">Access creates an API token in the selected workspace. Revoke it any time under Settings → API tokens.</p>
    </main></body></html>`,
    { headers: PAGE_HEADERS },
  );
}

function redirectWithError(redirectUri: string, state: string | null, error: string) {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  if (state) url.searchParams.set("state", state);
  return NextResponse.redirect(url);
}

export async function POST(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  if (
    !isSameOriginRequest({
      origin: request.headers.get("origin"),
      secFetchSite: request.headers.get("sec-fetch-site"),
      expectedOrigin: url.origin,
    })
  ) {
    return errorPage("This authorization request must come from the app.", 403);
  }

  const form = await request.formData();
  const params = new URLSearchParams();
  for (const name of [
    "client_id",
    "redirect_uri",
    "state",
    "code_challenge",
    "scope",
  ]) {
    const value = form.get(name);
    if (typeof value === "string") params.set(name, value);
  }
  params.set("response_type", "code");
  params.set("code_challenge_method", "S256");

  const parsed = parseAuthRequest(params);
  if (!parsed.ok) return errorPage(parsed.error);

  const clientRows = await db
    .select()
    .from(mcpOauthClients)
    .where(eq(mcpOauthClients.clientId, parsed.value.clientId))
    .limit(1);
  const client = clientRows[0];
  if (!client) return errorPage("Unknown client_id.");
  if (!client.redirectUris.includes(parsed.value.redirectUri)) {
    return errorPage("redirect_uri does not match the registered client.");
  }

  if (form.get("decision") !== "allow") {
    return redirectWithError(parsed.value.redirectUri, parsed.value.state, "access_denied");
  }

  const user = await getSessionUser();
  if (!user) return errorPage("Your session expired. Reload and sign in again.", 401);

  const workspaceSlug = form.get("workspace");
  if (typeof workspaceSlug !== "string") return errorPage("Choose a workspace.");

  const membership = (await listWorkspacesForUser(user.id)).find(
    (item) => item.workspace.slug === workspaceSlug,
  );
  if (!membership || !hasPermission(membership.role, "settings:manage")) {
    return errorPage("You do not have permission to authorize this workspace.", 403);
  }
  if (await isEnterpriseSsoRequired(membership.workspace.id, user.id)) {
    return errorPage("Sign in with single sign-on before authorizing this workspace.", 403);
  }

  const code = newOAuthCode();
  const now = new Date();
  await db.insert(mcpOauthCodes).values({
    codeHash: hashOAuthValue(code),
    clientId: parsed.value.clientId,
    userId: user.id,
    workspaceId: membership.workspace.id,
    redirectUri: parsed.value.redirectUri,
    codeChallenge: parsed.value.codeChallenge,
    scopes: parsed.value.scopes,
    expiresAt: new Date(now.getTime() + MCP_OAUTH_CODE_TTL_MS),
  });

  const success = new URL(parsed.value.redirectUri);
  success.searchParams.set("code", code);
  if (parsed.value.state) success.searchParams.set("state", parsed.value.state);
  return NextResponse.redirect(success);
}
