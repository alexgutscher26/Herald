import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * HS256 identity tokens for customer SSO.
 *
 * This is deliberately a small, dependency-free verifier. It accepts only
 * HS256 — never `none`, RS256 or a token that asks us to fetch a key — so the
 * algorithm cannot be downgraded by the token itself. Lifetime is bounded:
 * `iat`/`exp` are required, `exp - iat` may not exceed one hour, and a
 * sixty-second skew is the only tolerance.
 *
 * The module is pure: no environment, no database. The caller supplies the
 * secret and the expected claims.
 */

export const JWT_MAX_LIFETIME_SECONDS = 60 * 60;
export const JWT_CLOCK_SKEW_SECONDS = 60;

export type JwtClaims = {
  sub: string;
  iss: string;
  aud: string | string[];
  iat: number;
  exp: number;
};

export type CustomerCompanyClaims = {
  externalId: string | null;
  name: string;
  domain: string | null;
  role: string | null;
  traits: Record<string, string | number | boolean>;
};

export type CustomerIdentityClaims = {
  subject: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  traits: Record<string, string | number | boolean>;
  /** `null` when the token omits companies, which leaves memberships alone. */
  companies: CustomerCompanyClaims[] | null;
};

export type JwtFailureReason =
  | "malformed"
  | "algorithm"
  | "signature"
  | "expired"
  | "not_yet_valid"
  | "lifetime"
  | "issuer"
  | "audience"
  | "subject";

export type JwtVerification =
  | { ok: true; claims: JwtClaims; payload: Record<string, unknown> }
  | { ok: false; reason: JwtFailureReason };

type VerifyInput = {
  token: string;
  secret: string;
  issuer: string;
  audience: string;
  now?: Date;
};

function decodeSegment(segment: string): Buffer | null {
  if (segment.length === 0 || !/^[A-Za-z0-9_-]+$/.test(segment)) return null;
  try {
    return Buffer.from(segment, "base64url");
  } catch {
    return null;
  }
}

function parseJson(buffer: Buffer): unknown {
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch {
    return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function verifyHs256Jwt(input: VerifyInput): JwtVerification {
  const parts = input.token.trim().split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };

  const [encodedHeader, encodedPayload, encodedSignature] = parts as [
    string,
    string,
    string,
  ];
  const headerBuffer = decodeSegment(encodedHeader);
  const payloadBuffer = decodeSegment(encodedPayload);
  const signatureBuffer = decodeSegment(encodedSignature);
  if (!headerBuffer || !payloadBuffer || !signatureBuffer) {
    return { ok: false, reason: "malformed" };
  }

  const header = parseJson(headerBuffer);
  if (!isPlainObject(header) || typeof header.alg !== "string") {
    return { ok: false, reason: "malformed" };
  }
  if (header.alg !== "HS256") return { ok: false, reason: "algorithm" };
  if (header.typ !== undefined && header.typ !== "JWT") {
    return { ok: false, reason: "malformed" };
  }

  const expected = createHmac("sha256", input.secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest();
  if (
    signatureBuffer.length !== expected.length ||
    !timingSafeEqual(signatureBuffer, expected)
  ) {
    return { ok: false, reason: "signature" };
  }

  const payload = parseJson(payloadBuffer);
  if (!isPlainObject(payload)) return { ok: false, reason: "malformed" };

  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);

  if (typeof payload.sub !== "string" || payload.sub.trim().length === 0) {
    return { ok: false, reason: "subject" };
  }
  if (payload.sub.length > 200) return { ok: false, reason: "subject" };
  if (typeof payload.iss !== "string" || payload.iss.length === 0) {
    return { ok: false, reason: "issuer" };
  }
  if (typeof payload.iat !== "number" || typeof payload.exp !== "number") {
    return { ok: false, reason: "malformed" };
  }
  if (!Number.isFinite(payload.iat) || !Number.isFinite(payload.exp)) {
    return { ok: false, reason: "malformed" };
  }

  const lifetime = payload.exp - payload.iat;
  if (lifetime <= 0 || lifetime > JWT_MAX_LIFETIME_SECONDS) {
    return { ok: false, reason: "lifetime" };
  }
  if (payload.exp < nowSeconds - JWT_CLOCK_SKEW_SECONDS) {
    return { ok: false, reason: "expired" };
  }
  if (payload.iat > nowSeconds + JWT_CLOCK_SKEW_SECONDS) {
    return { ok: false, reason: "not_yet_valid" };
  }

  if (payload.iss !== input.issuer) return { ok: false, reason: "issuer" };

  const audience = payload.aud;
  const audiences =
    typeof audience === "string"
      ? [audience]
      : Array.isArray(audience)
        ? audience.filter((value): value is string => typeof value === "string")
        : [];
  if (!audiences.includes(input.audience)) {
    return { ok: false, reason: "audience" };
  }

  return {
    ok: true,
    claims: {
      sub: payload.sub,
      iss: payload.iss,
      aud: audience as string | string[],
      iat: payload.iat,
      exp: payload.exp,
    },
    payload,
  };
}

/**
 * Read identity fields from an already-verified payload.
 *
 * Optional fields are normalized rather than trusted blindly: an invalid email
 * is dropped, a non-object `traits` value is ignored, and only scalar trait
 * values survive. That keeps public profiles and the `traits` JSONB column from
 * accepting arbitrary nested structures.
 */
function parseScalarTraits(
  value: unknown,
): Record<string, string | number | boolean> {
  const traits: Record<string, string | number | boolean> = {};
  if (!isPlainObject(value)) return traits;

  for (const [rawKey, entry] of Object.entries(value).slice(0, 30)) {
    const key = rawKey.trim().slice(0, 64);
    if (key.length === 0) continue;
    if (
      typeof entry === "string" ||
      typeof entry === "boolean" ||
      (typeof entry === "number" && Number.isFinite(entry))
    ) {
      traits[key] = typeof entry === "string" ? entry.slice(0, 500) : entry;
    }
  }

  return traits;
}

function nonEmptyString(value: unknown, maxLength: number): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim().slice(0, maxLength)
    : null;
}

