import {
  PUBLIC_LOCALES,
  isPublicLocale,
  isPublicLocaleCode,
  type PublicLocaleChoice,
  type PublicLocaleCode,
} from "@/features/branding/schema";

import {
  PUBLIC_LOCALE_COOKIE,
  PUBLIC_LOCALE_COOKIE_MAX_AGE,
} from "../locale-cookie";
import { en, type PublicMessageKey } from "./messages/en";
import { es } from "./messages/es";

/**
 * Public-surface localization.
 *
 * Locale precedence is: an explicit visitor choice (cookie), then the
 * workspace setting, then the browser's `Accept-Language`, then English. The
 * workspace default may be `auto`, which is what makes browser detection
 * observable; a fixed workspace locale still leaves the visitor a switch.
 */

export { PUBLIC_LOCALE_COOKIE, PUBLIC_LOCALE_COOKIE_MAX_AGE };

export const MESSAGES: Record<PublicLocaleCode, Record<PublicMessageKey, string>> = {
  en,
  es,
};

export const PUBLIC_LOCALE_NAMES: Record<PublicLocaleCode, string> = {
  en: en["header.english"],
  es: en["header.spanish"],
};

/**
 * Nav label for each portal section.
 *
 * The header, the portal home and the search page render the same sections, so
 * one map keeps their labels translated together instead of hardcoded English.
 */
export const PUBLIC_SECTION_LABEL_KEYS = {
  help: "nav.help",
  feedback: "nav.feedback",
  roadmap: "roadmap.nav",
  updates: "updates.nav",
  api: "nav.api",
} as const satisfies Record<
  "help" | "feedback" | "roadmap" | "updates" | "api",
  PublicMessageKey
>;

/** Writing direction per shipped locale. Only LTR ships today. */
export const PUBLIC_LOCALE_DIRECTIONS: Record<PublicLocaleCode, "ltr" | "rtl"> = {
  en: "ltr",
  es: "ltr",
};

export type Translate = (
  key: PublicMessageKey,
  vars?: Record<string, string | number>,
) => string;

export type TranslateCount = (
  one: PublicMessageKey,
  other: PublicMessageKey,
  count: number,
  vars?: Record<string, string | number>,
) => string;

export function isLocaleCode(value: unknown): value is PublicLocaleCode {
  return isPublicLocaleCode(value);
}

/** Pick the highest-priority supported language from an `Accept-Language` header. */
export function detectLocale(header: string | null): PublicLocaleCode {
  if (!header) return "en";

  const entries = header
    .split(",")
    .map((part) => {
      const [tag = "", ...parameters] = part.trim().split(";");
      const quality = parameters
        .map((parameter) => parameter.trim())
        .find((parameter) => parameter.startsWith("q="))
        ?.slice(2);

      const q = quality === undefined ? 1 : Number.parseFloat(quality);
      return { tag: tag.trim().toLowerCase(), q: Number.isFinite(q) ? q : 0 };
    })
    .filter((entry) => entry.tag !== "" && entry.tag !== "*" && entry.q > 0)
    .sort((left, right) => right.q - left.q);

  for (const entry of entries) {
    const base = entry.tag.split("-")[0] ?? "";
    if (isPublicLocaleCode(base)) return base;
  }

  return "en";
}

export function resolvePublicLocale(input: {
  configured: PublicLocaleChoice;
  cookie: string | null | undefined;
  acceptLanguage: string | null;
  /** An explicit `?lang=` alternate URL wins over the stored choice. */
  explicit?: string | null;
}): PublicLocaleCode {
  if (isPublicLocaleCode(input.explicit)) return input.explicit;
  if (isPublicLocaleCode(input.cookie)) return input.cookie;
  if (isPublicLocale(input.configured) && input.configured !== "auto") {
    return input.configured;
  }
  return detectLocale(input.acceptLanguage);
}

export function formatPublicNumber(locale: PublicLocaleCode, value: number): string {
  return new Intl.NumberFormat(locale).format(value);
}

