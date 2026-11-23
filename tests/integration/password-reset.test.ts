import { afterAll, beforeAll, describe, expect } from "bun:test";
import { and, eq, like } from "drizzle-orm";

import { db } from "@/db";
import { session, verification } from "@/db/schema";
import { completePasswordReset } from "@/features/auth/password-reset";
import { PASSWORD_RESET_PREFIX } from "@/features/auth/reset-token";
import {
  consumeHashedResetToken,
  replaceWithHashedResetToken,
} from "@/features/auth/reset-token-store";
import { getAuth } from "@/lib/auth";

import {
  SETUP_TIMEOUT_MS,
  isolatedTest,
  setupTestDatabase,
  teardownTestDatabase,
} from "./harness";
import { createUser } from "./factories";

/**
 * Password reset against a real database.
 *
 * The interesting properties are storage-level: only a hash of the token is
 * persisted, consuming deletes the row, an expired row is refused, and the
 * completed reset revokes existing sessions while leaving the new password
 * usable. The reset itself runs through Better Auth's own endpoint, so this is
 * the only place all of that can be checked together.
 */

beforeAll(async () => {
  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

const HOUR_MS = 60 * 60 * 1000;

describe("reset token storage", () => {
  isolatedTest("stores only a hash and drops the plaintext row", async () => {
    const user = await createUser();
    const token = `tok_${crypto.randomUUID()}`;

    // Better Auth writes this row before calling `sendResetPassword`. The stale
    // second row stands in for an earlier request whose cleanup never ran.
    await db.insert(verification).values([
      {
        id: crypto.randomUUID(),
        identifier: `reset-password:${token}`,
        value: user.id,
        expiresAt: new Date(Date.now() + HOUR_MS),
      },
      {
        id: crypto.randomUUID(),
        identifier: `reset-password:tok_${crypto.randomUUID()}`,
        value: user.id,
        expiresAt: new Date(Date.now() + HOUR_MS),
      },
    ]);

    await replaceWithHashedResetToken({
      userId: user.id,
      rawToken: token,
      expiresAt: new Date(Date.now() + HOUR_MS),
    });

    const rows = await db
      .select({ identifier: verification.identifier })
      .from(verification)
      .where(eq(verification.value, user.id));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.identifier).toStartWith(PASSWORD_RESET_PREFIX);
    expect(rows[0]?.identifier).not.toContain(token);
  });

  isolatedTest("issuing a second token invalidates the first", async () => {
    const user = await createUser();
    const first = `tok_${crypto.randomUUID()}`;
    const second = `tok_${crypto.randomUUID()}`;

    await replaceWithHashedResetToken({
      userId: user.id,
      rawToken: first,
      expiresAt: new Date(Date.now() + HOUR_MS),
    });
    await replaceWithHashedResetToken({
      userId: user.id,
      rawToken: second,
      expiresAt: new Date(Date.now() + HOUR_MS),
    });

    expect((await consumeHashedResetToken(first)).ok).toBe(false);

    const pending = await db
      .select({ id: verification.id })
      .from(verification)
      .where(
        and(
          eq(verification.value, user.id),
          like(verification.identifier, `${PASSWORD_RESET_PREFIX}%`),
        ),
      );
    expect(pending).toHaveLength(1);
  });

  isolatedTest("a token is single use", async () => {
    const user = await createUser();
    const token = `tok_${crypto.randomUUID()}`;

    await replaceWithHashedResetToken({
      userId: user.id,
      rawToken: token,
      expiresAt: new Date(Date.now() + HOUR_MS),
    });

    const first = await consumeHashedResetToken(token);
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.userId).toBe(user.id);

    const second = await consumeHashedResetToken(token);
    expect(second).toEqual({ ok: false, reason: "invalid" });
  });

  isolatedTest("an expired token is refused and removed", async () => {
    const user = await createUser();
    const token = `tok_${crypto.randomUUID()}`;

    await replaceWithHashedResetToken({
      userId: user.id,
      rawToken: token,
      expiresAt: new Date(Date.now() - 1000),
    });

    expect(await consumeHashedResetToken(token)).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(await consumeHashedResetToken(token)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });
});

describe("completing a reset", () => {
  isolatedTest("rotates the password and revokes existing sessions", async () => {
    const user = await createUser();

    // First reset creates the credential account so there is a password to
    // change.
    const firstToken = `tok_${crypto.randomUUID()}`;
    await replaceWithHashedResetToken({
      userId: user.id,
      rawToken: firstToken,
      expiresAt: new Date(Date.now() + HOUR_MS),
    });
    expect(
      await completePasswordReset({ token: firstToken, newPassword: "first-password-1" }),
    ).toEqual({ ok: true });

    const signedIn = await getAuth().api.signInEmail({
      body: { email: user.email, password: "first-password-1" },
    });
    expect(signedIn.user.id).toBe(user.id);

    const sessions = await db
      .select({ id: session.id })
      .from(session)
      .where(eq(session.userId, user.id));
    expect(sessions.length).toBeGreaterThan(0);

    const secondToken = `tok_${crypto.randomUUID()}`;
    await replaceWithHashedResetToken({
      userId: user.id,
      rawToken: secondToken,
      expiresAt: new Date(Date.now() + HOUR_MS),
    });
    expect(
      await completePasswordReset({ token: secondToken, newPassword: "second-password-2" }),
    ).toEqual({ ok: true });

    // The token is spent and the old password no longer works.
    expect((await consumeHashedResetToken(secondToken)).ok).toBe(false);
    await expect(
      getAuth().api.signInEmail({
        body: { email: user.email, password: "first-password-1" },
      }),
    ).rejects.toThrow();

    const remaining = await db
      .select({ id: session.id })
      .from(session)
      .where(eq(session.userId, user.id));
    expect(remaining).toHaveLength(0);

    const signedInAgain = await getAuth().api.signInEmail({
      body: { email: user.email, password: "second-password-2" },
    });
    expect(signedInAgain.user.id).toBe(user.id);
  });

  isolatedTest("rejects an expired token without changing the password", async () => {
    const user = await createUser();
    const token = `tok_${crypto.randomUUID()}`;

    await replaceWithHashedResetToken({
      userId: user.id,
      rawToken: token,
      expiresAt: new Date(Date.now() - 1000),
    });

    const outcome = await completePasswordReset({
      token,
      newPassword: "irrelevant-password",
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("expired");
  });

  isolatedTest("rejects a short password before spending the token", async () => {
    const user = await createUser();
    const token = `tok_${crypto.randomUUID()}`;

    await replaceWithHashedResetToken({
      userId: user.id,
      rawToken: token,
      expiresAt: new Date(Date.now() + HOUR_MS),
    });

    const outcome = await completePasswordReset({ token, newPassword: "short" });
    expect(outcome.ok).toBe(false);

    // The token is still usable, so the user does not need a second email.
    expect((await consumeHashedResetToken(token)).ok).toBe(true);
  });
});
