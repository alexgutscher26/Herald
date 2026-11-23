import { describe, expect, test } from "bun:test";

import {
  BRAND_DARK_SURFACE,
  BRAND_LIGHT_SURFACE,
  WCAG_AA_TEXT_CONTRAST,
  accentContrast,
  accessibleAccent,
  accessibleOn,
  contrastRatio,
  foregroundFor,
  relativeLuminance,
} from "@/features/branding/schema";

/**
 * A workspace can choose any six-digit hex. These checks prove the public
 * theme derives readable text on both surfaces instead of trusting that input.
 */

const COLORS = [
  "#ffffff",
  "#000000",
  "#ffff00",
  "#fefefe",
  "#777777",
  "#4f46e5",
  "#1f6b45",
  "#12ff00",
  "#ff00ff",
  "#123456",
];

describe("WCAG contrast helpers", () => {
  test("matches known luminance and contrast values", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 2);
  });

  test("white or black text always clears 4.5:1 on the chosen fill", () => {
    for (const color of COLORS) {
      expect(
        contrastRatio(color, foregroundFor(color)),
        `${color} with ${foregroundFor(color)}`,
      ).toBeGreaterThanOrEqual(WCAG_AA_TEXT_CONTRAST);
    }
  });

  test("every arbitrary accent derives a readable text shade per theme", () => {
    for (const color of COLORS) {
      const accent = accessibleAccent(color);
      expect(
        contrastRatio(accent.onLight, BRAND_LIGHT_SURFACE),
        `${color} light shade ${accent.onLight}`,
      ).toBeGreaterThanOrEqual(WCAG_AA_TEXT_CONTRAST);
      expect(
        contrastRatio(accent.onDark, BRAND_DARK_SURFACE),
        `${color} dark shade ${accent.onDark}`,
      ).toBeGreaterThanOrEqual(WCAG_AA_TEXT_CONTRAST);
      expect(
        contrastRatio(accent.onLight, accent.foregroundOnLight),
        `${color} light foreground`,
      ).toBeGreaterThanOrEqual(WCAG_AA_TEXT_CONTRAST);
      expect(
        contrastRatio(accent.onDark, accent.foregroundOnDark),
        `${color} dark foreground`,
      ).toBeGreaterThanOrEqual(WCAG_AA_TEXT_CONTRAST);
    }
  });

  test("keeps an already accessible accent unchanged", () => {
    expect(accessibleOn("#1f6b45", BRAND_LIGHT_SURFACE)).toBe("#1f6b45");
    expect(accentContrast("#1f6b45").light).toBeGreaterThanOrEqual(4.5);
  });

  test("rejects malformed values instead of emitting unsafe CSS", () => {
    expect(accessibleOn("not-a-colour", BRAND_LIGHT_SURFACE)).toBe("not-a-colour");
    expect(foregroundFor("not-a-colour")).toBe("#ffffff");
  });
});