function interpolate(
  locale: PublicLocaleCode,
  template: string,
  vars?: Record<string, string | number>,
): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = vars[key];
    if (value === undefined) return match;
    return typeof value === "number" ? formatPublicNumber(locale, value) : value;
  });
}

/**
 * A small ICU subset: `{count, plural, one {# item} other {# items}}`.
 * It covers the public catalogue's one/other needs without a runtime
 * dependency and uses `Intl.PluralRules`, so a future locale with `few` or
 * `many` categories needs no second code path.
 */
export function formatPublicMessage(
  locale: PublicLocaleCode,
  template: string,
  vars?: Record<string, string | number>,
): string {
  let result = template;
  const plural = /\{(\w+),\s*plural,\s*/;

  for (let guard = 0; guard < 20; guard += 1) {
    const match = plural.exec(result);
    if (!match || match.index === undefined) break;

    const start = match.index;
    let depth = 1;
    let end = start + match[0].length;
    while (end < result.length && depth > 0) {
      if (result[end] === "{") depth += 1;
      else if (result[end] === "}") depth -= 1;
      end += 1;
    }
    if (depth !== 0) break;

    const body = result.slice(start + match[0].length, end - 1);
    const options = parsePluralOptions(body);
    const value = Number(vars?.[match[1] ?? ""] ?? 0);
    const count = Number.isFinite(value) ? value : 0;
    const category = new Intl.PluralRules(locale).select(count);
    const chosen = options[`=${count}`] ?? options[category] ?? options.other ?? "";
    const replacement = chosen.replace(/#/g, formatPublicNumber(locale, count));
    result = result.slice(0, start) + replacement + result.slice(end);
  }

  return interpolate(locale, result, vars);
}

function parsePluralOptions(body: string): Record<string, string> {
  const options: Record<string, string> = {};
  let index = 0;

  while (index < body.length) {
    while (index < body.length && /\s/.test(body[index] ?? "")) index += 1;
    const keyStart = index;
    while (index < body.length && !/[\s{]/.test(body[index] ?? "")) index += 1;
    const key = body.slice(keyStart, index);
    while (index < body.length && /\s/.test(body[index] ?? "")) index += 1;
    if (!key || body[index] !== "{") break;

    let depth = 1;
    const valueStart = index + 1;
    index += 1;
    while (index < body.length && depth > 0) {
      if (body[index] === "{") depth += 1;
      else if (body[index] === "}") depth -= 1;
      index += 1;
    }
    options[key] = body.slice(valueStart, index - 1);
  }

  return options;
}

export function createTranslator(locale: PublicLocaleCode): {
  t: Translate;
  tc: TranslateCount;
} {
  const messages = MESSAGES[locale] ?? en;

  const t: Translate = (key, vars) =>
    formatPublicMessage(locale, messages[key] ?? en[key] ?? key, vars);

  const tc: TranslateCount = (one, other, count, vars) =>
    t(count === 1 ? one : other, { ...vars, count });

  return { t, tc };
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/** Only a path inside the public site is a valid language-switch return. */
export function safePublicNext(value: string | null | undefined): string {
  if (!value || value.length > 1024) return "/";
  if (CONTROL_CHARACTERS.test(value)) return "/";
  if (!value.startsWith("/p")) return "/";
  if (value.startsWith("//") || value.startsWith("/\\")) return "/";
  if (value.includes("\\")) return "/";

  return value;
}

export function localeSwitchPath(locale: PublicLocaleCode, next: string): string {
  const query = new URLSearchParams({ locale, next: safePublicNext(next) });
  return `/api/public/locale?${query.toString()}`;
}

/** Locale-aware short date used on board and request pages. */
export function formatPublicDate(locale: PublicLocaleCode, value: string | Date): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

export { PUBLIC_LOCALES, type PublicMessageKey, type PublicLocaleChoice, type PublicLocaleCode };
