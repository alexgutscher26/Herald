import { describe, expect, test } from "bun:test";

import {
  MAX_ALLOWED_ORIGINS,
  isWidgetOriginAllowed,
  isWidgetPosition,
  isWidgetPublicKey,
  isWidgetTheme,
  parseAllowedOrigins,
  widgetAccessAllowed,
} from "@/features/widget/policy";

describe("widget origin policy", () => {
  test("normalizes exact origins and removes duplicates", () => {
    expect(
      parseAllowedOrigins([
        " https://app.example.com/ ",
        "https://app.example.com",
        "http://localhost:3000",
      ]),
    ).toEqual({
      ok: true,
      origins: ["https://app.example.com", "http://localhost:3000"],
    });
  });

  test("rejects wildcards, paths, credentials and non-http schemes", () => {
    for (const value of [
      "https://*.example.com",
      "https://app.example.com/feedback",
      "https://app.example.com?x=1",
      "https://user:pass@app.example.com",
      "ftp://app.example.com",
    ]) {
      expect(parseAllowedOrigins([value]).ok).toBe(false);
    }
  });

  test("caps the allowlist", () => {
    const origins = Array.from(
      { length: MAX_ALLOWED_ORIGINS + 1 },
      (_, index) => `https://tenant-${index}.example.com`,
    );
    expect(parseAllowedOrigins(origins).ok).toBe(false);
    expect(parseAllowedOrigins(origins.slice(0, MAX_ALLOWED_ORIGINS)).ok).toBe(
      true,
    );
  });

  test("an empty allowlist is open, but a configured one is exact", () => {
    expect(isWidgetOriginAllowed([], "https://anywhere.example")).toBe(true);
    expect(isWidgetOriginAllowed([], null)).toBe(true);
    expect(
      isWidgetOriginAllowed(["https://app.example.com"], "https://app.example.com"),
    ).toBe(true);
    expect(
      isWidgetOriginAllowed(["https://app.example.com"], "https://evil.example.com"),
    ).toBe(false);
    expect(isWidgetOriginAllowed(["https://app.example.com"], null)).toBe(false);
  });

  test("unconfigured workspaces stay open; configured ones require the key", () => {
    expect(widgetAccessAllowed(null, null, null)).toBe(true);

    const settings = {
      publicKey: `hpk_${"a".repeat(32)}`,
      allowedOrigins: ["https://app.example.com"],
    };

    expect(widgetAccessAllowed(settings, null, "https://app.example.com")).toBe(
      false,
    );
    expect(
      widgetAccessAllowed(settings, `hpk_${"b".repeat(32)}`, "https://app.example.com"),
    ).toBe(false);
    expect(widgetAccessAllowed(settings, settings.publicKey, null)).toBe(false);
    expect(
      widgetAccessAllowed(
        settings,
        settings.publicKey,
        "https://evil.example.com",
      ),
    ).toBe(false);
    expect(
      widgetAccessAllowed(settings, settings.publicKey, "https://app.example.com"),
    ).toBe(true);
  });

  test("validates keys, positions and themes", () => {
    expect(isWidgetPublicKey(`hpk_${"a".repeat(32)}`)).toBe(true);
    expect(isWidgetPublicKey("hpk_short")).toBe(false);
    expect(isWidgetPublicKey("not-a-key")).toBe(false);

    expect(isWidgetPosition("top-left")).toBe(true);
    expect(isWidgetPosition("center")).toBe(false);
    expect(isWidgetTheme("auto")).toBe(true);
    expect(isWidgetTheme("sepia")).toBe(false);
  });
});
