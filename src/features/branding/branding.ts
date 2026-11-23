import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { workspaceBranding } from "@/db/schema/branding";

import {
  BRAND_NAME_MAX,
  isBrandColor,
  isPublicLocale,
  isPublicTheme,
  type PublicLocaleChoice,
  type PublicTheme,
} from "./schema";

/**
 * Workspace branding.
 *
 * A workspace that never opened the settings has no row; reads return the
 * defaults that match the columns. Saving is an upsert so the first save from
 * any admin creates it exactly once.
 */

export type BrandingSettingsView = {
  brandName: string;
  hasLogo: boolean;
  primaryColor: string;
  theme: PublicTheme;
  locale: PublicLocaleChoice;
  hideAttribution: boolean;
  contentTranslationEnabled: boolean;
  updatedAt: string | null;
};

export type WorkspaceBrandingValues = BrandingSettingsView & {
  logoKey: string | null;
};

export function defaultBranding(): WorkspaceBrandingValues {
  return {
    brandName: "",
    hasLogo: false,
    logoKey: null,
    primaryColor: "",
    theme: "light",
    locale: "auto",
    hideAttribution: false,
    contentTranslationEnabled: false,
    updatedAt: null,
  };
}

export async function getWorkspaceBranding(
  workspaceId: string,
): Promise<WorkspaceBrandingValues> {
  const rows = await db
    .select()
    .from(workspaceBranding)
    .where(eq(workspaceBranding.workspaceId, workspaceId))
    .limit(1);

  const row = rows[0];
  if (!row) return defaultBranding();

  return {
    brandName: row.brandName ?? "",
    hasLogo: row.logoKey !== null,
    logoKey: row.logoKey,
    primaryColor: row.primaryColor ?? "",
    theme: isPublicTheme(row.theme) ? row.theme : "light",
    locale: isPublicLocale(row.locale) ? row.locale : "auto",
    hideAttribution: row.hideAttribution,
    contentTranslationEnabled: row.contentTranslationEnabled,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type SaveBrandingInput = {
  workspaceId: string;
  brandName: string;
  primaryColor: string;
  theme: PublicTheme;
  locale: PublicLocaleChoice;
  hideAttribution?: boolean;
  contentTranslationEnabled?: boolean;
  logoKey?: string | null;
};

export type SaveBrandingResult =
  | { ok: true; branding: WorkspaceBrandingValues }
  | { ok: false; error: string };

export async function saveBrandingSettings(
  input: SaveBrandingInput,
): Promise<SaveBrandingResult> {
  const brandName = input.brandName.trim().slice(0, BRAND_NAME_MAX);
  const primaryColor = input.primaryColor.trim().toLowerCase();

  if (primaryColor !== "" && !isBrandColor(primaryColor)) {
    return { ok: false, error: "Choose a six-digit hex colour such as #4f46e5." };
  }
  if (!isPublicTheme(input.theme)) {
    return { ok: false, error: "Choose light, dark or automatic." };
  }
  if (!isPublicLocale(input.locale)) {
    return { ok: false, error: "Choose a supported language." };
  }

  const now = new Date();
  const values = {
    brandName: brandName === "" ? null : brandName,
    primaryColor: primaryColor === "" ? null : primaryColor,
    theme: input.theme,
    locale: input.locale,
    hideAttribution: input.hideAttribution ?? false,
    contentTranslationEnabled: input.contentTranslationEnabled ?? false,
    updatedAt: now,
    ...(input.logoKey !== undefined ? { logoKey: input.logoKey } : {}),
  };

  await db
    .insert(workspaceBranding)
    .values({ workspaceId: input.workspaceId, ...values })
    .onConflictDoUpdate({
      target: workspaceBranding.workspaceId,
      set: values,
    });

  const branding = await getWorkspaceBranding(input.workspaceId);
  return { ok: true, branding };
}
