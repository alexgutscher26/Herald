import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { headers } from "next/headers";
import { and, asc, desc, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { ssoProvider } from "@/db/schema/auth";
import {
  workspaceCustomRoles,
  workspaceEnterpriseIdentity,
  workspaceMemberCustomRoles,
  workspaceScimTokens,
} from "@/db/schema/enterprise";
import { workspaceMembers, workspaces } from "@/db/schema/workspaces";
import { getAuth } from "@/lib/auth";
import { getServerEnv } from "@/lib/env";
import { hasLinkedSamlAccount } from "@/db/queries/enterprise";
import { validateCustomPermissions, type Permission } from "@/lib/permissions";

/**
 * Enterprise identity for workspace members.
 *
 * SAML assertions are validated by `@better-auth/sso`; this module owns the
 * tenant binding, the enforced-SSO switch, SCIM credentials and custom role
 * rows. Nothing here trusts a provider id from the browser: it is always
 * derived from the authorized workspace id.
 */

export type ScimTokenView = {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
};

export type CustomRoleView = {
  id: string;
  name: string;
  description: string | null;
  permissions: Permission[];
};

export type EnterpriseIdentityView = {
  providerId: string;
  samlEnabled: boolean;
  enforced: boolean;
  issuer: string | null;
  domain: string | null;
  acsUrl: string;
  metadataUrl: string;
  scimTokens: ScimTokenView[];
  customRoles: CustomRoleView[];
  assignments: Record<string, string>;
};

export function providerIdForWorkspace(workspaceId: string): string {
  return `workspace-${workspaceId}`;
}

function origin(): string {
  return getServerEnv().BETTER_AUTH_URL.replace(/\/+$/, "");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function getEnterpriseIdentity(
  workspaceId: string,
): Promise<EnterpriseIdentityView> {
  const providerId = providerIdForWorkspace(workspaceId);
  const [settingsRows, tokens, roles, assignments] = await Promise.all([
    db
      .select()
      .from(workspaceEnterpriseIdentity)
      .where(eq(workspaceEnterpriseIdentity.workspaceId, workspaceId))
      .limit(1),
    db
      .select()
      .from(workspaceScimTokens)
      .where(
        and(
          eq(workspaceScimTokens.workspaceId, workspaceId),
          isNull(workspaceScimTokens.revokedAt),
        ),
      )
      .orderBy(desc(workspaceScimTokens.createdAt)),
    db
      .select()
      .from(workspaceCustomRoles)
      .where(eq(workspaceCustomRoles.workspaceId, workspaceId))
      .orderBy(asc(workspaceCustomRoles.name)),
    db
      .select({
        userId: workspaceMemberCustomRoles.userId,
        customRoleId: workspaceMemberCustomRoles.customRoleId,
      })
      .from(workspaceMemberCustomRoles)
      .where(eq(workspaceMemberCustomRoles.workspaceId, workspaceId)),
  ]);

  const settings = settingsRows[0];
  const base = origin();
  return {
    providerId,
    samlEnabled: settings?.samlEnabled ?? false,
    enforced: settings?.enforced ?? false,
    issuer: settings?.samlIssuer ?? null,
    domain: settings?.samlDomain ?? null,
    acsUrl: `${base}/api/auth/sso/saml2/sp/acs/${providerId}`,
    metadataUrl: `${base}/api/auth/sso/saml2/sp/metadata?providerId=${encodeURIComponent(providerId)}`,
    scimTokens: tokens.map((token) => ({
      id: token.id,
      name: token.name,
      prefix: token.prefix,
      createdAt: token.createdAt.toISOString(),
      lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
    })),
    customRoles: roles.map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description,
      permissions: validateCustomPermissions(role.permissions),
    })),
    assignments: Object.fromEntries(
      assignments.map((assignment) => [assignment.userId, assignment.customRoleId]),
    ),
  };
}

