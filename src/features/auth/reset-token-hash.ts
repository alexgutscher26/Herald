import { createHash } from "node:crypto";

import { PASSWORD_RESET_PREFIX } from "./reset-token";

/**
 * Hashing for password-reset tokens.
 *
 * Kept apart from `reset-token.ts` because this module imports `node:crypto`
 * and must never be reachable from a client component; `reset-token-store.ts`
 * is the only caller in the app, and the unit test exercises the digest.
 */

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** The identifier of the stored row: the token itself never appears in it. */
export function hashedResetIdentifier(token: string): string {
  return `${PASSWORD_RESET_PREFIX}${hashResetToken(token)}`;
}
