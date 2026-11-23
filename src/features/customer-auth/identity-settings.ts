import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { workspaceIdentitySettings } from "@/db/schema";

import {
  decryptSsoSecret,
  encryptSsoSecret,
  generateSsoSecret,
} from "./secret-crypto";

/**
 * Workspace SSO configuration.
 *
 * Settings are created lazily: a workspace that never enables SSO has no row,
 * and reads return defaults that mirror the column defaults. The signing secret
 * is only ever returned in plaintext once, when it is generated or rotated.
 *
 * Rotation keeps the outgoing secret in a second column for a grace window.
 * Tokens minted before the rotation keep verifying until the window ends, so a
 * deployment can pick up the new secret without a sign-in outage; completing
 * the rotation ends the overlap early.
 */

/** How long the outgoing secret keeps verifying after a rotation. */
export const SSO_ROTATION_GRACE_MS = 24 * 60 * 60 * 1000;

export type IdentitySettingsView = {
  enabled: boolean;
  hasSecret: boolean;
  issuer: string;
  audience: string;
  requireSignedTokens: boolean;
  maskCustomerIdentity: boolean;
  /** End of the rotation overlap, or null when no outgoing secret is active. */
  previousSecretExpiresAt: string | null;
  updatedAt: string | null;
};

export type SsoRuntimeSettings = {
  enabled: boolean;
  /** Current secret first, then the outgoing one while the overlap lasts. */
  secrets: string[];
  issuer: string;
  audience: string;
};

export function defaultIdentitySettings(workspaceSlug: string): IdentitySettingsView {
  return {
    enabled: false,
    hasSecret: false,
    issuer: "herald",
    audience: workspaceSlug,
    requireSignedTokens: true,
    maskCustomerIdentity: false,
    previousSecretExpiresAt: null,
    updatedAt: null,
  };
}

function activePreviousExpiry(row: {
  ssoSecretPreviousEncrypted: string | null;
  ssoSecretPreviousExpiresAt: Date | null;
}): Date | null {
  if (!row.ssoSecretPreviousEncrypted || !row.ssoSecretPreviousExpiresAt) {
    return null;
  }
  return row.ssoSecretPreviousExpiresAt.getTime() > Date.now()
    ? row.ssoSecretPreviousExpiresAt
    : null;
}

