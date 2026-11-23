"use client";

import { useEffect } from "react";

import { PUBLIC_LOCALE_DIRECTIONS, type PublicLocaleCode } from "./i18n";

/**
 * Declares the visitor's language on `<html>`.
 *
 * The root layout is shared with the dashboard and statically rendered, so it
 * cannot read the public locale cookie; a public page in Spanish would otherwise
 * still tell screen readers and browsers that the document is English.
 */
export function PublicDocumentLanguage({ locale }: { locale: PublicLocaleCode }) {
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = PUBLIC_LOCALE_DIRECTIONS[locale];
  }, [locale]);

  return null;
}
