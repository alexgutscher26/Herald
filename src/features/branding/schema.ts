/**
 * Branding vocabulary.
 *
 * Pure so the settings form, the server action and public-page resolution all
 * validate the same values. A colour is accepted only as six-digit hex; CSS
 * functions, named colours and gradients are rejected before they reach a
 * style attribute.
 */

export const PUBLIC_THEMES = ["light", "dark", "auto"] as const;
export type PublicTheme = (typeof PUBLIC_THEMES)[number];

export const PUBLIC_LOCALE_CHOICES = ["auto", "en", "es"] as const;
export type PublicLocaleChoice = (typeof PUBLIC_LOCALE_CHOICES)[number];

export const PUBLIC_LOCALES = ["en", "es"] as const;
export type PublicLocaleCode = (typeof PUBLIC_LOCALES)[number];

export const PUBLIC_THEME_LABELS: Record<PublicTheme, string> = {
  light: "Light",
  dark: "Dark",
  auto: "Follow system",
};

export const PUBLIC_LOCALE_LABELS: Record<PublicLocaleChoice, string> = {
  auto: "Detect from the visitor's browser",
  en: "English",
  es: "Español",
};

export const BRAND_COLOR_PATTERN = /^#[0-9a-f]{6}$/;
export const BRAND_NAME_MAX = 60;
export const MAX_LOGO_BYTES = 512 * 1024;
export const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

export function isBrandColor(value: string): boolean {
  return BRAND_COLOR_PATTERN.test(value);
}

export function isPublicTheme(value: unknown): value is PublicTheme {
  return typeof value === "string" && (PUBLIC_THEMES as readonly string[]).includes(value);
}

export function isPublicLocale(value: unknown): value is PublicLocaleChoice {
  return (
    typeof value === "string" && (PUBLIC_LOCALE_CHOICES as readonly string[]).includes(value)
  );
}

export function isPublicLocaleCode(value: unknown): value is PublicLocaleCode {
  return typeof value === "string" && (PUBLIC_LOCALES as readonly string[]).includes(value);
}

export const WCAG_AA_TEXT_CONTRAST = 4.5;

/** Public theme surfaces used to resolve a readable accent. */
export const BRAND_LIGHT_SURFACE = "#ffffff";
export const BRAND_DARK_SURFACE = "#232128";

function channelLuminance(value: number): number {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.x relative luminance for a six-digit hex colour. */
export function relativeLuminance(hex: string): number {
  if (!isBrandColor(hex)) return 0;
  const red = Number.parseInt(hex.slice(1, 3), 16);
  const green = Number.parseInt(hex.slice(3, 5), 16);
  const blue = Number.parseInt(hex.slice(5, 7), 16);
  return (
    0.2126 * channelLuminance(red) +
    0.7152 * channelLuminance(green) +
    0.0722 * channelLuminance(blue)
  );
}

/** WCAG contrast ratio between two six-digit hex colours. */
export function contrastRatio(first: string, second: string): number {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

function mix(hex: string, target: string, amount: number): string {
  const mixChannel = (offset: number) =>
    Math.round(
      Number.parseInt(hex.slice(offset, offset + 2), 16) * (1 - amount) +
        Number.parseInt(target.slice(offset, offset + 2), 16) * amount,
    );
  return `#${[1, 3, 5]
    .map((offset) => mixChannel(offset).toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * A colour that reaches 4.5:1 as text on a surface.
 *
 * A workspace may choose any hex, including a pale yellow that is unreadable as
 * link text on white. The original fill is still used where it is a background;
 * this derived shade is used for text, links and rings on the matching theme.
 */
export function accessibleOn(hex: string, surface: string): string {
  if (!isBrandColor(hex) || !isBrandColor(surface)) return hex;
  if (contrastRatio(hex, surface) >= WCAG_AA_TEXT_CONTRAST) return hex;

  const target = relativeLuminance(surface) > 0.5 ? "#000000" : "#ffffff";
  for (let step = 1; step <= 20; step += 1) {
    const candidate = mix(hex, target, step / 20);
    if (contrastRatio(candidate, surface) >= WCAG_AA_TEXT_CONTRAST) return candidate;
  }
  return target;
}

export type AccessibleAccent = {
  onLight: string;
  onDark: string;
  foregroundOnLight: string;
  foregroundOnDark: string;
};

/** Theme-specific accent shades and their readable foreground colours. */
export function accessibleAccent(hex: string): AccessibleAccent {
  const onLight = accessibleOn(hex, BRAND_LIGHT_SURFACE);
  const onDark = accessibleOn(hex, BRAND_DARK_SURFACE);
  return {
    onLight,
    onDark,
    foregroundOnLight: foregroundFor(onLight),
    foregroundOnDark: foregroundFor(onDark),
  };
}

/** The raw colour's contrast on each public surface, for settings feedback. */
export function accentContrast(hex: string): { light: number; dark: number } {
  return {
    light: contrastRatio(hex, BRAND_LIGHT_SURFACE),
    dark: contrastRatio(hex, BRAND_DARK_SURFACE),
  };
}

/**
 * Black or white text for a brand background.
 *
 * Picks whichever option has the higher WCAG contrast ratio. One of the two
 * always exceeds 4.5:1, including at the crossover point around mid grey.
 */
export function foregroundFor(hex: string): string {
  if (!isBrandColor(hex)) return "#ffffff";
  // Prefer the softer ink when it already clears 4.5:1; pure black is the
  // fallback around mid tones, where the softer ink would miss the target.
  const ink =
    contrastRatio(hex, "#111111") >= WCAG_AA_TEXT_CONTRAST ? "#111111" : "#000000";
  return contrastRatio(hex, ink) >= contrastRatio(hex, "#ffffff") ? ink : "#ffffff";
}
