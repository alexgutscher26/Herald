import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";

import { getServerEnv } from "@/lib/env";

/**
 * Encryption for workspace SSO secrets at rest.
 *
 * The key is derived from `BETTER_AUTH_SECRET` with a domain-separated label,
 * so the value used here is not the session-signing key. AES-256-GCM provides
 * confidentiality and tamper detection; a wrong key or edited ciphertext
 * decrypts to `null` and SSO fails closed.
 */

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function getEncryptionKey(): Buffer {
  return createHmac("sha256", getServerEnv().BETTER_AUTH_SECRET)
    .update("herald.workspace-sso.secret-key.v1")
    .digest();
}

function decode(value: string): Buffer | null {
  try {
    return Buffer.from(value, "base64url");
  } catch {
    return null;
  }
}

export function encryptSsoSecret(secret: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptSsoSecret(encrypted: string): string | null {
  const parts = encrypted.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;

  const iv = decode(parts[1] ?? "");
  const tag = decode(parts[2] ?? "");
  const ciphertext = decode(parts[3] ?? "");
  if (!iv || !tag || !ciphertext) return null;
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;

  try {
    const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

/** 32 random bytes, base64url — a valid HS256 key. */
export function generateSsoSecret(): string {
  return randomBytes(32).toString("base64url");
}
