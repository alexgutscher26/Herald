import { describe, expect, test } from "bun:test";

import {
  parseCustomerIdentity,
  signHs256Jwt,
  verifyHs256Jwt,
} from "@/features/customer-auth/jwt";
import { sanitizeNextPath } from "@/features/customer-auth/next-path";

const SECRET = "a-test-secret-that-is-long-enough-for-hs256";
const ISSUER = "herald";
const AUDIENCE = "acme";

function token(
  overrides: Partial<{
    secret: string;
    subject: string;
    issuer: string;
    audience: string;
    lifetimeSeconds: number;
    issuedAt: number;
    claims: Record<string, unknown>;
  }> = {},
): string {
  return signHs256Jwt({
    secret: overrides.secret ?? SECRET,
    subject: overrides.subject ?? "customer-1",
    issuer: overrides.issuer ?? ISSUER,
    audience: overrides.audience ?? AUDIENCE,
    lifetimeSeconds: overrides.lifetimeSeconds ?? 300,
    issuedAt: overrides.issuedAt,
    claims: overrides.claims,
  });
}

function verify(value: string, now = new Date()) {
  return verifyHs256Jwt({
    token: value,
    secret: SECRET,
    issuer: ISSUER,
    audience: AUDIENCE,
    now,
  });
}

describe("HS256 identity verification", () => {
  test("accepts a token that matches the secret, issuer and audience", () => {
    const result = verify(token({ claims: { email: "ada@example.test" } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.claims.sub).toBe("customer-1");
    expect(result.claims.iss).toBe(ISSUER);
    expect(result.claims.aud).toBe(AUDIENCE);
    expect(result.payload.email).toBe("ada@example.test");
  });

  test("rejects a signature from another secret", () => {
    expect(verify(token({ secret: "a-different-secret-value" }))).toEqual({
      ok: false,
      reason: "signature",
    });
  });

  test("rejects any algorithm other than HS256", () => {
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString(
      "base64url",
    );
    const payload = Buffer.from(
      JSON.stringify({
        sub: "customer-1",
        iss: ISSUER,
        aud: AUDIENCE,
        iat: 1,
        exp: 9_999_999_999,
      }),
    ).toString("base64url");

    expect(verify(`${header}.${payload}.c2ln`)).toEqual({
      ok: false,
      reason: "algorithm",
    });
  });

  test("rejects an expired token and one from the future", () => {
    const expired = token({
      issuedAt: Math.floor(Date.now() / 1000) - 3600,
      lifetimeSeconds: 60,
    });
    expect(verify(expired)).toEqual({ ok: false, reason: "expired" });

    const future = token({
      issuedAt: Math.floor(Date.now() / 1000) + 600,
      lifetimeSeconds: 60,
    });
    expect(verify(future)).toEqual({ ok: false, reason: "not_yet_valid" });
  });

  test("rejects a lifetime longer than one hour", () => {
    expect(verify(token({ lifetimeSeconds: 60 * 60 + 1 }))).toEqual({
      ok: false,
      reason: "lifetime",
    });
  });

  test("rejects a mismatched issuer or audience", () => {
    expect(verify(token({ issuer: "somebody-else" }))).toEqual({
      ok: false,
      reason: "issuer",
    });
    expect(verify(token({ audience: "another-workspace" }))).toEqual({
      ok: false,
      reason: "audience",
    });
  });

  test("requires a subject", () => {
    expect(verify(token({ subject: "" }))).toEqual({
      ok: false,
      reason: "subject",
    });
  });

  test("rejects a malformed token", () => {
    expect(verify("not-a-token")).toEqual({ ok: false, reason: "malformed" });
  });
});

describe("identity claims", () => {
  test("keeps only scalar traits and normalizes optional fields", () => {
    const identity = parseCustomerIdentity({
      sub: "customer-1",
      email: "  ada@example.test ",
      name: " Ada ",
      picture: "javascript:alert(1)",
      traits: {
        plan: "pro",
        seats: 4,
        active: true,
        nested: { no: "thanks" },
        empty: "",
        "  ": "ignored",
      },
    });

    expect(identity).toEqual({
      subject: "customer-1",
      email: "ada@example.test",
      name: "Ada",
      avatarUrl: null,
      traits: { plan: "pro", seats: 4, active: true, empty: "" },
      companies: null,
    });
  });

  test("reads names and bounded company claims", () => {
    const identity = parseCustomerIdentity({
      sub: "customer-2",
      firstName: "Grace",
      lastName: "Hopper",
      companies: [
        {
          id: "crm-9",
          name: " Acme ",
          domain: "https://www.acme.example/path",
          role: "owner",
          traits: { plan: "enterprise", seats: 250, nested: { no: true } },
        },
        "Solo Co",
        { role: "missing-name" },
        "   ",
      ],
    });

    expect(identity.name).toBe("Grace Hopper");
    expect(identity.companies).toEqual([
      {
        externalId: "crm-9",
        name: "Acme",
        domain: "https://www.acme.example/path",
        role: "owner",
        traits: { plan: "enterprise", seats: 250 },
      },
      {
        externalId: null,
        name: "Solo Co",
        domain: null,
        role: null,
        traits: {},
      },
    ]);
  });
});

describe("sanitizeNextPath", () => {
  test("allows only same-site public paths", () => {
    expect(sanitizeNextPath("/p/acme/app/feedback")).toBe("/p/acme/app/feedback");
    expect(sanitizeNextPath("//evil.example/p/acme/app")).toBeNull();
    expect(sanitizeNextPath("https://evil.example/p/acme/app")).toBeNull();
    expect(sanitizeNextPath("/app/acme/app")).toBeNull();
    expect(sanitizeNextPath("/p/acme/app\\..\\secret")).toBeNull();
    expect(sanitizeNextPath("/p/acme/app/\nheader")).toBeNull();
  });
});
