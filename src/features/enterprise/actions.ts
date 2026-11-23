"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { checkWorkspaceFeature } from "@/features/entitlements/entitlements";
import { limitFailure } from "@/features/billing/links";
import { authorizeWorkspaceAction } from "@/features/live/workspace-action-auth";
import type { ActionResult } from "@/features/live/action-result";
import { recordWorkspaceAudit } from "@/features/data-controls/service";
import { CUSTOM_ROLE_PERMISSIONS } from "@/lib/permissions";

import {
  assignCustomRole,
  createCustomRole,
  createScimToken,
  deleteCustomRole,
  revokeScimToken,
  saveSamlConfiguration,
  setSsoEnforcement,
} from "./identity";

/**
 * Enterprise identity actions. Every action resolves the workspace from the
 * session (never from the submitted slug alone) and re-checks permissions on
 * the server. Enforcement and custom-role assignment stay owner-only.
 */

function path(workspaceSlug: string): string {
  return `/app/${encodeURIComponent(workspaceSlug)}/settings`;
}

const samlSchema = z.object({
  workspaceSlug: z.string().min(1),
  issuer: z.string().trim().min(3, "Enter the SAML issuer.").max(500),
  domain: z.string().trim().min(3).max(253),
  entryPoint: z.string().trim().min(3).max(2000),
  certificate: z.string().trim().max(20_000),
  enabled: z.boolean(),
});

export async function saveSamlSettingsAction(input: {
  workspaceSlug: string;
  issuer: string;
  domain: string;
  entryPoint: string;
  certificate: string;
  enabled: boolean;
}): Promise<ActionResult<{ enabled: boolean }>> {
  const parsed = samlSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the SAML details." };
  }

  const authorized = await authorizeWorkspaceAction(
    parsed.data.workspaceSlug,
    "settings:manage",
  );
  if ("error" in authorized) return authorized.error;

  if (parsed.data.enabled) {
    const feature = await checkWorkspaceFeature(
      authorized.context.workspace.id,
      "sso",
    );
    if (!feature.allowed) {
      return limitFailure(
        "Enterprise sign-in is available on the Professional plan.",
        parsed.data.workspaceSlug,
      );
    }
  }

  const result = await saveSamlConfiguration({
    workspaceId: authorized.context.workspace.id,
    userId: authorized.context.user.id,
    issuer: parsed.data.issuer,
    domain: parsed.data.domain,
    entryPoint: parsed.data.entryPoint,
    certificate: parsed.data.certificate,
    enabled: parsed.data.enabled,
  });
  if (!result.ok) return result;

  await recordWorkspaceAudit({
    workspaceId: authorized.context.workspace.id,
    actorUserId: authorized.context.user.id,
    action: parsed.data.enabled ? "identity.saml_saved" : "identity.saml_disabled",
    targetType: "workspace",
    targetId: authorized.context.workspace.id,
    metadata: { domain: parsed.data.domain },
  });

  revalidatePath(path(parsed.data.workspaceSlug));
  return { ok: true, data: { enabled: parsed.data.enabled } };
}

