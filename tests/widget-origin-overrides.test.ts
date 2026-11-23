import { describe, expect, test } from "bun:test";

import {
  normalizeWidgetOriginOverrides,
  parseWidgetOriginOverrides,
  resolveWidgetOriginOverride,
} from "@/features/widget/policy";

const ALLOWED = ["https://app.example.test", "https://staging.example.test"];

describe("widget per-origin overrides", () => {
  test("accepts an origin from the allowlist with theme, position or both", () => {
    const result = parseWidgetOriginOverrides(
      [
        { origin: "https://app.example.test", theme: "dark" },
        {
          origin: "https://staging.example.test",
          theme: "light",
          position: "top-left",
        },
      ],
      ALLOWED,
    );

    expect(result).toEqual({
      ok: true,
      overrides: [
        { origin: "https://app.example.test", theme: "dark" },
        {
          origin: "https://staging.example.test",
          theme: "light",
          position: "top-left",
        },
      ],
    });
  });

  test("refuses an origin that is not in the allowlist", () => {
    const result = parseWidgetOriginOverrides(
      [{ origin: "https://evil.example.test", theme: "dark" }],
      ALLOWED,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("allowed origins");
  });

  test("refuses wildcards, paths and duplicate origins", () => {
    for (const origin of [
      "https://*.example.test",
      "https://app.example.test/path",
      "app.example.test",
    ]) {
      const result = parseWidgetOriginOverrides([{ origin, theme: "dark" }], [
        ...ALLOWED,
        origin,
      ]);
      expect(result.ok).toBe(false);
    }

    const duplicate = parseWidgetOriginOverrides(
      [
        { origin: "https://app.example.test", theme: "dark" },
        { origin: "https://app.example.test", position: "top-left" },
      ],
      ALLOWED,
    );
    expect(duplicate.ok).toBe(false);
  });

  test("a row with no theme or position is simply ignored", () => {
    const result = parseWidgetOriginOverrides(
      [{ origin: "https://app.example.test" }],
      ALLOWED,
    );
    expect(result).toEqual({ ok: true, overrides: [] });
  });

  test("stored values are normalized defensively", () => {
    expect(
      normalizeWidgetOriginOverrides([
        { origin: "https://app.example.test", theme: "dark" },
        { origin: "not-an-origin", theme: "dark" },
        { origin: "https://app.example.test", position: "top-right" },
        { origin: "https://staging.example.test" },
        null,
        "nope",
      ]),
    ).toEqual([{ origin: "https://app.example.test", theme: "dark" }]);
    expect(normalizeWidgetOriginOverrides(null)).toEqual([]);
  });

  test("resolves only the exact host origin", () => {
    const overrides = normalizeWidgetOriginOverrides([
      { origin: "https://app.example.test", theme: "dark" },
    ]);

    expect(
      resolveWidgetOriginOverride(overrides, "https://app.example.test"),
    ).toEqual({ origin: "https://app.example.test", theme: "dark" });
    expect(
      resolveWidgetOriginOverride(overrides, "https://app.example.test:8443"),
    ).toBeNull();
    expect(resolveWidgetOriginOverride(overrides, null)).toBeNull();
  });
});