function parseCompanies(value: unknown): CustomerCompanyClaims[] | null {
  if (!Array.isArray(value)) return null;

  const companies: CustomerCompanyClaims[] = [];
  for (const entry of value.slice(0, 20)) {
    if (typeof entry === "string") {
      const name = nonEmptyString(entry, 120);
      if (name) {
        companies.push({
          externalId: null,
          name,
          domain: null,
          role: null,
          traits: {},
        });
      }
      continue;
    }
    if (!isPlainObject(entry)) continue;

    const name = nonEmptyString(entry.name, 120);
    if (!name) continue;

    const rawId = entry.externalId ?? entry.id ?? entry.companyId;
    const externalId =
      typeof rawId === "string" || typeof rawId === "number"
        ? String(rawId).trim().slice(0, 200) || null
        : null;

    companies.push({
      externalId,
      name,
      domain: nonEmptyString(entry.domain, 253),
      role: nonEmptyString(entry.role, 80),
      traits: parseScalarTraits(entry.traits),
    });
  }

  return companies;
}

export function parseCustomerIdentity(
  payload: Record<string, unknown>,
): CustomerIdentityClaims {
  const email =
    typeof payload.email === "string" && payload.email.trim().length > 0
      ? payload.email.trim().slice(0, 254)
      : null;

  const suppliedName = nonEmptyString(payload.name, 120);
  const firstName = nonEmptyString(payload.firstName, 60);
  const lastName = nonEmptyString(payload.lastName, 60);
  const combinedName = [firstName, lastName].filter(Boolean).join(" ");
  const name = suppliedName ?? (combinedName.length > 0 ? combinedName : null);

  const picture =
    typeof payload.picture === "string" && /^https?:\/\//i.test(payload.picture)
      ? payload.picture.slice(0, 500)
      : null;

  return {
    subject: String(payload.sub ?? ""),
    email,
    name,
    avatarUrl: picture,
    traits: parseScalarTraits(payload.traits),
    companies: parseCompanies(payload.companies),
  };
}

/**
 * Create a token with the same rules the verifier enforces.
 *
 * Used by tests and by the widget documentation example; no production route
 * mints tokens, because only the workspace's own systems hold the secret.
 */
export function signHs256Jwt(input: {
  secret: string;
  subject: string;
  issuer: string;
  audience: string;
  /** Seconds from `iat`. The verifier still enforces the one-hour maximum. */
  lifetimeSeconds?: number | undefined;
  issuedAt?: number | undefined;
  claims?: Record<string, unknown> | undefined;
}): string {
  const issuedAt = input.issuedAt ?? Math.floor(Date.now() / 1000);
  const lifetime = Math.max(Math.trunc(input.lifetimeSeconds ?? 300), 1);

  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
    "utf8",
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      ...input.claims,
      sub: input.subject,
      iss: input.issuer,
      aud: input.audience,
      iat: issuedAt,
      exp: issuedAt + lifetime,
    }),
    "utf8",
  ).toString("base64url");

  const signature = createHmac("sha256", input.secret)
    .update(`${header}.${payload}`)
    .digest("base64url");

  return `${header}.${payload}.${signature}`;
}
