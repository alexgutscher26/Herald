import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Customer session tokens.
 *
 * The cookie carries a random opaque token plus an HMAC signature. The
 * database stores only a SHA-256 hash of the token, so a database read cannot
 * be replayed as a cookie. Signature verification happens before the database
 * lookup, and comparison is constant-time.
 *
 * A domain-separated key is supplied by the caller; this module never reads
 * the environment.
 */

const VERSION = "herald.customer-session.v1";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export type NewSessionToken = {
  token: string;
  tokenHash: string;
};

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createSessionToken(): NewSessionToken {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashSessionToken(token) };
}

export function signSessionToken(token: string, secret: string): string {
  const signature = createHmac("sha256", secret)
    .update(`${VERSION}.${token}`)
    .digest("base64url");
  return `${token}.${signature}`;
}

/**
 * Verify a cookie and return its token, or `null` for any malformed,
 * tampered or wrongly-signed value.
 */
export function verifySessionCookie(value: string, secret: string): string | null {
  const separator = value.lastIndexOf(".");
  if (separator <= 0 || separator === value.length - 1) return null;

  const token = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  if (!TOKEN_PATTERN.test(token)) return null;

  const expected = createHmac("sha256", secret)
    .update(`${VERSION}.${token}`)
    .digest("base64url");

  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length) return null;
  if (!timingSafeEqual(providedBuffer, expectedBuffer)) return null;

  return token;
}
