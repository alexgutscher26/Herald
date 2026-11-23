import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";

import {
  authorizationServerMetadata,
  isAllowedRedirectUri,
  normalizeClientName,
  protectedResourceMetadata,
  verifyPkce,
} from "@/features/mcp/oauth";

/**
 * OAuth discovery and PKCE are pure; these tests prove the public metadata
 * points at real routes and that redirect/PKCE checks cannot be bypassed.
 */

describe("MCP OAuth", () => {
  test("advertises the authorization, token and registration endpoints", () => {
    const metadata = authorizationServerMetadata("https://herald.example");

    expect(metadata.issuer).toBe("https://herald.example");
    expect(metadata.authorization_endpoint).toBe(
      "https://herald.example/oauth/authorize",
    );
    expect(metadata.token_endpoint).toBe("https://herald.example/oauth/token");
    expect(metadata.registration_endpoint).toBe(
      "https://herald.example/oauth/register",
    );
    expect(metadata.code_challenge_methods_supported).toEqual(["S256"]);
    expect(metadata.token_endpoint_auth_methods_supported).toEqual(["none"]);
  });

  test("protected-resource metadata names the MCP endpoint and its scopes", () => {
    const metadata = protectedResourceMetadata("https://herald.example");

    expect(metadata.resource).toBe("https://herald.example/api/mcp");
    expect(metadata.authorization_servers).toEqual(["https://herald.example"]);
    expect(metadata.scopes_supported).toEqual(["read", "write"]);
    expect(metadata.bearer_methods_supported).toEqual(["header"]);
  });

  test("redirect URIs must be HTTPS or loopback HTTP with no fragment", () => {
    expect(isAllowedRedirectUri("https://chatgpt.com/connector/oauth/callback")).toBe(
      true,
    );
    expect(isAllowedRedirectUri("http://localhost:33418/callback")).toBe(true);
    expect(isAllowedRedirectUri("http://127.0.0.1:1455/callback")).toBe(true);
    expect(isAllowedRedirectUri("http://herald.example/callback")).toBe(false);
    expect(isAllowedRedirectUri("https://user:pass@example.com/cb")).toBe(false);
    expect(isAllowedRedirectUri("https://example.com/cb#fragment")).toBe(false);
    expect(isAllowedRedirectUri("javascript:alert(1)")).toBe(false);
    expect(isAllowedRedirectUri("")).toBe(false);
  });

  test("PKCE compares an S256 challenge and rejects malformed verifiers", () => {
    const verifier = "a".repeat(43);
    const challenge = createHash("sha256").update(verifier).digest("base64url");

    expect(verifyPkce({ verifier, challenge })).toBe(true);
    expect(verifyPkce({ verifier: "b".repeat(43), challenge })).toBe(false);
    expect(verifyPkce({ verifier: "short", challenge })).toBe(false);
    expect(verifyPkce({ verifier: `${"a".repeat(42)}!`, challenge })).toBe(false);
  });

  test("client names are trimmed, bounded and never empty", () => {
    expect(normalizeClientName("  ChatGPT  ")).toBe("ChatGPT");
    expect(normalizeClientName("")).toBe("MCP client");
    expect(normalizeClientName(null)).toBe("MCP client");
    expect(normalizeClientName("x".repeat(500))).toHaveLength(120);
  });
});
