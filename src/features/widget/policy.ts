/**
 * Widget configuration rules.
 *
 * Kept free of database and framework imports so the loader contract, settings
 * actions, embed gate and tests all share one interpretation of a valid origin
 * and a valid public key.
 */

export const WIDGET_POSITIONS = [
  "bottom-right",
  "bottom-left",
  "top-right",
  "top-left",
] as const;
export type WidgetPosition = (typeof WIDGET_POSITIONS)[number];

export const WIDGET_THEMES = ["light", "dark", "auto"] as const;
export type ConfiguredWidgetTheme = (typeof WIDGET_THEMES)[number];

export const MAX_ALLOWED_ORIGINS = 20;

/**
 * Sections an operator can add next to the changelog panel. Updates are part
 * of the widget itself, so they are not optional; notifications follow the
 * unread badge rather than the section picker.
 */
export const WIDGET_SECTIONS = ["help", "feedback", "roadmap", "messages"] as const;
export type WidgetSection = (typeof WIDGET_SECTIONS)[number];

/** Feedback and roadmap are on by default; direct messages stay opt-in. */
export const DEFAULT_WIDGET_SECTIONS: WidgetSection[] = ["feedback", "roadmap"];

/**
 * One embedding origin may look different from the product default. This is
 * deliberately limited to the launcher's position and theme: a per-origin
 * copy of every setting would make two installations impossible to compare.
 *
 * The embed route resolves the override for the `host` it was loaded with and
 * reports it to the loader, which applies it to the launcher. An explicit
 * `data-position` / `data-theme` in the snippet stays authoritative.
 */
export type WidgetOriginOverride = {
  origin: string;
  theme?: ConfiguredWidgetTheme;
  position?: WidgetPosition;
};

export type OriginParseResult =
  | { ok: true; origins: string[] }
  | { ok: false; error: string };

/**
 * Normalize an operator-provided allowlist.
 *
 * Only exact, scheme-qualified origins are accepted. Wildcards, paths, query
 * strings and credentials are rejected rather than guessed at, because a
 * partial match here would silently widen who can embed the widget.
 */
export function parseAllowedOrigins(values: readonly string[]): OriginParseResult {
  const origins: string[] = [];
  const seen = new Set<string>();

  for (const raw of values) {
    const candidate = raw.trim().replace(/\/$/, "");
    if (candidate === "") continue;

    if (candidate.length > 300) {
      return { ok: false, error: "An allowed origin is too long." };
    }
    if (candidate.includes("*")) {
      return {
        ok: false,
        error: `"${candidate}" must be one exact origin; wildcards are not supported.`,
      };
    }

    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      return {
        ok: false,
        error: `"${candidate}" is not a valid origin. Include http:// or https:// and no path.`,
      };
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return {
        ok: false,
        error: `"${candidate}" must use http or https.`,
      };
    }
    if (url.origin !== candidate.toLowerCase()) {
      return {
        ok: false,
        error: `"${candidate}" must be an origin only, without a path, query or fragment.`,
      };
    }

    if (!seen.has(url.origin)) {
      seen.add(url.origin);
      origins.push(url.origin);
    }
  }

  if (origins.length > MAX_ALLOWED_ORIGINS) {
    return {
      ok: false,
      error: `Add at most ${MAX_ALLOWED_ORIGINS} allowed origins.`,
    };
  }

  return { ok: true, origins };
}

/** An empty allowlist deliberately means "any origin". */
export function isWidgetOriginAllowed(
  allowedOrigins: readonly string[],
  hostOrigin: string | null | undefined,
): boolean {
  if (allowedOrigins.length === 0) return true;
  if (!hostOrigin) return false;
  return allowedOrigins.includes(hostOrigin);
}

export function isWidgetPosition(value: unknown): value is WidgetPosition {
  return (
    typeof value === "string" &&
    (WIDGET_POSITIONS as readonly string[]).includes(value)
  );
}

export function isWidgetTheme(value: unknown): value is ConfiguredWidgetTheme {
  return (
    typeof value === "string" &&
    (WIDGET_THEMES as readonly string[]).includes(value)
  );
}

function isOriginString(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 300 ||
    value.includes("*")
  ) {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.origin === value
    );
  } catch {
    return false;
  }
}

