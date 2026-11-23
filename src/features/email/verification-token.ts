import { createHash, randomBytes } from "node:crypto";

/** Sender mailbox verification token helpers (no database or server imports). */

export const SENDER_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
export const SENDER_VERIFICATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type SenderVerificationPurpose = "from" | "reply_to";

export function createSenderVerificationToken(): string {
  return randomBytes(32).toString("base64url");
}

export function isSenderVerificationToken(value: string): boolean {
  return SENDER_VERIFICATION_TOKEN_PATTERN.test(value);
}

/** Only this hash is stored; possession of the database cannot mint a link. */
export function hashSenderVerificationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
