import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { getServerEnv } from "@/lib/env";

/**
 * OAuth 2.1 authorization-server helpers for the remote MCP endpoint.
 *
 * Herald is a public client issuer: there is no client secret. Authorization
 * codes are single-use, expire after five minutes and are bound to a PKCE S256
 * challenge and one exact redirect URI. Access tokens are ordinary workspace
 * API tokens with a hard expiry, so MCP and REST share scopes, tenant isolation
 * and revocation.
 */

export const MCP_OAUTH_SCOPES = ["read", "write"] as const;
export const MCP_OAUTH_CODE_TTL_MS = 5 * 60 * 1000;
export const MCP_OAUTH_ACCESS_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Canonical public origin, never derived from a request Host header. */
export function mcpOAuthOrigin(): string {
  return getServerEnv().BETTER_AUTH_URL.replace(/\/+$/, "");
}

export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
    scopes_supported: [...MCP_OAUTH_SCOPES],
    resource_name: "Herald MCP",
  };
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...MCP_OAUTH_SCOPES],
  };
}

/** Public clients may use HTTPS anywhere, or HTTP on a loopback host. */
export function isAllowedRedirectUri(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) {
    return false;
  }
  if (value.includes("#")) return false;

  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    if (url.protocol === "https:") return true;
    if (url.protocol !== "http:") return false;
    return (
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

export function normalizeClientName(value: unknown): string {
  if (typeof value !== "string") return "MCP client";
  const name = value.trim().slice(0, 120);
  return name.length > 0 ? name : "MCP client";
}

export function newOAuthClientId(): string {
  return `mcp_${randomBytes(24).toString("base64url")}`;
}

export function newOAuthCode(): string {
  return randomBytes(32).toString("base64url");
}

export function hashOAuthValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function verifyPkce(input: {
  verifier: string;
  challenge: string;
}): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(input.verifier)) return false;
  const computed = createHash("sha256").update(input.verifier).digest("base64url");
  const actual = Buffer.from(computed);
  const expected = Buffer.from(input.challenge);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Escape untrusted text before it is interpolated into the consent page. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
