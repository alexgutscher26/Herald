/**
 * Password-reset token identifiers.
 *
 * Better Auth looks a reset token up as the plain-text identifier
 * `reset-password:<token>` in the `verification` table. This module describes
 * that row and the hashed row we store instead, so a leaked database snapshot
 * cannot be replayed against the reset endpoint:
 *
 *   - `password-reset:` + sha256(token) → written at request time
 *     (`reset-token-hash.ts` builds the digest),
 *   - `reset-password:` + token → created only at completion time and consumed
 *     inside Better Auth's reset transaction.
 *
 * Constants and identifier helpers only — no `node:crypto` import — so client
 * components can share the password bounds without pulling a Node built-in into
 * the browser bundle.
 */

export const PASSWORD_RESET_PREFIX = "password-reset:";
export const BETTER_AUTH_RESET_PREFIX = "reset-password:";

/** One hour, matching the window the reset email promises. */
export const PASSWORD_RESET_TTL_SECONDS = 60 * 60;

/** At least 10, matching `emailAndPassword.minPasswordLength` in `src/lib/auth.ts`. */
export const PASSWORD_RESET_MIN_LENGTH = 10;
export const PASSWORD_RESET_MAX_LENGTH = 128;

/** The identifier Better Auth resolves when `resetPassword` is called. */
export function betterAuthResetIdentifier(token: string): string {
  return `${BETTER_AUTH_RESET_PREFIX}${token}`;
}
