"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import { createTranslator, type PublicLocaleCode, type Translate, type TranslateCount } from ".";

/**
 * Locale context for client components.
 *
 * Server-rendered pages call the translator directly; client islands receive
 * the active locale and its messages from the public layout through this
 * provider. Only the active catalogue crosses into the browser bundle.
 */

type I18nValue = {
  locale: PublicLocaleCode;
  t: Translate;
  tc: TranslateCount;
};

const PublicI18nContext = createContext<I18nValue | null>(null);

export function PublicI18nProvider({
  locale,
  children,
}: {
  locale: PublicLocaleCode;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ locale, ...createTranslator(locale) }), [locale]);

  return <PublicI18nContext.Provider value={value}>{children}</PublicI18nContext.Provider>;
}

export function usePublicI18n(): I18nValue {
  const value = useContext(PublicI18nContext);
  if (!value) {
    throw new Error("usePublicI18n must be used inside the public layout.");
  }
  return value;
}

/**
 * Shared client islands (consent, embeds) also render on marketing pages,
 * outside the public workspace. They fall back to their English copy instead
 * of throwing when no public provider is present.
 */
export function useOptionalPublicI18n(): I18nValue | null {
  return useContext(PublicI18nContext);
}
