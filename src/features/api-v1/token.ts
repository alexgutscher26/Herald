import { createHash, randomBytes } from "node:crypto";

/**
 * API token minting and verification helpers.
 *
 * A raw token has three parts: the literal `hrl_` product prefix, a random
 * eight-character prefix that is safe to store and display, and a 32-byte
 * secret. Only a SHA-256 hash of the whole token is persisted, so a database
 * read cannot be replayed as an API call.
 *
 * These functions are pure (no database, no request context) and unit-tested.
 */

export const API_TOKEN_PRODUCT_PREFIX = "hrl_";
export const API_TOKEN_PREFIX_LENGTH = 12;
export const API_TOKEN_MIN_LENGTH = 24;
export const API_TOKEN_MAX_LENGTH = 200;

/** Raw token, its stored hash, and the non-secret prefix to show in listings. */
export type NewApiTokenMaterial = {
  token: string;
  tokenHash: string;
  prefix: string;
};

/** SHA-256 of the complete bearer token, hex encoded. */
export function hashApiToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Create a token and the values that are safe to persist.
 *
 * 32 random bytes give 256 bits of entropy; base64url keeps the token usable
 * in an `Authorization` header without escaping.
 */
export function createApiTokenMaterial(): NewApiTokenMaterial {
  const prefix = randomBytes(4).toString("hex");
  const secret = randomBytes(32).toString("base64url");
  const token = `${API_TOKEN_PRODUCT_PREFIX}${prefix}_${secret}`;

  return {
    token,
    tokenHash: hashApiToken(token),
    prefix: token.slice(0, API_TOKEN_PREFIX_LENGTH),
  };
}

/**
 * Cheap shape check before hashing.
 *
 * Deliberately strict: anything that does not look like one of our tokens is
 * rejected without a database lookup, which keeps junk headers from becoming
 * queries. The check is not a security boundary — the hash lookup is.
 */
export function isApiTokenShaped(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length < API_TOKEN_MIN_LENGTH || value.length > API_TOKEN_MAX_LENGTH) {
    return false;
  }
  return /^hrl_[a-f0-9]{8}_[A-Za-z0-9_-]{32,}$/.test(value);
}

/** Extract a bearer token from an `Authorization` header. */
export function readBearerToken(header: string | null | undefined): string | null {
  if (typeof header !== "string") return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}