/**
 * Drop entries that cannot be honoured without failing the whole read. Used
 * for values already stored, so one legacy row cannot break the widget.
 */
export function normalizeWidgetOriginOverrides(
  values: unknown,
): WidgetOriginOverride[] {
  if (!Array.isArray(values)) return [];

  const overrides: WidgetOriginOverride[] = [];
  const seen = new Set<string>();

  for (const raw of values) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    if (!isOriginString(entry.origin) || seen.has(entry.origin)) continue;
    if (!isWidgetTheme(entry.theme) && !isWidgetPosition(entry.position)) {
      continue;
    }

    seen.add(entry.origin);
    overrides.push({
      origin: entry.origin,
      ...(isWidgetTheme(entry.theme) ? { theme: entry.theme } : {}),
      ...(isWidgetPosition(entry.position) ? { position: entry.position } : {}),
    });
  }

  return overrides.slice(0, MAX_ALLOWED_ORIGINS);
}

export type OriginOverridesParseResult =
  | { ok: true; overrides: WidgetOriginOverride[] }
  | { ok: false; error: string };

/** Strict parse for the settings form; an invalid row is an error, not a drop. */
export function parseWidgetOriginOverrides(
  values: readonly unknown[],
  allowedOrigins: readonly string[],
): OriginOverridesParseResult {
  if (values.length > MAX_ALLOWED_ORIGINS) {
    return {
      ok: false,
      error: `Add overrides for at most ${MAX_ALLOWED_ORIGINS} origins.`,
    };
  }

  const overrides: WidgetOriginOverride[] = [];
  const seen = new Set<string>();

  for (const raw of values) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const theme = isWidgetTheme(entry.theme) ? entry.theme : undefined;
    const position = isWidgetPosition(entry.position) ? entry.position : undefined;
    if (!theme && !position) continue;

    if (!isOriginString(entry.origin)) {
      return {
        ok: false,
        error: "A per-origin override needs an exact http(s) origin.",
      };
    }
    if (seen.has(entry.origin)) {
      return {
        ok: false,
        error: `"${entry.origin}" has more than one override.`,
      };
    }
    if (!allowedOrigins.includes(entry.origin)) {
      return {
        ok: false,
        error: `Add "${entry.origin}" to the allowed origins before overriding it.`,
      };
    }

    seen.add(entry.origin);
    overrides.push({
      origin: entry.origin,
      ...(theme ? { theme } : {}),
      ...(position ? { position } : {}),
    });
  }

  return { ok: true, overrides };
}

/** The override that applies to one host origin, if any. */
export function resolveWidgetOriginOverride(
  overrides: readonly WidgetOriginOverride[],
  hostOrigin: string | null | undefined,
): WidgetOriginOverride | null {
  if (!hostOrigin) return null;
  return overrides.find((override) => override.origin === hostOrigin) ?? null;
}

export function isWidgetSection(value: unknown): value is WidgetSection {
  return (
    typeof value === "string" &&
    (WIDGET_SECTIONS as readonly string[]).includes(value)
  );
}

/** Keep known sections once, in the order the picker and nav use. */
export function normalizeWidgetSections(
  values: readonly unknown[],
): WidgetSection[] {
  const seen = new Set(
    values.filter((value): value is WidgetSection => isWidgetSection(value)),
  );
  return WIDGET_SECTIONS.filter((section) => seen.has(section));
}

/** Public keys are URL-safe and long enough not to collide by accident. */
export function isWidgetPublicKey(value: unknown): value is string {
  return typeof value === "string" && /^hpk_[A-Za-z0-9_-]{20,120}$/.test(value);
}

export type WidgetAccessSettings = {
  publicKey: string;
  allowedOrigins: string[];
};

/**
 * Whether a request may load the configured widget.
 *
 * A workspace with no settings row is legacy/unconfigured and remains open.
 * Once a row exists, the key is mandatory; a non-empty origin allowlist also
 * requires a matching host origin.
 */
export function widgetAccessAllowed(
  settings: WidgetAccessSettings | null,
  publicKey: string | null | undefined,
  hostOrigin: string | null | undefined,
): boolean {
  if (!settings) return true;
  if (!publicKey || publicKey !== settings.publicKey) return false;
  return isWidgetOriginAllowed(settings.allowedOrigins, hostOrigin);
}
