"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { checkWorkspaceFeature } from "@/features/entitlements/entitlements";
import { limitFailure } from "@/features/billing/links";
import { authorizeProductAction } from "@/features/live/action-auth";
import type { ActionResult } from "@/features/live/action-result";
import { getStorage } from "@/features/storage";
import { storeUpload } from "@/features/storage/upload";

import {
  getWorkspaceBranding,
  saveBrandingSettings,
  type BrandingSettingsView,
} from "./branding";
import {
  BRAND_COLOR_PATTERN,
  BRAND_NAME_MAX,
  LOGO_TYPES,
  MAX_LOGO_BYTES,
  PUBLIC_LOCALE_CHOICES,
  PUBLIC_THEMES,
} from "./schema";

/**
 * Save public branding.
 *
 * The logo is an optional `File` in the same action so the form is one
 * transaction from the operator's point of view. It is validated by the shared
 * upload rules (magic bytes, size) before the database points at it; a failed
 * upload leaves the previous logo in place.
 */

const schema = z.object({
  workspaceSlug: z.string().min(1),
  productSlug: z.string().min(1),
  brandName: z.string().trim().max(BRAND_NAME_MAX).default(""),
  primaryColor: z
    .string()
    .trim()
    .default("")
    .refine((value) => value === "" || BRAND_COLOR_PATTERN.test(value.toLowerCase()), {
      message: "Choose a six-digit hex colour such as #4f46e5.",
    }),
  theme: z.enum(PUBLIC_THEMES),
  locale: z.enum(PUBLIC_LOCALE_CHOICES),
  hideAttribution: z.boolean().default(false),
  removeLogo: z.boolean().default(false),
});

export type SaveBrandingInput = {
  workspaceSlug: string;
  productSlug: string;
  brandName: string;
  primaryColor: string;
  theme: (typeof PUBLIC_THEMES)[number];
  locale: (typeof PUBLIC_LOCALE_CHOICES)[number];
  hideAttribution: boolean;
  removeLogo: boolean;
  logo: File | null;
};

export async function saveBrandingAction(
  input: SaveBrandingInput,
): Promise<ActionResult<{ branding: BrandingSettingsView }>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Check the branding details.",
    };
  }

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "settings:manage",
  );
  if ("error" in authorized) return authorized.error;

  const { context } = authorized;
  const customBrand = parsed.data.brandName.trim().length > 0 || parsed.data.primaryColor.trim().length > 0;
  if (customBrand || input.logo) {
    const feature = await checkWorkspaceFeature(context.workspace.id, "customBranding");
    if (!feature.allowed) {
      return limitFailure(
        "Custom names, colours and logos are available on Indie and Professional.",
        parsed.data.workspaceSlug,
      );
    }
  }

  if (parsed.data.hideAttribution) {
    const feature = await checkWorkspaceFeature(context.workspace.id, "hideAttribution");
    if (!feature.allowed) {
      return {
        ok: false,
        error: "Hiding the Herald attribution is available on Indie and Professional.",
        billingUrl: `/app/${encodeURIComponent(parsed.data.workspaceSlug)}/settings#billing`,
      };
    }
  }

  const current = await getWorkspaceBranding(context.workspace.id);

  let logoKey: string | null | undefined;
  const file = input.logo;

  if (file) {
    if (file.size === 0) return { ok: false, error: "The logo file is empty." };
    if (file.size > MAX_LOGO_BYTES) {
      return {
        ok: false,
        error: `Choose a logo under ${Math.round(MAX_LOGO_BYTES / 1024)} KB.`,
      };
    }
    if (!(LOGO_TYPES as readonly string[]).includes(file.type)) {
      return { ok: false, error: "Use a PNG, JPEG, WebP or GIF logo." };
    }

    const uploaded = await storeUpload({
      workspaceId: context.workspace.id,
      productId: context.product.id,
      kind: "image",
      fileName: file.name || "logo",
      mimeType: file.type,
      body: new Uint8Array(await file.arrayBuffer()),
    });

    if (!uploaded.ok) return { ok: false, error: uploaded.error };
    logoKey = uploaded.object.key;
  } else if (parsed.data.removeLogo) {
    logoKey = null;
  }

  const saved = await saveBrandingSettings({
    workspaceId: context.workspace.id,
    brandName: parsed.data.brandName,
    primaryColor: parsed.data.primaryColor,
    theme: parsed.data.theme,
    locale: parsed.data.locale,
    hideAttribution: parsed.data.hideAttribution,
    contentTranslationEnabled: current.contentTranslationEnabled,
    ...(logoKey !== undefined ? { logoKey } : {}),
  });

  if (!saved.ok) return { ok: false, error: saved.error };

  // Remove the replaced object only after the database commits. A failed
  // delete leaves an orphan, which is safer than a page pointing at nothing.
  if (logoKey !== undefined && current.logoKey && current.logoKey !== logoKey) {
    try {
      await getStorage().delete(current.logoKey);
    } catch (error) {
      console.error("[branding] old logo delete failed", error);
    }
  }

  revalidatePath(`/app/${parsed.data.workspaceSlug}/${parsed.data.productSlug}/settings`);
  revalidatePath("/p", "layout");

  const { hasLogo, ...branding } = saved.branding;
  return {
    ok: true,
    data: {
      branding: {
        ...branding,
        hasLogo,
      },
    },
  };
}
