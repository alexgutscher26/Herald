import "server-only";

import { getAuth } from "@/lib/auth";
import { logEvent, serializeError } from "@/lib/logger";

import {
  PASSWORD_RESET_MAX_LENGTH,
  PASSWORD_RESET_MIN_LENGTH,
} from "./reset-token";
import {
  consumeHashedResetToken,
  handOffResetTokenToBetterAuth,
} from "./reset-token-store";

/**
 * Complete a password reset from the emailed token.
 *
 * The token is validated and spent here (single use), then handed to Better
 * Auth's own `resetPassword` endpoint so password hashing, the expiry check and
 * `revokeSessionsOnPasswordReset` stay inside the library. `onPasswordReset` in
 * `src/lib/auth.ts` sends the "password changed" notice.
 */

export type ResetPasswordOutcome =
  | { ok: true }
  | { ok: false; error: string };

const EXPIRED = "This link has expired. Request a new one.";
const INVALID = "This link is no longer valid. Request a new one.";

export async function completePasswordReset(input: {
  token: string;
  newPassword: string;
}): Promise<ResetPasswordOutcome> {
  // Validate before spending the token, so a rejected password does not force
  // the user to request a second email.
  if (input.newPassword.length < PASSWORD_RESET_MIN_LENGTH) {
    return {
      ok: false,
      error: `Use at least ${PASSWORD_RESET_MIN_LENGTH} characters.`,
    };
  }
  if (input.newPassword.length > PASSWORD_RESET_MAX_LENGTH) {
    return {
      ok: false,
      error: `Use ${PASSWORD_RESET_MAX_LENGTH} characters or fewer.`,
    };
  }

  const lookup = await consumeHashedResetToken(input.token);
  if (!lookup.ok) {
    return { ok: false, error: lookup.reason === "expired" ? EXPIRED : INVALID };
  }

  await handOffResetTokenToBetterAuth({
    userId: lookup.userId,
    rawToken: input.token,
    expiresAt: lookup.expiresAt,
  });

  try {
    await getAuth().api.resetPassword({
      body: { token: input.token, newPassword: input.newPassword },
    });
  } catch (error) {
    logEvent("warn", "auth.password_reset_failed", {
      error: serializeError(error),
    });
    return {
      ok: false,
      error: "Could not change the password. Request a new link and try again.",
    };
  }

  return { ok: true };
}
