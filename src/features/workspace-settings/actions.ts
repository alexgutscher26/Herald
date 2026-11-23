"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { API_SCOPES, apiTokens } from "@/db/schema";
import { products, workspaces } from "@/db/schema/workspaces";
import { workspaceBranding } from "@/db/schema/branding";
import { createApiTokenMaterial } from "@/features/api-v1/token";
import { rotateApiToken } from "@/features/api-v1/token-rotation";
import { checkWorkspaceFeature } from "@/features/entitlements/entitlements";
import { limitFailure } from "@/features/billing/links";
import { authorizeWorkspaceAction } from "@/features/live/workspace-action-auth";
import type { ActionResult } from "@/features/live/action-result";
import { setCustomerIdentityMasking } from "@/features/customer-auth/identity-settings";
import { recordWorkspaceAudit } from "@/features/data-controls/service";
import { isWorkspaceRole } from "@/lib/permissions";
import { and, eq } from "drizzle-orm";

import {
  checkWorkspaceDomainHealth,
  removeWorkspaceDomain,
  saveWorkspaceDomain,
  verifyWorkspaceDomain,
  type DomainView,
} from "./domains";
import {
  changeWorkspaceMemberRole,
  createWorkspaceInvitation,
  removeWorkspaceMember,
  resendWorkspaceInvitation,
  revokeWorkspaceInvitation,
  type InvitationView,
} from "./invitations";
import {
  removeDomainClaim,
  saveDomainClaim,
  verifyDomainClaim,
  type DomainClaimView,
} from "./domain-claims";
import type { CapturedDomainRole } from "./domain-capture";

function settingsPath(workspaceSlug: string): string {
  return `/app/${encodeURIComponent(workspaceSlug)}/settings`;
}