export async function setSsoEnforcementAction(input: {
  workspaceSlug: string;
  enforced: boolean;
}): Promise<ActionResult<{ enforced: boolean }>> {
  const parsed = z
    .object({ workspaceSlug: z.string().min(1), enforced: z.boolean() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the setting." };

  const authorized = await authorizeWorkspaceAction(
    parsed.data.workspaceSlug,
    "settings:manage",
  );
  if ("error" in authorized) return authorized.error;
  if (authorized.context.role !== "owner") {
    return { ok: false, error: "Only an owner can enforce single sign-on." };
  }

  const result = await setSsoEnforcement({
    workspaceId: authorized.context.workspace.id,
    userId: authorized.context.user.id,
    enforced: parsed.data.enforced,
  });
  if (!result.ok) return result;

  await recordWorkspaceAudit({
    workspaceId: authorized.context.workspace.id,
    actorUserId: authorized.context.user.id,
    action: parsed.data.enforced ? "identity.sso_enforced" : "identity.sso_unenforced",
    targetType: "workspace",
    targetId: authorized.context.workspace.id,
  });

  revalidatePath(path(parsed.data.workspaceSlug));
  return { ok: true, data: { enforced: parsed.data.enforced } };
}

export async function createScimTokenAction(input: {
  workspaceSlug: string;
  name: string;
}): Promise<ActionResult<{ token: string }>> {
  const parsed = z
    .object({
      workspaceSlug: z.string().min(1),
      name: z.string().trim().min(1, "Name the token.").max(120),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the token." };
  }

  const authorized = await authorizeWorkspaceAction(
    parsed.data.workspaceSlug,
    "settings:manage",
  );
  if ("error" in authorized) return authorized.error;

  const result = await createScimToken({
    workspaceId: authorized.context.workspace.id,
    userId: authorized.context.user.id,
    name: parsed.data.name,
  });
  await recordWorkspaceAudit({
    workspaceId: authorized.context.workspace.id,
    actorUserId: authorized.context.user.id,
    action: "identity.scim_token_created",
    targetType: "scim_token",
    targetId: result.view.id,
  });
  revalidatePath(path(parsed.data.workspaceSlug));
  return { ok: true, data: { token: result.token } };
}

export async function revokeScimTokenAction(input: {
  workspaceSlug: string;
  tokenId: string;
}): Promise<ActionResult<{ revoked: true }>> {
  const parsed = z
    .object({ workspaceSlug: z.string().min(1), tokenId: z.uuid() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the token." };

  const authorized = await authorizeWorkspaceAction(
    parsed.data.workspaceSlug,
    "settings:manage",
  );
  if ("error" in authorized) return authorized.error;

  const revoked = await revokeScimToken(
    authorized.context.workspace.id,
    parsed.data.tokenId,
  );
  if (!revoked) return { ok: false, error: "Token not found." };

  await recordWorkspaceAudit({
    workspaceId: authorized.context.workspace.id,
    actorUserId: authorized.context.user.id,
    action: "identity.scim_token_revoked",
    targetType: "scim_token",
    targetId: parsed.data.tokenId,
  });
  revalidatePath(path(parsed.data.workspaceSlug));
  return { ok: true, data: { revoked: true } };
}

export async function createCustomRoleAction(input: {
  workspaceSlug: string;
  name: string;
  description: string;
  permissions: string[];
}): Promise<ActionResult<{ id: string }>> {
  const parsed = z
    .object({
      workspaceSlug: z.string().min(1),
      name: z.string().trim().min(2, "Name the role.").max(80),
      description: z.string().trim().max(240),
      permissions: z.array(z.string()).max(CUSTOM_ROLE_PERMISSIONS.length),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the role." };
  }

  const authorized = await authorizeWorkspaceAction(
    parsed.data.workspaceSlug,
    "member:manage",
  );
  if ("error" in authorized) return authorized.error;

  const result = await createCustomRole({
    workspaceId: authorized.context.workspace.id,
    name: parsed.data.name,
    description: parsed.data.description,
    permissions: parsed.data.permissions,
  });
  if (!result.ok) return result;

  await recordWorkspaceAudit({
    workspaceId: authorized.context.workspace.id,
    actorUserId: authorized.context.user.id,
    action: "identity.custom_role_created",
    targetType: "custom_role",
    targetId: result.role.id,
    metadata: { permissions: result.role.permissions.join(",") },
  });
  revalidatePath(path(parsed.data.workspaceSlug));
  return { ok: true, data: { id: result.role.id } };
}

export async function deleteCustomRoleAction(input: {
  workspaceSlug: string;
  roleId: string;
}): Promise<ActionResult<{ deleted: true }>> {
  const parsed = z
    .object({ workspaceSlug: z.string().min(1), roleId: z.uuid() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the role." };

  const authorized = await authorizeWorkspaceAction(
    parsed.data.workspaceSlug,
    "member:manage",
  );
  if ("error" in authorized) return authorized.error;

  const deleted = await deleteCustomRole(
    authorized.context.workspace.id,
    parsed.data.roleId,
  );
  if (!deleted) return { ok: false, error: "Role not found." };

  await recordWorkspaceAudit({
    workspaceId: authorized.context.workspace.id,
    actorUserId: authorized.context.user.id,
    action: "identity.custom_role_deleted",
    targetType: "custom_role",
    targetId: parsed.data.roleId,
  });
  revalidatePath(path(parsed.data.workspaceSlug));
  return { ok: true, data: { deleted: true } };
}

export async function assignCustomRoleAction(input: {
  workspaceSlug: string;
  userId: string;
  customRoleId: string | null;
}): Promise<ActionResult<{ assigned: boolean }>> {
  const parsed = z
    .object({
      workspaceSlug: z.string().min(1),
      userId: z.string().min(1),
      customRoleId: z.uuid().nullable(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the assignment." };

  const authorized = await authorizeWorkspaceAction(
    parsed.data.workspaceSlug,
    "member:manage",
  );
  if ("error" in authorized) return authorized.error;

  const result = await assignCustomRole({
    workspaceId: authorized.context.workspace.id,
    userId: parsed.data.userId,
    customRoleId: parsed.data.customRoleId,
  });
  if (!result.ok) return result;

  await recordWorkspaceAudit({
    workspaceId: authorized.context.workspace.id,
    actorUserId: authorized.context.user.id,
    action: "identity.custom_role_assigned",
    targetType: "member",
    targetId: parsed.data.userId,
    metadata: { customRoleId: parsed.data.customRoleId ?? "none" },
  });
  revalidatePath(path(parsed.data.workspaceSlug));
  return { ok: true, data: { assigned: Boolean(parsed.data.customRoleId) } };
}
