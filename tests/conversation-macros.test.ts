import { describe, expect, test } from "bun:test";

import {
  isMacroStatus,
  normalizeTagName,
} from "@/features/conversations/macro-rules";

describe("conversation macro helpers", () => {
  test("normalizes tags to a flat, case-insensitive name", () => {
    expect(normalizeTagName("  Billing   Follow-up ")).toBe("billing follow-up");
  });

  test("rejects empty and punctuation-only tags", () => {
    expect(normalizeTagName("   ")).toBeNull();
    expect(normalizeTagName("!!!")).toBeNull();
  });

  test("caps long tags at 32 characters", () => {
    expect(normalizeTagName("a".repeat(50))).toHaveLength(32);
  });

  test("only the metadata statuses a macro may set are valid", () => {
    expect(isMacroStatus("resolved")).toBe(true);
    expect(isMacroStatus("archived")).toBe(true);
    expect(isMacroStatus("snoozed")).toBe(false);
    expect(isMacroStatus("queue")).toBe(false);
  });
});
