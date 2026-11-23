/**
 * Stored content translations.
 *
 * Only operator-authored surfaces (help articles and outbound messages) have
 * translations. Customer-written text — requests, comments, survey answers and
 * support messages — is deliberately absent from this module and is never sent
 * to a translator or silently replaced.
 */

export const CONTENT_TRANSLATION_LOCALES = ["es"] as const;
export type ContentTranslationLocale = (typeof CONTENT_TRANSLATION_LOCALES)[number];

export const CONTENT_TRANSLATION_LOCALE_NAMES: Record<ContentTranslationLocale, string> = {
  es: "Español",
};

export type HelpTranslation = {
  title: string;
  body: string;
};

export type HelpTranslations = Partial<
  Record<ContentTranslationLocale, HelpTranslation | undefined>
>;

/** A release translation carries its own title and summary, not just the body. */
export type ReleaseTranslation = {
  title: string;
  summary: string;
  body: string;
};

export type ReleaseTranslations = Partial<
  Record<ContentTranslationLocale, ReleaseTranslation | undefined>
>;

export type OutboundTranslation = {
  title: string;
  body: string;
  ctaLabel?: string;
};

export type OutboundTranslations = Partial<
  Record<ContentTranslationLocale, OutboundTranslation | undefined>
>;

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export function normalizeHelpTranslations(input: unknown): HelpTranslations {
  const source = object(parseJson(input));
  if (!source) return {};
  const result: HelpTranslations = {};
  for (const locale of CONTENT_TRANSLATION_LOCALES) {
    const entry = object(source[locale]);
    if (!entry) continue;
    const title = text(entry.title, 200);
    const body = text(entry.body, 500_000);
    if (title && body) result[locale] = { title, body };
  }
  return result;
}

export function normalizeReleaseTranslations(input: unknown): ReleaseTranslations {
  const source = object(parseJson(input));
  if (!source) return {};
  const result: ReleaseTranslations = {};
  for (const locale of CONTENT_TRANSLATION_LOCALES) {
    const entry = object(source[locale]);
    if (!entry) continue;
    const title = text(entry.title, 120);
    const summary = text(entry.summary, 280);
    const body = text(entry.body, 200_000);
    if (title && summary && body) result[locale] = { title, summary, body };
  }
  return result;
}

export function normalizeOutboundTranslations(input: unknown): OutboundTranslations {
  const source = object(parseJson(input));
  if (!source) return {};
  const result: OutboundTranslations = {};
  for (const locale of CONTENT_TRANSLATION_LOCALES) {
    const entry = object(source[locale]);
    if (!entry) continue;
    const title = text(entry.title, 200);
    const body = text(entry.body, 4_000);
    if (!title || !body) continue;
    result[locale] = {
      title,
      body,
      ...(text(entry.ctaLabel, 80) ? { ctaLabel: text(entry.ctaLabel, 80) } : {}),
    };
  }
  return result;
}

export function translatedHelp(
  article: { title: string; body: string; translations?: unknown },
  locale: string | null | undefined,
  enabled: boolean,
): { title: string; body: string } {
  if (!enabled || locale === "en" || !locale) {
    return { title: article.title, body: article.body };
  }
  const translation = normalizeHelpTranslations(article.translations)[
    locale as ContentTranslationLocale
  ];
  return translation
    ? { title: translation.title, body: translation.body }
    : { title: article.title, body: article.body };
}

export function translatedRelease(
  release: {
    title: string;
    summary: string;
    body?: string;
    translations?: unknown;
  },
  locale: string | null | undefined,
  enabled: boolean,
): { title: string; summary: string; body: string } {
  if (!enabled || locale === "en" || !locale) {
    return { title: release.title, summary: release.summary, body: release.body ?? "" };
  }
  const translation = normalizeReleaseTranslations(release.translations)[
    locale as ContentTranslationLocale
  ];
  return translation
    ? { title: translation.title, summary: translation.summary, body: translation.body }
    : { title: release.title, summary: release.summary, body: release.body ?? "" };
}

export function translatedOutbound(
  message: {
    title: string;
    body: string;
    ctaLabel?: string | null;
    translations?: unknown;
  },
  locale: string | null | undefined,
  enabled: boolean,
): { title: string; body: string; ctaLabel: string | null } {
  if (!enabled || locale === "en" || !locale) {
    return {
      title: message.title,
      body: message.body,
      ctaLabel: message.ctaLabel ?? null,
    };
  }
  const translation = normalizeOutboundTranslations(message.translations)[
    locale as ContentTranslationLocale
  ];
  return translation
    ? {
        title: translation.title,
        body: translation.body,
        ctaLabel: translation.ctaLabel ?? message.ctaLabel ?? null,
      }
    : {
        title: message.title,
        body: message.body,
        ctaLabel: message.ctaLabel ?? null,
      };
}
