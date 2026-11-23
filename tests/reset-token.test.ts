import { describe, expect, test } from "bun:test";

import {
  BETTER_AUTH_RESET_PREFIX,
  PASSWORD_RESET_PREFIX,
  betterAuthResetIdentifier,
} from "@/features/auth/reset-token";
import {
  hashResetToken,
  hashedResetIdentifier,
} from "@/features/auth/reset-token-hash";

/**
 * The reset token is stored hashed, so a database snapshot cannot be replayed
 * against `/api/auth/password-reset`. These are the pure functions behind that
 * guarantee; the row handling is covered in
 * `tests/integration/password-reset.test.ts`.
 */

const TOKEN = "8f3a1c0d9b7e6f5a4c2b1d0e9f8a7b6c";

describe("password reset identifiers", () => {
  test("stores a sha256 hash, never the token", () => {
    const identifier = hashedResetIdentifier(TOKEN);

    expect(identifier.startsWith(PASSWORD_RESET_PREFIX)).toBe(true);
    expect(identifier).not.toContain(TOKEN);
    expect(identifier).toBe(`${PASSWORD_RESET_PREFIX}${hashResetToken(TOKEN)}`);
    expect(identifier).toMatch(/^password-reset:[0-9a-f]{64}$/);
  });

  test("hashes deterministically and differently per token", () => {
    expect(hashResetToken(TOKEN)).toBe(hashResetToken(TOKEN));
    expect(hashResetToken(TOKEN)).not.toBe(hashResetToken(`${TOKEN}x`));
    expect(hashResetToken(TOKEN)).toHaveLength(64);
  });

  test("keeps the Better Auth identifier separate from the hashed one", () => {
    const betterAuth = betterAuthResetIdentifier(TOKEN);

    expect(betterAuth).toBe(`${BETTER_AUTH_RESET_PREFIX}${TOKEN}`);
    expect(betterAuth).not.toBe(hashedResetIdentifier(TOKEN));
    // The two prefixes must not be one another's prefix, or the cleanup that
    // deletes pending hashed rows would also match Better Auth's row.
    expect(BETTER_AUTH_RESET_PREFIX.startsWith(PASSWORD_RESET_PREFIX)).toBe(false);
    expect(PASSWORD_RESET_PREFIX.startsWith(BETTER_AUTH_RESET_PREFIX)).toBe(false);
  });
});