export async function getIdentitySettings(
  workspaceId: string,
  workspaceSlug: string,
): Promise<IdentitySettingsView> {
  const rows = await db
    .select()
    .from(workspaceIdentitySettings)
    .where(eq(workspaceIdentitySettings.workspaceId, workspaceId))
    .limit(1);

  const row = rows[0];
  if (!row) return defaultIdentitySettings(workspaceSlug);

  const previousExpiry = activePreviousExpiry(row);

  return {
    enabled: row.ssoEnabled,
    hasSecret: row.ssoSecretEncrypted !== null,
    issuer: row.ssoIssuer ?? "herald",
    audience: row.ssoAudience ?? workspaceSlug,
    requireSignedTokens: row.requireSignedTokens,
    maskCustomerIdentity: row.maskCustomerIdentity,
    previousSecretExpiresAt: previousExpiry?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Read the values the verifier needs.
 *
 * A missing row, a disabled switch or an undecryptable secret all produce an
 * unusable configuration; the caller turns that into a refusal, never a
 * fallback to an unsigned identity.
 */
export async function getSsoRuntimeSettings(
  workspaceId: string,
  workspaceSlug: string,
): Promise<SsoRuntimeSettings> {
  const rows = await db
    .select()
    .from(workspaceIdentitySettings)
    .where(eq(workspaceIdentitySettings.workspaceId, workspaceId))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return {
      enabled: false,
      secrets: [],
      issuer: "herald",
      audience: workspaceSlug,
    };
  }

  const current = row.ssoSecretEncrypted
    ? decryptSsoSecret(row.ssoSecretEncrypted)
    : null;
  const previousExpiry = activePreviousExpiry(row);
  const previous =
    previousExpiry && row.ssoSecretPreviousEncrypted
      ? decryptSsoSecret(row.ssoSecretPreviousEncrypted)
      : null;

  return {
    enabled: row.ssoEnabled,
    secrets: [current, previous].filter(
      (value): value is string => value !== null,
    ),
    issuer: row.ssoIssuer ?? "herald",
    audience: row.ssoAudience ?? workspaceSlug,
  };
}

export type SaveIdentitySettingsInput = {
  workspaceId: string;
  enabled: boolean;
  issuer: string;
  audience: string;
  requireSignedTokens: boolean;
  /** Omitted keeps the existing privacy setting. */
  maskCustomerIdentity?: boolean;
};

export type SaveIdentitySettingsResult = {
  settings: IdentitySettingsView;
  /** Present only when enabling generated the first secret. */
  generatedSecret: string | null;
};

export async function saveIdentitySettings(
  input: SaveIdentitySettingsInput,
): Promise<SaveIdentitySettingsResult> {
  const existingRows = await db
    .select({
      encrypted: workspaceIdentitySettings.ssoSecretEncrypted,
      previousEncrypted: workspaceIdentitySettings.ssoSecretPreviousEncrypted,
      previousExpiresAt: workspaceIdentitySettings.ssoSecretPreviousExpiresAt,
      maskCustomerIdentity: workspaceIdentitySettings.maskCustomerIdentity,
    })
    .from(workspaceIdentitySettings)
    .where(eq(workspaceIdentitySettings.workspaceId, input.workspaceId))
    .limit(1);

  let encrypted = existingRows[0]?.encrypted ?? null;
  const maskCustomerIdentity =
    input.maskCustomerIdentity ?? existingRows[0]?.maskCustomerIdentity ?? false;
  let generatedSecret: string | null = null;
  const previousExpiry = activePreviousExpiry({
    ssoSecretPreviousEncrypted: existingRows[0]?.previousEncrypted ?? null,
    ssoSecretPreviousExpiresAt: existingRows[0]?.previousExpiresAt ?? null,
  });

  if (input.enabled && encrypted === null) {
    generatedSecret = generateSsoSecret();
    encrypted = encryptSsoSecret(generatedSecret);
  }

  const now = new Date();
  await db
    .insert(workspaceIdentitySettings)
    .values({
      workspaceId: input.workspaceId,
      ssoEnabled: input.enabled,
      ssoSecretEncrypted: encrypted,
      ssoIssuer: input.issuer,
      ssoAudience: input.audience,
      requireSignedTokens: input.requireSignedTokens,
      maskCustomerIdentity,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: workspaceIdentitySettings.workspaceId,
      set: {
        ssoEnabled: input.enabled,
        ssoSecretEncrypted: encrypted,
        ssoIssuer: input.issuer,
        ssoAudience: input.audience,
        requireSignedTokens: input.requireSignedTokens,
        maskCustomerIdentity,
        updatedAt: now,
      },
    });

  return {
    settings: {
      enabled: input.enabled,
      hasSecret: encrypted !== null,
      issuer: input.issuer,
      audience: input.audience,
      requireSignedTokens: input.requireSignedTokens,
      maskCustomerIdentity,
      previousSecretExpiresAt: previousExpiry?.toISOString() ?? null,
      updatedAt: now.toISOString(),
    },
    generatedSecret,
  };
}

/**
 * Rotate the signing secret.
 *
 * The outgoing secret moves to the previous slot and keeps verifying for
 * `graceMs` (24 hours by default), so identities minted just before the
 * rotation still sign in while the customer deploys the new secret. Rotating
 * again inside the window promotes the current secret and drops the older
 * one: only the last two are ever accepted.
 */
export async function rotateIdentitySecret(
  workspaceId: string,
  options: { graceMs?: number } = {},
): Promise<string> {
  const graceMs = options.graceMs ?? SSO_ROTATION_GRACE_MS;
  const existingRows = await db
    .select({ encrypted: workspaceIdentitySettings.ssoSecretEncrypted })
    .from(workspaceIdentitySettings)
    .where(eq(workspaceIdentitySettings.workspaceId, workspaceId))
    .limit(1);

  const outgoing = existingRows[0]?.encrypted ?? null;
  const secret = generateSsoSecret();
  const now = new Date();
  const previousExpiresAt = outgoing
    ? new Date(now.getTime() + graceMs)
    : null;

  await db
    .insert(workspaceIdentitySettings)
    .values({
      workspaceId,
      ssoSecretEncrypted: encryptSsoSecret(secret),
      ssoSecretPreviousEncrypted: outgoing,
      ssoSecretPreviousExpiresAt: previousExpiresAt,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: workspaceIdentitySettings.workspaceId,
      set: {
        ssoSecretEncrypted: encryptSsoSecret(secret),
        ssoSecretPreviousEncrypted: outgoing,
        ssoSecretPreviousExpiresAt: previousExpiresAt,
        updatedAt: now,
      },
    });

  return secret;
}

export async function setCustomerIdentityMasking(
  workspaceId: string,
  enabled: boolean,
): Promise<void> {
  await db
    .insert(workspaceIdentitySettings)
    .values({ workspaceId, maskCustomerIdentity: enabled, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: workspaceIdentitySettings.workspaceId,
      set: { maskCustomerIdentity: enabled, updatedAt: new Date() },
    });
}

/** Read the public masking flag; a missing row means off. */
export async function getCustomerIdentityMasking(
  workspaceId: string,
): Promise<boolean> {
  const rows = await db
    .select({ mask: workspaceIdentitySettings.maskCustomerIdentity })
    .from(workspaceIdentitySettings)
    .where(eq(workspaceIdentitySettings.workspaceId, workspaceId))
    .limit(1);
  return rows[0]?.mask ?? false;
}

/** End the overlap early: the previous secret stops verifying immediately. */
export async function completeIdentitySecretRotation(
  workspaceId: string,
): Promise<void> {
  await db
    .update(workspaceIdentitySettings)
    .set({
      ssoSecretPreviousEncrypted: null,
      ssoSecretPreviousExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(eq(workspaceIdentitySettings.workspaceId, workspaceId));
}
