import { describe, expect, test } from "bun:test";

import { isSandboxMode } from "@/lib/sandbox";

describe("sandbox mode", () => {
  test("is off unless explicitly enabled", () => {
    expect(isSandboxMode({})).toBe(false);
    expect(isSandboxMode({ SANDBOX_MODE: "" })).toBe(false);
    expect(isSandboxMode({ SANDBOX_MODE: "maybe" })).toBe(false);
  });

  test("accepts the usual on/off spellings", () => {
    for (const value of ["1", "true", "on", "yes", "enabled"]) {
      expect(isSandboxMode({ SANDBOX_MODE: value })).toBe(true);
    }
    for (const value of ["0", "false", "off", "no", "disabled"]) {
      expect(isSandboxMode({ SANDBOX_MODE: value })).toBe(false);
    }
  });
});
