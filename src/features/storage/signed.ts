import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed storage URLs.
 *
 * The URL carries the key, an expiry timestamp and an HMAC over both. The
 * signature is checked in constant time before any filesystem access. This is
 * independent of the storage driver: a cloud driver would issue its own native
 * signed URL through the same abstraction.
 */

const VERSION = "herald.storage.url.v1";
const MAX_TTL_MS = 24 * 60 * 60 * 1000;

function signatureFor(key: string, expiresAt: number, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${VERSION}.${expiresAt}.${key}`)
    .digest("base64url");
}

export function signStorageKey(input: {
  key: string;
  expiresAt: number;
  secret: string;
}): string {
  return signatureFor(input.key, input.expiresAt, input.secret);
}

export function verifyStorageSignature(input: {
  key: string;
  expiresAt: number;
  signature: string;
  secret: string;
  now?: number;
}): boolean {
  const now = input.now ?? Date.now();
  if (!Number.isFinite(input.expiresAt)) return false;
  if (input.expiresAt <= now) return false;
  if (input.expiresAt > now + MAX_TTL_MS) return false;

  const expected = signatureFor(input.key, input.expiresAt, input.secret);
  const provided = Buffer.from(input.signature);
  const wanted = Buffer.from(expected);
  if (provided.length !== wanted.length) return false;
  return timingSafeEqual(provided, wanted);
}

export function buildSignedStoragePath(input: {
  key: string;
  expiresAt: number;
  signature: string;
}): string {
  const encodedKey = input.key.split("/").map(encodeURIComponent).join("/");
  const query = new URLSearchParams({
    expires: String(input.expiresAt),
    signature: input.signature,
  });
  return `/api/storage/${encodedKey}?${query.toString()}`;
}
