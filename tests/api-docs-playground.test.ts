import { describe, expect, test } from "bun:test";

import {
  isPlaygroundMethod,
  playgroundNeedsWriteScope,
  playgroundScopeAllows,
} from "@/features/api-docs/playground-policy";

/**
 * The playground proxy must not rely on the browser to decide that a write is
 * allowed. These are the server's rules: GET/HEAD are reads, everything else
 * needs the `write` scope.
 */

describe("playground token policy", () => {
  test("GET and HEAD do not require a write scope", () => {
    expect(playgroundNeedsWriteScope("GET")).toBe(false);
    expect(playgroundNeedsWriteScope("HEAD")).toBe(false);
    expect(playgroundScopeAllows(["read"], "GET")).toBe(true);
    expect(playgroundScopeAllows([], "HEAD")).toBe(true);
  });

  test("a read-only token cannot perform a write", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(playgroundNeedsWriteScope(method)).toBe(true);
      expect(playgroundScopeAllows(["read"], method)).toBe(false);
      expect(playgroundScopeAllows([], method)).toBe(false);
    }
  });

  test("a write-scoped token may perform a write", () => {
    expect(playgroundScopeAllows(["read", "write"], "POST")).toBe(true);
    expect(playgroundScopeAllows(["write"], "DELETE")).toBe(true);
  });

  test("only the documented methods reach the proxy", () => {
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]) {
      expect(isPlaygroundMethod(method)).toBe(true);
    }
    for (const method of ["OPTIONS", "TRACE", "CONNECT", ""]) {
      expect(isPlaygroundMethod(method)).toBe(false);
    }
  });
});
