import { headers } from "next/headers";
import type { CSSProperties, ReactNode } from "react";

import { RouteFocusManager } from "@/components/layout/route-focus";

import { accessibleAccent } from "@/features/branding/schema";
import { ConsentBanner } from "@/features/consent/consent-banner";
import { getConsentState } from "@/features/consent/server";
import { DemoBanner } from "@/features/public/demo-banner";
import {
  PUBLIC_LOCALE_DIRECTIONS,
  PUBLIC_LOCALES,
} from "@/features/public/i18n";
import { PublicI18nProvider } from "@/features/public/i18n/provider";
import { getPublicSite } from "@/features/public/i18n/server";
import { absolutePublicUrl } from "@/features/public/urls";

/**
 * Public workspace shell.
 *
 * The theme is a class because `auto` needs a media query, and the accent
 * colour is passed as CSS variables after being validated as six-digit hex.
 * `lang` sits on this wrapper rather than `<html>` because a single deployment
 * serves workspaces with different locales.
 */
export default async function PublicWorkspaceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const [site, consent, headerStore] = await Promise.all([
    getPublicSite(workspaceSlug),
    getConsentState(),
    headers(),
  ]);
  const path = headerStore.get("x-herald-path") ?? `/p/${workspaceSlug}`;
  const alternatePath = (locale: string) =>
    `${path}${path.includes("?") ? "&" : "?"}lang=${locale}`;

  const accent = site.primaryColor ? accessibleAccent(site.primaryColor) : null;
  const style = accent
    ? ({
        "--brand-accent-light": accent.onLight,
        "--brand-accent-light-fg": accent.foregroundOnLight,
        "--brand-accent-dark": accent.onDark,
        "--brand-accent-dark-fg": accent.foregroundOnDark,
      } as CSSProperties)
    : undefined;

  return (
    <PublicI18nProvider locale={site.locale}>
      <div
        lang={site.locale}
        dir={PUBLIC_LOCALE_DIRECTIONS[site.locale]}
        className={`public-theme-${site.theme} min-h-screen bg-background text-foreground ${
          accent ? "public-brand-accent" : ""
        }`}
        style={style}
      >
        {PUBLIC_LOCALES.map((code) => (
          <link
            key={code}
            rel="alternate"
            hrefLang={code}
            href={absolutePublicUrl(alternatePath(code))}
          />
        ))}
        <link
          rel="alternate"
          hrefLang="x-default"
          href={absolutePublicUrl(path)}
        />
        <a
          href="#public-main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:border focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground"
        >
          {site.t("common.skipToContent")}
        </a>
        <RouteFocusManager mainId="public-main" />
        <DemoBanner />
        {children}
        <ConsentBanner initialRestricted={consent.restricted} />
      </div>
    </PublicI18nProvider>
  );
}
