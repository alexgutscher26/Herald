"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { checkWorkspaceFeature } from "@/features/entitlements/entitlements";
import { limitFailure } from "@/features/billing/links";
import { authorizeProductAction } from "@/features/live/action-auth";
import type { ActionResult } from "@/features/live/action-result";

import {
  completeIdentitySecretRotation,
  rotateIdentitySecret,
  saveIdentitySettings,
  type IdentitySettingsView,
} from "./identity-settings";

/**
 * SSO settings actions.
 *
 * Both actions require `settings:manage`. The secret is returned once, in the
 * action result, and never read back from the database for display.
 */

const saveSchema = z.object({
  workspaceSlug: z.string().min(1),
  productSlug: z.string().min(1),
  enabled: z.boolean(),
  issuer: z.string().trim().min(1, "Enter the issuer claim.").max(120),
  audience: z.string().trim().min(1, "Enter the audience claim.").max(120),
  requireSignedTokens: z.boolean(),
});

export async function saveSsoSettingsAction(input: {
  workspaceSlug: string;
  productSlug: string;
  enabled: boolean;
  issuer: string;
  audience: string;
  requireSignedTokens: boolean;
}): Promise<ActionResult<{ settings: IdentitySettingsView; generatedSecret: string | null }>> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Check the single sign-on details.",
    };
  }

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "settings:manage",
  );
  if ("error" in authorized) return authorized.error;

  if (parsed.data.enabled) {
    const feature = await checkWorkspaceFeature(authorized.context.workspace.id, "sso");
    if (!feature.allowed) {
      return limitFailure(
        "Single sign-on is available on the Professional plan.",
        parsed.data.workspaceSlug,
      );
    }
  }

  try {
    const result = await saveIdentitySettings({
      workspaceId: authorized.context.workspace.id,
      enabled: parsed.data.enabled,
      issuer: parsed.data.issuer,
      audience: parsed.data.audience,
      requireSignedTokens: parsed.data.requireSignedTokens,
    });

    revalidatePath(
      `/app/${parsed.data.workspaceSlug}/${parsed.data.productSlug}/settings`,
    );
    return {
      ok: true,
      data: {
        settings: result.settings,
        generatedSecret: result.generatedSecret,
      },
    };
  } catch (error) {
    console.error("[customer-auth] save sso settings failed", error);
    return { ok: false, error: "Could not save single sign-on settings." };
  }
}

export async function rotateSsoSecretAction(input: {
  workspaceSlug: string;
  productSlug: string;
}): Promise<ActionResult<{ secret: string }>> {
  const parsed = z
    .object({
      workspaceSlug: z.string().min(1),
      productSlug: z.string().min(1),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the workspace and product." };
  }

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "settings:manage",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const secret = await rotateIdentitySecret(authorized.context.workspace.id);
    revalidatePath(
      `/app/${parsed.data.workspaceSlug}/${parsed.data.productSlug}/settings`,
    );
    return { ok: true, data: { secret } };
  } catch (error) {
    console.error("[customer-auth] rotate sso secret failed", error);
    return { ok: false, error: "Could not rotate the signing secret." };
  }
}

/** End the rotation overlap before its deadline. */
export async function completeSsoSecretRotationAction(input: {
  workspaceSlug: string;
  productSlug: string;
}): Promise<ActionResult<{ completed: true }>> {
  const parsed = z
    .object({
      workspaceSlug: z.string().min(1),
      productSlug: z.string().min(1),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the workspace and product." };
  }

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "settings:manage",
  );
  if ("error" in authorized) return authorized.error;

  try {
    await completeIdentitySecretRotation(authorized.context.workspace.id);
    revalidatePath(
      `/app/${parsed.data.workspaceSlug}/${parsed.data.productSlug}/settings`,
    );
    return { ok: true, data: { completed: true } };
  } catch (error) {
    console.error("[customer-auth] complete sso rotation failed", error);
    return { ok: false, error: "Could not finish the rotation." };
  }
}