export async function saveSamlConfiguration(input: {
  workspaceId: string;
  userId: string;
  issuer: string;
  domain: string;
  entryPoint: string;
  certificate: string;
  enabled: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const providerId = providerIdForWorkspace(input.workspaceId);
  const domain = input.domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  if (!/^(?=.{3,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/.test(domain)) {
    return { ok: false, error: "Enter the email domain your identity provider verifies." };
  }

  if (!input.enabled) {
    await db.delete(ssoProvider).where(eq(ssoProvider.providerId, providerId));
    await db
      .insert(workspaceEnterpriseIdentity)
      .values({
        workspaceId: input.workspaceId,
        providerId: null,
        samlIssuer: input.issuer.trim() || null,
        samlDomain: domain,
        samlEnabled: false,
        enforced: false,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: workspaceEnterpriseIdentity.workspaceId,
        set: {
          providerId: null,
          samlIssuer: input.issuer.trim() || null,
          samlDomain: domain,
          samlEnabled: false,
          enforced: false,
          updatedAt: new Date(),
        },
      });
    return { ok: true };
  }

  const issuer = input.issuer.trim();
  const entryPoint = input.entryPoint.trim();
  const certificate = input.certificate.trim();
  if (issuer.length < 3) return { ok: false, error: "Enter the SAML issuer / entity ID." };
  if (!/^https?:\/\//.test(entryPoint)) {
    return { ok: false, error: "Enter the identity provider SSO URL (https)." };
  }
  if (!certificate.includes("BEGIN CERTIFICATE")) {
    return {
      ok: false,
      error: "Paste the identity provider's X.509 signing certificate in PEM form.",
    };
  }

  const acsUrl = `${origin()}/api/auth/sso/saml2/sp/acs/${providerId}`;
  // Re-registering replaces the tenant's provider. The unique providerId is
  // derived from the workspace, so this can never touch another tenant.
  await db.delete(ssoProvider).where(eq(ssoProvider.providerId, providerId));
  try {
    await getAuth().api.registerSSOProvider({
      body: {
        providerId,
        issuer,
        domain,
        samlConfig: {
          entryPoint,
          cert: certificate,
          callbackUrl: acsUrl,
          audience: acsUrl,
          wantAssertionsSigned: true,
          signatureAlgorithm: "sha256",
          digestAlgorithm: "sha256",
          identifierFormat:
            "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
        },
      },
      headers: await headers(),
    });
  } catch (error) {
    console.error("[enterprise] register SAML provider failed", error);
    return {
      ok: false,
      error:
        error instanceof Error && error.message
          ? `The identity provider was not saved: ${error.message}`
          : "The identity provider was not saved.",
    };
  }

  await db
    .insert(workspaceEnterpriseIdentity)
    .values({
      workspaceId: input.workspaceId,
      providerId,
      samlIssuer: issuer,
      samlDomain: domain,
      samlEnabled: true,
      enforced: false,
      configuredAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: workspaceEnterpriseIdentity.workspaceId,
      set: {
        providerId,
        samlIssuer: issuer,
        samlDomain: domain,
        samlEnabled: true,
        // Saving the provider never silently enforces it; enforcement is a
        // separate, owner-only decision with its own downgrade path.
        enforced: false,
        configuredAt: new Date(),
        updatedAt: new Date(),
      },
    });
  return { ok: true };
}

export async function setSsoEnforcement(input: {
  workspaceId: string;
  userId: string;
  enforced: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const rows = await db
    .select()
    .from(workspaceEnterpriseIdentity)
    .where(eq(workspaceEnterpriseIdentity.workspaceId, input.workspaceId))
    .limit(1);
  const settings = rows[0];
  if (input.enforced) {
    if (!settings?.samlEnabled || !settings.providerId) {
      return { ok: false, error: "Save a working SAML provider before enforcing SSO." };
    }
    if (!(await hasLinkedSamlAccount(input.userId, settings.providerId))) {
      return {
        ok: false,
        error:
          "Sign in through your identity provider once before enforcing SSO, so you are not locked out.",
      };
    }
  }

  await db
    .update(workspaceEnterpriseIdentity)
    .set({ enforced: input.enforced, updatedAt: new Date() })
    .where(eq(workspaceEnterpriseIdentity.workspaceId, input.workspaceId));
  return { ok: true };
}

export async function createScimToken(input: {
  workspaceId: string;
  userId: string;
  name: string;
}): Promise<{ token: string; view: ScimTokenView }> {
  const token = `scim_${randomBytes(32).toString("base64url")}`;
  const rows = await db
    .insert(workspaceScimTokens)
    .values({
      workspaceId: input.workspaceId,
      name: input.name,
      tokenHash: hashToken(token),
      prefix: token.slice(0, 13),
      createdBy: input.userId,
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("Could not create the SCIM token.");
  return {
    token,
    view: {
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: null,
    },
  };
}

export async function revokeScimToken(
  workspaceId: string,
  tokenId: string,
): Promise<boolean> {
  const rows = await db
    .update(workspaceScimTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(workspaceScimTokens.id, tokenId),
        eq(workspaceScimTokens.workspaceId, workspaceId),
        isNull(workspaceScimTokens.revokedAt),
      ),
    )
    .returning({ id: workspaceScimTokens.id });
  return Boolean(rows[0]);
}

export async function authenticateScimToken(
  token: string,
): Promise<{ tokenId: string; workspaceId: string; createdBy: string | null } | null> {
  if (!token.startsWith("scim_") || token.length > 200) return null;
  const rows = await db
    .select({
      tokenId: workspaceScimTokens.id,
      workspaceId: workspaceScimTokens.workspaceId,
      createdBy: workspaceScimTokens.createdBy,
      slug: workspaces.slug,
    })
    .from(workspaceScimTokens)
    .innerJoin(workspaces, eq(workspaceScimTokens.workspaceId, workspaces.id))
    .where(
      and(
        eq(workspaceScimTokens.tokenHash, hashToken(token)),
        isNull(workspaceScimTokens.revokedAt),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  await db
    .update(workspaceScimTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(workspaceScimTokens.id, row.tokenId));
  return { tokenId: row.tokenId, workspaceId: row.workspaceId, createdBy: row.createdBy };
}

export async function listCustomRoles(workspaceId: string): Promise<CustomRoleView[]> {
  const rows = await db
    .select()
    .from(workspaceCustomRoles)
    .where(eq(workspaceCustomRoles.workspaceId, workspaceId))
    .orderBy(asc(workspaceCustomRoles.name));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    permissions: validateCustomPermissions(row.permissions),
  }));
}

export async function createCustomRole(input: {
  workspaceId: string;
  name: string;
  description: string | null;
  permissions: unknown;
}): Promise<{ ok: true; role: CustomRoleView } | { ok: false; error: string }> {
  const permissions = validateCustomPermissions(input.permissions);
  if (permissions.length === 0) {
    return { ok: false, error: "Choose at least one permission for the custom role." };
  }

  try {
    const rows = await db
      .insert(workspaceCustomRoles)
      .values({
        workspaceId: input.workspaceId,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        permissions,
      })
      .returning();
    const row = rows[0];
    if (!row) return { ok: false, error: "Could not create the custom role." };
    return {
      ok: true,
      role: {
        id: row.id,
        name: row.name,
        description: row.description,
        permissions: validateCustomPermissions(row.permissions),
      },
    };
  } catch {
    return { ok: false, error: "A custom role with that name already exists." };
  }
}

export async function deleteCustomRole(
  workspaceId: string,
  roleId: string,
): Promise<boolean> {
  const rows = await db
    .delete(workspaceCustomRoles)
    .where(
      and(
        eq(workspaceCustomRoles.id, roleId),
        eq(workspaceCustomRoles.workspaceId, workspaceId),
      ),
    )
    .returning({ id: workspaceCustomRoles.id });
  return Boolean(rows[0]);
}

export async function assignCustomRole(input: {
  workspaceId: string;
  userId: string;
  customRoleId: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const member = await db
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, input.workspaceId),
        eq(workspaceMembers.userId, input.userId),
      ),
    )
    .limit(1);
  if (!member[0]) return { ok: false, error: "Member not found." };

  if (!input.customRoleId) {
    await db
      .delete(workspaceMemberCustomRoles)
      .where(
        and(
          eq(workspaceMemberCustomRoles.workspaceId, input.workspaceId),
          eq(workspaceMemberCustomRoles.userId, input.userId),
        ),
      );
    return { ok: true };
  }

  const role = await db
    .select({ id: workspaceCustomRoles.id })
    .from(workspaceCustomRoles)
    .where(
      and(
        eq(workspaceCustomRoles.id, input.customRoleId),
        eq(workspaceCustomRoles.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);
  if (!role[0]) return { ok: false, error: "Custom role not found." };

  await db
    .insert(workspaceMemberCustomRoles)
    .values({
      workspaceId: input.workspaceId,
      userId: input.userId,
      customRoleId: input.customRoleId,
    })
    .onConflictDoUpdate({
      target: [workspaceMemberCustomRoles.workspaceId, workspaceMemberCustomRoles.userId],
      set: { customRoleId: input.customRoleId, assignedAt: new Date() },
    });
  return { ok: true };
}
