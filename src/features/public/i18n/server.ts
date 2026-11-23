import "server-only";

import { eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { cache } from "react";

import { db } from "@/db";
import { workspaceBranding } from "@/db/schema/branding";
import { workspaces } from "@/db/schema/workspaces";
import { toPlanId, hasFeature } from "@/features/entitlements/plans";
import {
  isBrandColor,
  isPublicLocale,
  isPublicTheme,
  type PublicLocaleChoice,
  type PublicTheme,
} from "@/features/branding/schema";

import {
  PUBLIC_LOCALE_COOKIE,
  createTranslator,
  resolvePublicLocale,
  type PublicLocaleCode,
  type Translate,
  type TranslateCount,
} from ".";

/**
 * Everything the public layout needs for one workspace.
 *
 * Branding is workspace-wide; the locale combines the visitor's cookie, the
 * workspace default and `Accept-Language`. `cache` keeps this to one query and
 * one read of the request headers per render even though the layout, header
 * and page body all ask for it.
 */

export type PublicSite = {
  workspaceSlug: string;
  workspaceName: string;
  brandName: string;
  logoUrl: string | null;
  primaryColor: string;
  theme: PublicTheme;
  hideAttribution: boolean;
  contentTranslationEnabled: boolean;
  configuredLocale: PublicLocaleChoice;
  locale: PublicLocaleCode;
  t: Translate;
  tc: TranslateCount;
};

const DEFAULT_LOCALE: PublicLocaleChoice = "auto";
const DEFAULT_THEME: PublicTheme = "light";

export const getPublicSite = cache(async (workspaceSlug: string): Promise<PublicSite> => {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);

  const rows = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      brandName: workspaceBranding.brandName,
      logoKey: workspaceBranding.logoKey,
      primaryColor: workspaceBranding.primaryColor,
      theme: workspaceBranding.theme,
      locale: workspaceBranding.locale,
      hideAttribution: workspaceBranding.hideAttribution,
      contentTranslationEnabled: workspaceBranding.contentTranslationEnabled,
      plan: workspaces.plan,
      updatedAt: workspaceBranding.updatedAt,
    })
    .from(workspaces)
    .leftJoin(workspaceBranding, eq(workspaceBranding.workspaceId, workspaces.id))
    .where(eq(workspaces.slug, workspaceSlug))
    .limit(1);

  const row = rows[0];
  const configuredLocale = isPublicLocale(row?.locale) ? row.locale : DEFAULT_LOCALE;
  const theme = isPublicTheme(row?.theme) ? row.theme : DEFAULT_THEME;

  const locale = resolvePublicLocale({
    configured: configuredLocale,
    cookie: cookieStore.get(PUBLIC_LOCALE_COOKIE)?.value,
    acceptLanguage: headerStore.get("accept-language"),
    explicit: headerStore.get("x-herald-locale"),
  });

  const plan = toPlanId(row?.plan);
  // A downgrade must not leave paid branding on the public surface. Saving is
  // already gated, but the stored row keeps its old values, so gate reads too.
  const customBranding = hasFeature(plan, "customBranding");
  const brandName = customBranding
    ? row?.brandName?.trim() || row?.name || workspaceSlug
    : row?.name || workspaceSlug;
  const primaryColor =
    customBranding && row?.primaryColor && isBrandColor(row.primaryColor)
      ? row.primaryColor
      : "";
  const version = row?.updatedAt ? row.updatedAt.getTime() : 0;
  const hideAttribution =
    Boolean(row?.hideAttribution) && hasFeature(plan, "hideAttribution");

  return {
    workspaceSlug,
    workspaceName: row?.name ?? workspaceSlug,
    brandName,
    logoUrl: customBranding && row?.logoKey
      ? `/api/public/workspaces/${encodeURIComponent(workspaceSlug)}/logo?v=${version}`
      : null,
    primaryColor,
    theme,
    hideAttribution,
    contentTranslationEnabled: Boolean(row?.contentTranslationEnabled),
    configuredLocale,
    locale,
    ...createTranslator(locale),
  };
});
