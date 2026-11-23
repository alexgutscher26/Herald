import { describe, expect, test } from "bun:test";

import {
  createSessionToken,
  hashSessionToken,
  signSessionToken,
  verifySessionCookie,
} from "@/features/customer-session/token";

const SECRET = "test-only-customer-session-secret-0123456789";

describe("customer session tokens", () => {
  test("round-trips a signed cookie", () => {
    const { token } = createSessionToken();
    const cookie = signSessionToken(token, SECRET);
    expect(verifySessionCookie(cookie, SECRET)).toBe(token);
  });

  test("produces unique high-entropy tokens", () => {
    const first = createSessionToken();
    const second = createSessionToken();
    expect(first.token).not.toBe(second.token);
    expect(first.tokenHash).not.toBe(second.tokenHash);
    expect(first.token.length).toBeGreaterThanOrEqual(32);
  });

  test("stores only a stable SHA-256 hash, never the token", () => {
    const { token, tokenHash } = createSessionToken();
    expect(tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(tokenHash).toBe(hashSessionToken(token));
    expect(tokenHash).not.toContain(token);
  });

  test("rejects a token whose signature belongs to another token", () => {
    const first = createSessionToken();
    const second = createSessionToken();
    const signature = signSessionToken(second.token, SECRET).split(".")[1];
    expect(verifySessionCookie(`${first.token}.${signature}`, SECRET)).toBeNull();
  });

  test("rejects a tampered signature", () => {
    const { token } = createSessionToken();
    const cookie = signSessionToken(token, SECRET);
    const tampered = `${cookie.slice(0, -1)}${cookie.endsWith("A") ? "B" : "A"}`;
    expect(verifySessionCookie(tampered, SECRET)).toBeNull();
  });

  test("rejects a cookie signed with another secret", () => {
    const { token } = createSessionToken();
    const cookie = signSessionToken(token, `${SECRET}-other`);
    expect(verifySessionCookie(cookie, SECRET)).toBeNull();
  });

  test("rejects malformed values", () => {
    for (const value of ["", ".", "token.", ".signature", "no-separator", "a.b.c"]) {
      expect(verifySessionCookie(value, SECRET)).toBeNull();
    }
  });

  test("rejects a correctly signed but malformed token", () => {
    expect(verifySessionCookie(signSessionToken("short", SECRET), SECRET)).toBeNull();
  });
});
