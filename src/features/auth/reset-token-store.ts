import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq, like } from "drizzle-orm";

import { db } from "@/db";
import { verification } from "@/db/schema/auth";

import {
  BETTER_AUTH_RESET_PREFIX,
  PASSWORD_RESET_PREFIX,
  betterAuthResetIdentifier,
} from "./reset-token";
import { hashedResetIdentifier } from "./reset-token-hash";

/**
 * Storage for password-reset tokens.
 *
 * Only a sha256 hash of the token is kept between the request and the reset, so
 * reading the `verification` table does not yield a usable link. Consuming a
 * token deletes the row, which makes the link single-use; issuing a new one
 * deletes every previous pending token for the same user.
 */

/**
 * Replace Better Auth's plain-text row with a hashed one.
 *
 * `requestPasswordReset` writes `reset-password:<token>` before calling
 * `sendResetPassword`. That row is removed here so the raw token only ever
 * exists in the email, and the hashed row carries the same expiry.
 */
export async function replaceWithHashedResetToken(input: {
  userId: string;
  rawToken: string;
  expiresAt: Date;
}): Promise<void> {
  await db.transaction(async (tx) => {
    // Every plaintext row for this user, not only the token just issued: a
    // crash between Better Auth's insert and this hook would otherwise leave a
    // replayable row behind until it expired.
    await tx
      .delete(verification)
      .where(
        and(
          eq(verification.value, input.userId),
          like(verification.identifier, `${BETTER_AUTH_RESET_PREFIX}%`),
        ),
      );
    await tx
      .delete(verification)
      .where(
        and(
          eq(verification.value, input.userId),
          like(verification.identifier, `${PASSWORD_RESET_PREFIX}%`),
        ),
      );
    await tx.insert(verification).values({
      id: randomUUID(),
      identifier: hashedResetIdentifier(input.rawToken),
      value: input.userId,
      expiresAt: input.expiresAt,
    });
  });
}

export type ResetTokenLookup =
  | { ok: true; userId: string; expiresAt: Date }
  | { ok: false; reason: "invalid" | "expired" };

/**
 * Spend a hashed reset token.
 *
 * The row is deleted in the same statement that reads it, so two concurrent
 * submissions cannot both succeed. An expired row is reported as expired once
 * and is gone afterwards.
 */
export async function consumeHashedResetToken(
  rawToken: string,
): Promise<ResetTokenLookup> {
  const rows = await db
    .delete(verification)
    .where(eq(verification.identifier, hashedResetIdentifier(rawToken)))
    .returning({ value: verification.value, expiresAt: verification.expiresAt });

  const row = rows[0];
  if (!row) return { ok: false, reason: "invalid" };
  if (row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };
  return { ok: true, userId: row.value, expiresAt: row.expiresAt };
}

/**
 * Re-create the row Better Auth's `resetPassword` endpoint expects.
 *
 * The reset itself stays inside the library so the new password is hashed with
 * its own parameters and `revokeSessionsOnPasswordReset` removes every existing
 * session in the same transaction.
 */
export async function handOffResetTokenToBetterAuth(input: {
  userId: string;
  rawToken: string;
  expiresAt: Date;
}): Promise<void> {
  await db.insert(verification).values({
    id: randomUUID(),
    identifier: betterAuthResetIdentifier(input.rawToken),
    value: input.userId,
    expiresAt: input.expiresAt,
  });
}