export async function updateWorkspaceNameAction(input: {
  workspaceSlug: string;
  name: string;
}): Promise<ActionResult<{ name: string }>> {
  const parsed = z
    .object({
      workspaceSlug: z.string().min(1),
      name: z.string().trim().min(2, "Use at least two characters.").max(80),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the name." };

  const authorized = await authorizeWorkspaceAction(
    parsed.data.workspaceSlug,
    "workspace:update",
  );
  if ("error" in authorized) return authorized.error;

  await db
    .update(workspaces)
    .set({ name: parsed.data.name, updatedAt: new Date() })
    .where(eq(workspaces.id, authorized.context.workspace.id));

  await recordWorkspaceAudit({
    workspaceId: authorized.context.workspace.id,
    actorUserId: authorized.context.user.id,
    action: "workspace.name_updated",
    targetType: "workspace",
    targetId: authorized.context.workspace.id,
    metadata: { name: parsed.data.name },
  });

  revalidatePath(settingsPath(parsed.data.workspaceSlug));
  return { ok: true, data: { name: parsed.data.name } };
}

/**
 * Whether public request pages may show the team's planned quarter/date.
 *
 * The field itself stays internal either way; turning this off hides it from
 * every public projection on the next request, without clearing data.
 */
export async function setPlannedForVisibilityAction(input: {
  workspaceSlug: string;
  publicPlannedFor: boolean;
}): Promise<ActionResult<{ publicPlannedFor: boolean }>> {
  const parsed = z
    .object({
      workspaceSlug: z.string().min(1),
      publicPlannedFor: z.boolean(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the setting." };

  const authorized = await authorizeWorkspaceAction(
    parsed.data.workspaceSlug,
    "workspace:update",
  );
  if ("error" in authorized) return authorized.error;

  await db
    .update(workspaces)
    .set({ publicPlannedFor: parsed.data.publicPlannedFor, updatedAt: new Date() })
    .where(eq(workspaces.id, authorized.context.workspace.id));

  await recordWorkspaceAudit({
    workspaceId: authorized.context.workspace.id,
    actorUserId: authorized.context.user.id,
    action: "workspace.planned_for_visibility_changed",
    targetType: "workspace",
    targetId: authorized.context.workspace.id,
    metadata: { publicPlannedFor: parsed.data.publicPlannedFor },
  });

  revalidatePath(settingsPath(parsed.data.workspaceSlug));
  revalidatePath(`/p/${authorized.context.workspace.slug}`, "layout");
  return { ok: true, data: { publicPlannedFor: parsed.data.publicPlannedFor } };
}

export async function setDoubleOptInAction(input: {
  workspaceSlug: string;
  doubleOptIn: boolean;
}): Promise<ActionResult<{ doubleOptIn: boolean }>> {
  const parsed = z
    .object({ workspaceSlug: z.string().min(1), doubleOptIn: z.boolean() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the setting." };

  const authorized = await authorizeWorkspaceAction(
    parsed.data.workspaceSlug,
    "workspace:update",
  );
  if ("error" in authorized) return authorized.error;

  await db
    .update(workspaces)
    .set({ doubleOptIn: parsed.data.doubleOptIn, updatedAt: new Date() })
    .where(eq(workspaces.id, authorized.context.workspace.id));

  await recordWorkspaceAudit({
    workspaceId: authorized.context.workspace.id,
    actorUserId: authorized.context.user.id,
    action: "workspace.double_opt_in_changed",
    targetType: "workspace",
    targetId: authorized.context.workspace.id,
    metadata: { doubleOptIn: parsed.data.doubleOptIn },
  });

  revalidatePath(settingsPath(parsed.data.workspaceSlug));
  return { ok: true, data: { doubleOptIn: parsed.data.doubleOptIn } };
}

const inviteSchema = z.object({
  workspaceSlug: z.string().min(1),
  email: z.email("Enter a valid email address."),
  role: z.enum(["admin", "editor", "viewer"]),
});

export async function inviteMemberAction(input: {
  workspaceSlug: string;
  email: string;
  role: "admin" | "editor" | "viewer";
}): Promise<
  ActionResult<{ invitation: InvitationView; url: string; emailSent: boolean; emailError: string | null }>
> {
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the invitation." };

  const authorized = await authorizeWorkspaceAction(
    parsed.data.workspaceSlug,
    "member:manage",
  );
  if ("error" in authorized) return authorized.error;
  if (authorized.context.role !== "owner") {
    return { ok: false, error: "Only a workspace owner can invite teammates." };
  }

  const result = await createWorkspaceInvitation({
    workspaceId: authorized.context.workspace.id,
    workspaceSlug: parsed.data.workspaceSlug,
    workspaceName: authorized.context.workspace.name,
    invitedBy: authorized.context.user.id,
    inviterName: authorized.context.user.name,
    email: parsed.data.email,
    role: parsed.data.role,
  });
  if (!result.ok) return result;

  await recordWorkspaceAudit({
    workspaceId: authorized.context.workspace.id,
    actorUserId: authorized.context.user.id,
    action: "member.invited",
    targetType: "invitation",
    targetId: result.invitation.id,
    metadata: { role: result.invitation.role },
  });

  revalidatePath(settingsPath(parsed.data.workspaceSlug));
  return {
    ok: true,
    data: {
      invitation: result.invitation,
      url: result.url,
      emailSent: result.emailSent,
      emailError: result.emailError,
    },
  };
}

export async function revokeInvitationAction(input: {
  workspaceSlug: string;
  invitationId: string;
}): Promise<ActionResult<{ revoked: true }>> {
  const parsed = z
    .object({ workspaceSlug: z.string().min(1), invitationId: z.uuid() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the invitation." };

  const authorized = await authorizeWorkspaceAction(
    parsed.data.workspaceSlug,
    "member:manage",
  );
  if ("error" in authorized) return authorized.error;
  if (authorized.context.role !== "owner") {
    return { ok: false, error: "Only a workspace owner can revoke an invitation." };
  }

  const revoked = await revokeWorkspaceInvitation({
    workspaceId: authorized.context.workspace.id,
    invitationId: parsed.data.invitationId,
  });
  if (!revoked) return { ok: false, error: "Invitation not found." };

  await recordWorkspaceAudit({
    workspaceId: authorized.context.workspace.id,
    actorUserId: authorized.context.user.id,
    action: "member.invitation_revoked",
    targetType: "invitation",
    targetId: parsed.data.invitationId,
  });

  revalidatePath(settingsPath(parsed.data.workspaceSlug));
  return { ok: true, data: { revoked: true } };
}

export async function resendInvitationAction(input: {
  workspaceSlug: string;
  invitationId: string;
}): Promise<
  ActionResult<{ invitation: InvitationView; url: string; emailSent: boolean; emailError: string | null }>
> {
  const parsed = z
    .object({ workspaceSlug: z.string().min(1), invitationId: z.uuid() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the invitation." };

  const authorized = await authorizeWorkspaceAction(
    parsed.data.workspaceSlug,
    "member:manage",
  );
  if ("error" in authorized) return authorized.error;
  if (authorized.context.role !== "owner") {
    return { ok: false, error: "Only a workspace owner can resend an invitation." };
  }

  const result = await resendWorkspaceInvitation({
    workspaceId: authorized.context.workspace.id,
    workspaceSlug: parsed.data.workspaceSlug,
    workspaceName: authorized.context.workspace.name,
    invitationId: parsed.data.invitationId,
    invitedBy: authorized.context.user.id,
    inviterName: authorized.context.user.name,
  });
  if (!result.ok) return result;

  await recordWorkspaceAudit({
    workspaceId: authorized.context.workspace.id,
    actorUserId: authorized.context.user.id,
    action: "member.invitation_resent",
    targetType: "invitation",
    targetId: result.invitation.id,
    metadata: { email: result.invitation.email, role: result.invitation.role },
  });

  revalidatePath(settingsPath(parsed.data.workspaceSlug));
  return {
    ok: true,
    data: {
      invitation: result.invitation,
      url: result.url,
      emailSent: result.emailSent,
      emailError: result.emailError,
    },
  };
}

export async function changeMemberRoleAction(input: {
  workspaceSlug: string;
  memberId: string;
  role: string;
}): Promise<ActionResult<{ role: string }>> {
  const parsed = z
    .object({
      workspaceSlug: z.string().min(1),
      memberId: z.uuid(),
      role: z.string().min(1),
    })
    .safeParse(input);
  if (!parsed.success || !isWorkspaceRole(parsed.data.role)) {
    return { ok: false, error: "Choose a valid role." };
  }

  const authorized = await authorizeWorkspaceAction(
    parsed.data.workspaceSlug,
    "member:manage",
  );
  if ("error" in authorized) return authorized.error;

  const result = await changeWorkspaceMemberRole({
    workspaceId: authorized.context.workspace.id,
    workspaceSlug: parsed.data.workspaceSlug,
    memberId: parsed.data.memberId,
    role: parsed.data.role,
    actorUserId: authorized.context.user.id,
  });
  if (!result.ok) return result;

  await recordWorkspaceAudit({
    workspaceId: authorized.context.workspace.id,
    actorUserId: authorized.context.user.id,
    action: "member.role_changed",
    targetType: "member",
    targetId: parsed.data.memberId,
    // The previous role and the address are what make the entry readable later:
    // "changed a role" alone cannot answer who was demoted, or from what.
    metadata: {
      role: parsed.data.role,
      previousRole: result.previousRole,
      memberEmail: result.memberEmail,
      tokensRevoked: result.tokensRevoked,
    },
  });

  revalidatePath(settingsPath(parsed.data.workspaceSlug));
  return { ok: true, data: { role: parsed.data.role } };
}

export async function removeMemberAction(input: {
  workspaceSlug: string;
  memberId: string;
}): Promise<ActionResult<{ removed: true }>> {
  const parsed = z
    .object({ workspaceSlug: z.string().min(1), memberId: z.uuid() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the member." };

  const authorized = await authorizeWorkspaceAction(
    parsed.data.workspaceSlug,
    "member:manage",
  );
  if ("error" in authorized) return authorized.error;

  const result = await removeWorkspaceMember({
    workspaceId: authorized.context.workspace.id,
    memberId: parsed.data.memberId,
    actorUserId: authorized.context.user.id,
  });
  if (!result.ok) return result;

  await recordWorkspaceAudit({
    workspaceId: authorized.context.workspace.id,
    actorUserId: authorized.context.user.id,
    action: "member.removed",
    targetType: "member",
    targetId: parsed.data.memberId,
    metadata: {
      memberEmail: result.memberEmail,
      role: result.role,
      tokensRevoked: result.tokensRevoked,
      source: "settings",
    },
  });

  revalidatePath(settingsPath(parsed.data.workspaceSlug));
  return { ok: true, data: { removed: true } };
}

const domainClaimSchema = z.object({
  workspaceSlug: z.string().min(1),
  domain: z.string().trim().min(3, "Enter a company domain such as acme.com.").max(253),
  role: z.enum(["editor", "viewer"]),
});

export async function saveDomainClaimAction(input: {
  workspaceSlug: string;
  domain: string;
  role: CapturedDomainRole;
}): Promise<ActionResult<{ claim: DomainClaimView }>> {
  const parsed = domainClaimSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the domain." };
  }

  const authorized = await authorizeWorkspaceAction(
    parsed.data.workspaceSlug,
    "workspace:update",
  );
  if ("error" in authorized) return authorized.error;
  // Capturing a domain enrolls future accounts without review, so only an owner
  // may do it — the same bar as changing what the workspace is.
  if (authorized.context.role !== "owner") {
    return { ok: false, error: "Only a workspace owner can claim a domain." };
  }

  const result = await saveDomainClaim({
    workspaceId: authorized.context.workspace.id,
    domain: parsed.data.domain,
    role: parsed.data.role,
    createdBy: authorized.context.user.id,
  });
  if (!result.ok) return result;

  await recordWorkspaceAudit({
    workspaceId: authorized.context.workspace.id,
    actorUserId: authorized.context.user.id,
    action: "workspace.domain_claim_saved",
    targetType: "domain_claim",
    targetId: result.claim.id,
    metadata: { domain: result.claim.domain, role: result.claim.role },
  });

  revalidatePath(settingsPath(parsed.data.workspaceSlug));
  return { ok: true, data: { claim: result.claim } };
}

export async function verifyDomainClaimAction(input: {
  workspaceSlug: string;
}): Promise<ActionResult<{ claim: DomainClaimView }>> {
  const authorized = await authorizeWorkspaceAction(input.workspaceSlug, "workspace:update");
  if ("error" in authorized) return authorized.error;
  if (authorized.context.role !== "owner") {
    return { ok: false, error: "Only a workspace owner can verify a domain." };
  }

  const result = await verifyDomainClaim({ workspaceId: authorized.context.workspace.id });
  if (!result.ok) return result;

  await recordWorkspaceAudit({
    workspaceId: authorized.context.workspace.id,
    actorUserId: authorized.context.user.id,
    action: "workspace.domain_claim_verified",
    targetType: "domain_claim",
    targetId: result.claim.id,
    metadata: { domain: result.claim.domain, role: result.claim.role },
  });

  revalidatePath(settingsPath(input.workspaceSlug));
  return { ok: true, data: { claim: result.claim } };
}

export async function removeDomainClaimAction(input: {
  workspaceSlug: string;
}): Promise<ActionResult<{ removed: true }>> {
  const authorized = await authorizeWorkspaceAction(input.workspaceSlug, "workspace:update");
  if ("error" in authorized) return authorized.error;
  if (authorized.context.role !== "owner") {
    return { ok: false, error: "Only a workspace owner can remove a domain claim." };
  }

  const removed = await removeDomainClaim(authorized.context.workspace.id);
  if (!removed) return { ok: false, error: "No domain claim to remove." };

  await recordWorkspaceAudit({
    workspaceId: authorized.context.workspace.id,
    actorUserId: authorized.context.user.id,
    action: "workspace.domain_claim_removed",
    targetType: "domain_claim",
    targetId: null,
  });

  revalidatePath(settingsPath(input.workspaceSlug));
  return { ok: true, data: { removed: true } };
}

export async function createApiTokenAction(input: {
  workspaceSlug: string;
  name: string;
  scopes: Array<(typeof API_SCOPES)[number]>;
}): Promise<
  ActionResult<{
    token: string;
    apiToken: {
      id: string;
      name: string;
      prefix: string;
      scopes: string[];
      createdAt: string;
      revokedAt: string | null;
      expiresAt: string | null;
      lastUsedAt: string | null;
      lastUsedIpPrefix: string | null;
      lastUsedUserAgent: string | null;
    };
  }>
> {
  const parsed = z
    .object({
      workspaceSlug: z.string().min(1),
      name: z.string().trim().min(1, "Name the token.").max(120),
      scopes: z.array(z.enum(API_SCOPES)).min(1).max(API_SCOPES.length),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the token." };

  const authorized = await authorizeWorkspaceAction(
    parsed.data.workspaceSlug,
    "settings:manage",
  );
  if ("error" in authorized) return authorized.error;

  const feature = await checkWorkspaceFeature(
    authorized.context.workspace.id,
    "api",
  );
  if (!feature.allowed) {
    return limitFailure(
      "API tokens are available on the Professional plan.",
      parsed.data.workspaceSlug,
    );
  }

  const material = createApiTokenMaterial();
  const rows = await db
    .insert(apiTokens)
    .values({
      workspaceId: authorized.context.workspace.id,
      name: parsed.data.name,
      tokenHash: material.tokenHash,
      prefix: material.prefix,
      scopes: [...new Set(parsed.data.scopes)],
      createdBy: authorized.context.user.id,
    })
    .returning({
      id: apiTokens.id,
      name: apiTokens.name,
      prefix: apiTokens.prefix,
      scopes: apiTokens.scopes,
      createdAt: apiTokens.createdAt,
      revokedAt: apiTokens.revokedAt,
      expiresAt: apiTokens.expiresAt,
      lastUsedAt: apiTokens.lastUsedAt,
    });

  const row = rows[0];
  if (!row) return { ok: false, error: "Could not create the token." };

  await recordWorkspaceAudit({
    workspaceId: authorized.context.workspace.id,
    actorUserId: authorized.context.user.id,
    action: "api_token.created",
    targetType: "api_token",
    targetId: row.id,
    metadata: { scopes: row.scopes.join(",") },
  });

  revalidatePath(settingsPath(parsed.data.workspaceSlug));
  return {
    ok: true,
    data: {
      token: material.token,
      apiToken: {
        ...row,
        createdAt: row.createdAt.toISOString(),
        revokedAt: row.revokedAt?.toISOString() ?? null,
        expiresAt: row.expiresAt?.toISOString() ?? null,
        lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
        lastUsedIpPrefix: null,
        lastUsedUserAgent: null,
      },
    },
  };
}

export async function rotateApiTokenAction(input: {
  workspaceSlug: string;
  tokenId: string;
  graceHours?: number;
}): Promise<
  ActionResult<{
    token: string;
    apiToken: {
      id: string;
      name: string;
      prefix: string;
      scopes: string[];
      createdAt: string;
      revokedAt: string | null;
      expiresAt: string | null;
      lastUsedAt: string | null;
      lastUsedIpPrefix: string | null;
      lastUsedUserAgent: string | null;
    };
    previousRetiresAt: string;
  }>
> {
  const parsed = z
    .object({
      workspaceSlug: z.string().min(1),
      tokenId: z.uuid(),
      graceHours: z.number().int().min(0).max(168).default(24),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the token." };

  const authorized = await authorizeWorkspaceAction(
    parsed.data.workspaceSlug,
    "settings:manage",
  );
  if ("error" in authorized) return authorized.error;

  const result = await rotateApiToken({
    workspaceId: authorized.context.workspace.id,
    userId: authorized.context.user.id,
    tokenId: parsed.data.tokenId,
    graceHours: parsed.data.graceHours,
  });
  if (!result.ok) return { ok: false, error: result.error };

  await recordWorkspaceAudit({
    workspaceId: authorized.context.workspace.id,
    actorUserId: authorized.context.user.id,
    action: "api_token.rotated",
    targetType: "api_token",
    targetId: result.apiToken.id,
    metadata: {
      previousTokenId: parsed.data.tokenId,
      previousRetiresAt: result.previousRetiresAt.toISOString(),
    },
  });

  revalidatePath(settingsPath(parsed.data.workspaceSlug));
  return {
    ok: true,
    data: {
      token: result.token,
      apiToken: {
        ...result.apiToken,
        createdAt: result.apiToken.createdAt.toISOString(),
        revokedAt: result.apiToken.revokedAt?.toISOString() ?? null,
        expiresAt: null,
        lastUsedAt: result.apiToken.lastUsedAt?.toISOString() ?? null,
        lastUsedIpPrefix: null,
        lastUsedUserAgent: null,
      },
      previousRetiresAt: result.previousRetiresAt.toISOString(),
    },
  };
}

export async function revokeApiTokenAction(input: {
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

  const revoked = await db
    .update(apiTokens)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(apiTokens.id, parsed.data.tokenId),
        eq(apiTokens.workspaceId, authorized.context.workspace.id),
      ),
    )
    .returning({ id: apiTokens.id });
  if (!revoked[0]) return { ok: false, error: "Token not found." };

  await recordWorkspaceAudit({
    workspaceId: authorized.context.workspace.id,
    actorUserId: authorized.context.user.id,
    action: "api_token.revoked",
    targetType: "api_token",
    targetId: parsed.data.tokenId,
  });

  revalidatePath(settingsPath(parsed.data.workspaceSlug));
  return { ok: true, data: { revoked: true } };
}

export async function setIdentityMaskingAction(input: {
  workspaceSlug: string;
  enabled: boolean;
}): Promise<ActionResult<{ enabled: boolean }>> {
  const parsed = z
    .object({ workspaceSlug: z.string().min(1), enabled: z.boolean() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the privacy setting." };

  const authorized = await authorizeWorkspaceAction(
    parsed.data.workspaceSlug,
    "settings:manage",
  );
  if ("error" in authorized) return authorized.error;

  const feature = await checkWorkspaceFeature(
    authorized.context.workspace.id,
    "identityMasking",
  );
  if (!feature.allowed) {
    return limitFailure(
      "Identity masking is available on the Professional plan.",
      parsed.data.workspaceSlug,
    );
  }

  await setCustomerIdentityMasking(
    authorized.context.workspace.id,
    parsed.data.enabled,
  );
  await recordWorkspaceAudit({
    workspaceId: authorized.context.workspace.id,
    actorUserId: authorized.context.user.id,
    action: "privacy.identity_masking_changed",
    targetType: "workspace",
    targetId: authorized.context.workspace.id,
    metadata: { enabled: parsed.data.enabled },
  });
  revalidatePath(settingsPath(parsed.data.workspaceSlug));
  revalidatePath("/p", "layout");
  return { ok: true, data: { enabled: parsed.data.enabled } };
}

export async function setContentTranslationAction(input: {
  workspaceSlug: string;
  enabled: boolean;
}): Promise<ActionResult<{ enabled: boolean }>> {
  const parsed = z
    .object({ workspaceSlug: z.string().min(1), enabled: z.boolean() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the translation setting." };

  const authorized = await authorizeWorkspaceAction(
    parsed.data.workspaceSlug,
    "settings:manage",
  );
  if ("error" in authorized) return authorized.error;

  await db
    .insert(workspaceBranding)
    .values({
      workspaceId: authorized.context.workspace.id,
      contentTranslationEnabled: parsed.data.enabled,
    })
    .onConflictDoUpdate({
      target: workspaceBranding.workspaceId,
      set: { contentTranslationEnabled: parsed.data.enabled, updatedAt: new Date() },
    });

  await recordWorkspaceAudit({
    workspaceId: authorized.context.workspace.id,
    actorUserId: authorized.context.user.id,
    action: "content.translation_changed",
    targetType: "workspace",
    targetId: authorized.context.workspace.id,
    metadata: { enabled: parsed.data.enabled },
  });
  revalidatePath(settingsPath(parsed.data.workspaceSlug));
  revalidatePath("/p", "layout");
  return { ok: true, data: { enabled: parsed.data.enabled } };
}

export async function saveDomainAction(input: {
  workspaceSlug: string;
  productSlug: string;
  domain: string;
}): Promise<ActionResult<{ domain: DomainView }>> {
  const parsed = z
    .object({
      workspaceSlug: z.string().min(1),
      productSlug: z.string().min(1),
      domain: z.string().trim().min(3).max(253),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Enter a valid domain." };

  const authorized = await authorizeWorkspaceAction(
    parsed.data.workspaceSlug,
    "settings:manage",
  );
  if ("error" in authorized) return authorized.error;

  const product = await db
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        eq(products.workspaceId, authorized.context.workspace.id),
        eq(products.slug, parsed.data.productSlug),
      ),
    )
    .limit(1);
  if (!product[0]) return { ok: false, error: "Choose a product in this workspace." };

  const result = await saveWorkspaceDomain({
    workspaceId: authorized.context.workspace.id,
    workspaceSlug: parsed.data.workspaceSlug,
    productId: product[0].id,
    domain: parsed.data.domain,
  });
  if (!result.ok) return result;

  await recordWorkspaceAudit({
    workspaceId: authorized.context.workspace.id,
    actorUserId: authorized.context.user.id,
    action: "domain.saved",
    targetType: "workspace",
    targetId: authorized.context.workspace.id,
    metadata: { domain: parsed.data.domain },
  });

  revalidatePath(settingsPath(parsed.data.workspaceSlug));
  return { ok: true, data: { domain: result.domain } };
}

export async function verifyDomainAction(input: {
  workspaceSlug: string;
}): Promise<ActionResult<{ domain: DomainView }>> {
  const parsed = z.object({ workspaceSlug: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the workspace." };

  const authorized = await authorizeWorkspaceAction(
    parsed.data.workspaceSlug,
    "settings:manage",
  );
  if ("error" in authorized) return authorized.error;

  const result = await verifyWorkspaceDomain({
    workspaceId: authorized.context.workspace.id,
  });
  if (!result.ok) return result;

  revalidatePath(settingsPath(parsed.data.workspaceSlug));
  return { ok: true, data: { domain: result.domain } };
}

export async function checkDomainHealthAction(input: {
  workspaceSlug: string;
}): Promise<ActionResult<{ domain: DomainView }>> {
  const parsed = z.object({ workspaceSlug: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the workspace." };

  const authorized = await authorizeWorkspaceAction(
    parsed.data.workspaceSlug,
    "settings:manage",
  );
  if ("error" in authorized) return authorized.error;

  const result = await checkWorkspaceDomainHealth({
    workspaceId: authorized.context.workspace.id,
  });
  if (!result.ok) return result;

  revalidatePath(settingsPath(parsed.data.workspaceSlug));
  return { ok: true, data: { domain: result.domain } };
}

export async function removeDomainAction(input: {
  workspaceSlug: string;
}): Promise<ActionResult<{ removed: true }>> {
  const parsed = z.object({ workspaceSlug: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the workspace." };

  const authorized = await authorizeWorkspaceAction(
    parsed.data.workspaceSlug,
    "settings:manage",
  );
  if ("error" in authorized) return authorized.error;

  await removeWorkspaceDomain(authorized.context.workspace.id);
  await recordWorkspaceAudit({
    workspaceId: authorized.context.workspace.id,
    actorUserId: authorized.context.user.id,
    action: "domain.removed",
    targetType: "workspace",
    targetId: authorized.context.workspace.id,
  });
  revalidatePath(settingsPath(parsed.data.workspaceSlug));
  return { ok: true, data: { removed: true } };
}

