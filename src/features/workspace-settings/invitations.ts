import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { user } from "@/db/schema/auth";
import { workspaceInvitations } from "@/db/schema/invitations";
import { workspaceMembers, workspaces } from "@/db/schema/workspaces";
import { checkWorkspaceLimit } from "@/features/entitlements/entitlements";
import { billingSettingsPath, limitFailure } from "@/features/billing/links";
import { sendEmail } from "@/features/email/provider";
import { renderWorkspaceInviteEmail } from "@/features/email/templates";
import { normalizeEmail } from "@/lib/email";
import { getServerEnv } from "@/lib/env";
import { isWorkspaceRole, type WorkspaceRole } from "@/lib/permissions";

import { revokeApiTokensCreatedBy } from "./token-revocation";

/**
 * Workspace invitations.
 *
 * The raw token is returned once to the inviter and is never stored. The email
 * is best-effort: when outbound email is not configured, the owner can still
 * copy the link. Acceptance requires an authenticated user whose normalized
 * email matches the invitation, and membership limits are checked at both
 * invite and accept time.
 */

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type InvitationView = {
  id: string;
  email: string;
  role: WorkspaceRole;
  expiresAt: string;
  createdAt: string;
};

export type WorkspaceMemberView = {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: WorkspaceRole;
  createdAt: string;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function listWorkspaceInvitations(
  workspaceId: string,
): Promise<InvitationView[]> {
  const rows = await db
    .select({
      id: workspaceInvitations.id,
      email: workspaceInvitations.email,
      role: workspaceInvitations.role,
      expiresAt: workspaceInvitations.expiresAt,
      createdAt: workspaceInvitations.createdAt,
    })
    .from(workspaceInvitations)
    .where(
      and(
        eq(workspaceInvitations.workspaceId, workspaceId),
        isNull(workspaceInvitations.acceptedAt),
        gt(workspaceInvitations.expiresAt, new Date()),
      ),
    )
    .orderBy(asc(workspaceInvitations.createdAt));

  return rows.map((row) => ({
    ...row,
    role: row.role as WorkspaceRole,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function listWorkspaceMembers(
  workspaceId: string,
): Promise<WorkspaceMemberView[]> {
  const rows = await db
    .select({
      id: workspaceMembers.id,
      userId: workspaceMembers.userId,
      name: user.name,
      email: user.email,
      role: workspaceMembers.role,
      createdAt: workspaceMembers.createdAt,
    })
    .from(workspaceMembers)
    .innerJoin(user, eq(workspaceMembers.userId, user.id))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(asc(user.name), asc(user.email));

  return rows.map((row) => ({
    ...row,
    role: row.role as WorkspaceRole,
    createdAt: row.createdAt.toISOString(),
  }));
}

export type CreateInvitationResult =
  | {
      ok: true;
      invitation: InvitationView;
      url: string;
      emailSent: boolean;
      emailError: string | null;
    }
  | { ok: false; error: string; billingUrl?: string };

export async function createWorkspaceInvitation(input: {
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
  invitedBy: string;
  inviterName: string;
  email: string;
  role: WorkspaceRole;
}): Promise<CreateInvitationResult> {
  if (!isWorkspaceRole(input.role) || input.role === "owner") {
    return { ok: false, error: "Choose admin, editor or viewer for an invitation." };
  }

  const email = input.email.trim();
  const emailNormalized = normalizeEmail(email);
  if (!emailNormalized.includes("@")) {
    return { ok: false, error: "Enter a valid email address." };
  }

  const existingMember = await db
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .innerJoin(user, eq(workspaceMembers.userId, user.id))
    .where(
      and(
        eq(workspaceMembers.workspaceId, input.workspaceId),
        eq(sql`lower(${user.email})`, emailNormalized),
      ),
    )
    .limit(1);
  if (existingMember[0]) {
    return { ok: false, error: "That person is already on the team." };
  }

  // Viewers are free seats, so inviting one never consumes the paid allowance.
  if (input.role !== "viewer") {
    const limit = await checkWorkspaceLimit(input.workspaceId, "members");
    if (!limit.allowed) {
      return limitFailure(
        limit.limit === null
          ? "The team limit is unavailable."
          : `Your plan allows ${limit.limit} paid team members. Upgrade to invite more, or add a free viewer.`,
        input.workspaceSlug,
      );
    }
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  const rows = await db
    .insert(workspaceInvitations)
    .values({
      workspaceId: input.workspaceId,
      email,
      emailNormalized,
      role: input.role,
      tokenHash: hashToken(token),
      invitedBy: input.invitedBy,
      expiresAt,
      acceptedAt: null,
    })
    .onConflictDoUpdate({
      target: [
        workspaceInvitations.workspaceId,
        workspaceInvitations.emailNormalized,
      ],
      set: {
        email,
        role: input.role,
        tokenHash: hashToken(token),
        invitedBy: input.invitedBy,
        expiresAt,
        acceptedAt: null,
      },
    })
    .returning({
      id: workspaceInvitations.id,
      email: workspaceInvitations.email,
      role: workspaceInvitations.role,
      expiresAt: workspaceInvitations.expiresAt,
      createdAt: workspaceInvitations.createdAt,
    });

  const invitation = rows[0];
  if (!invitation) return { ok: false, error: "Could not create the invitation." };

  const delivery = await deliverInvitation({
    invitationId: invitation.id,
    email,
    workspaceName: input.workspaceName,
    inviterName: input.inviterName,
    token,
    expiresAt,
  });

  return {
    ok: true,
    invitation: {
      ...invitation,
      role: invitation.role as WorkspaceRole,
      expiresAt: invitation.expiresAt.toISOString(),
      createdAt: invitation.createdAt.toISOString(),
    },
    ...delivery,
  };
}

/** Build the accept link and send (best effort) the invitation mail. */
async function deliverInvitation(input: {
  invitationId: string;
  email: string;
  workspaceName: string;
  inviterName: string;
  token: string;
  expiresAt: Date;
}): Promise<{ url: string; emailSent: boolean; emailError: string | null }> {
  const origin = getServerEnv().BETTER_AUTH_URL.replace(/\/+$/, "");
  const url = `${origin}/invite/${encodeURIComponent(input.token)}`;
  const rendered = renderWorkspaceInviteEmail({
    workspaceName: input.workspaceName,
    inviterName: input.inviterName,
    url,
    expiresDays: 7,
  });
  const sent = await sendEmail({
    to: input.email,
    ...rendered,
    idempotencyKey: `invite-${input.invitationId}-${input.expiresAt.getTime()}`,
  });
  return { url, emailSent: sent.ok, emailError: sent.ok ? null : sent.error };
}

/**
 * Re-issue a pending invitation: a new token, a fresh seven-day expiry and a
 * new email. The row id is stable, so the settings list keeps its place while
 * the previous link stops working.
 */
export async function resendWorkspaceInvitation(input: {
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
  invitationId: string;
  invitedBy: string;
  inviterName: string;
}): Promise<CreateInvitationResult> {
  const existingRows = await db
    .select({
      email: workspaceInvitations.email,
      role: workspaceInvitations.role,
      acceptedAt: workspaceInvitations.acceptedAt,
    })
    .from(workspaceInvitations)
    .where(
      and(
        eq(workspaceInvitations.id, input.invitationId),
        eq(workspaceInvitations.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);
  const existing = existingRows[0];
  if (!existing) return { ok: false, error: "Invitation not found." };
  if (existing.acceptedAt) return { ok: false, error: "That invitation was already accepted." };

  const role = existing.role as WorkspaceRole;
  if (role !== "viewer") {
    const limit = await checkWorkspaceLimit(input.workspaceId, "members");
    if (!limit.allowed) {
      return limitFailure(
        limit.limit === null
          ? "The team limit is unavailable."
          : `Your plan allows ${limit.limit} paid team members. Upgrade to resend this invitation, or change it to a free viewer.`,
        input.workspaceSlug,
      );
    }
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const rows = await db
    .update(workspaceInvitations)
    .set({
      tokenHash: hashToken(token),
      expiresAt,
      invitedBy: input.invitedBy,
    })
    .where(
      and(
        eq(workspaceInvitations.id, input.invitationId),
        eq(workspaceInvitations.workspaceId, input.workspaceId),
        isNull(workspaceInvitations.acceptedAt),
      ),
    )
    .returning({
      id: workspaceInvitations.id,
      email: workspaceInvitations.email,
      role: workspaceInvitations.role,
      expiresAt: workspaceInvitations.expiresAt,
      createdAt: workspaceInvitations.createdAt,
    });
  const invitation = rows[0];
  if (!invitation) return { ok: false, error: "Invitation not found." };

  const delivery = await deliverInvitation({
    invitationId: invitation.id,
    email: invitation.email,
    workspaceName: input.workspaceName,
    inviterName: input.inviterName,
    token,
    expiresAt,
  });

  return {
    ok: true,
    invitation: {
      ...invitation,
      role: invitation.role as WorkspaceRole,
      expiresAt: invitation.expiresAt.toISOString(),
      createdAt: invitation.createdAt.toISOString(),
    },
    ...delivery,
  };
}

export async function revokeWorkspaceInvitation(input: {
  workspaceId: string;
  invitationId: string;
}): Promise<boolean> {
  const rows = await db
    .delete(workspaceInvitations)
    .where(
      and(
        eq(workspaceInvitations.id, input.invitationId),
        eq(workspaceInvitations.workspaceId, input.workspaceId),
      ),
    )
    .returning({ id: workspaceInvitations.id });
  return Boolean(rows[0]);
}

export type InvitationPreview = {
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
  email: string;
  role: WorkspaceRole;
  expiresAt: string;
  acceptedAt: string | null;
};

export async function getInvitationPreview(
  token: string,
): Promise<InvitationPreview | null> {
  if (!token || token.length > 200) return null;
  const rows = await db
    .select({
      workspaceId: workspaceInvitations.workspaceId,
      workspaceSlug: workspaces.slug,
      workspaceName: workspaces.name,
      email: workspaceInvitations.email,
      role: workspaceInvitations.role,
      expiresAt: workspaceInvitations.expiresAt,
      acceptedAt: workspaceInvitations.acceptedAt,
    })
    .from(workspaceInvitations)
    .innerJoin(workspaces, eq(workspaceInvitations.workspaceId, workspaces.id))
    .where(eq(workspaceInvitations.tokenHash, hashToken(token)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return {
    ...row,
    role: row.role as WorkspaceRole,
    expiresAt: row.expiresAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
  };
}

export async function acceptWorkspaceInvitation(input: {
  token: string;
  userId: string;
  userEmail: string;
}): Promise<{ ok: true; workspaceSlug: string } | { ok: false; error: string }> {
  const preview = await getInvitationPreview(input.token);
  if (!preview) return { ok: false, error: "This invitation is not valid." };
  if (preview.acceptedAt) return { ok: false, error: "This invitation was already used." };
  if (new Date(preview.expiresAt).getTime() <= Date.now()) {
    return { ok: false, error: "This invitation has expired. Ask an owner for a new one." };
  }
  if (normalizeEmail(input.userEmail) !== normalizeEmail(preview.email)) {
    return {
      ok: false,
      error: "Sign in with the email address this invitation was sent to.",
    };
  }

  const existing = await db
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, preview.workspaceId),
        eq(workspaceMembers.userId, input.userId),
      ),
    )
    .limit(1);

  if (!existing[0] && preview.role !== "viewer") {
    const limit = await checkWorkspaceLimit(preview.workspaceId, "members");
    if (!limit.allowed) {
      return {
        ok: false,
        error: "This workspace has reached its paid team-member limit.",
      };
    }
  }

  await db.transaction(async (tx) => {
    if (!existing[0]) {
      await tx
        .insert(workspaceMembers)
        .values({
          workspaceId: preview.workspaceId,
          userId: input.userId,
          role: preview.role,
        })
        .onConflictDoNothing();
    }

    await tx
      .update(workspaceInvitations)
      .set({ acceptedAt: new Date() })
      .where(
        and(
          eq(workspaceInvitations.tokenHash, hashToken(input.token)),
          eq(workspaceInvitations.workspaceId, preview.workspaceId),
          isNull(workspaceInvitations.acceptedAt),
        ),
      );
  });

  return { ok: true, workspaceSlug: preview.workspaceSlug };
}

const LAST_OWNER_ERROR =
  "A workspace needs at least one owner. Transfer ownership to another member first.";

const LAST_MANAGER_ERROR =
  "A workspace needs at least one owner or admin. Promote another member before changing this one.";

/**
 * Count the owners with the rows locked, so two owners demoting each other at the
 * same moment cannot both see two and leave the workspace with none. The lock
 * order is fixed by id to keep concurrent transactions from deadlocking.
 */
async function lockOwnerCount(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  workspaceId: string,
): Promise<number> {
  const rows = await tx
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(
      and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.role, "owner")),
    )
    .orderBy(asc(workspaceMembers.id))
    .for("update");
  return rows.length;
}

/**
 * The "last admin leaves" backstop. Owners always hold `settings:manage`, so
 * with the owner guard above this can only fire on a workspace that already has
 * no owner — but the lockout it prevents is unrecoverable from inside the app,
 * so it is checked separately rather than assumed.
 */
async function lockManagerCount(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  workspaceId: string,
): Promise<number> {
  const rows = await tx
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        inArray(workspaceMembers.role, ["owner", "admin"]),
      ),
    )
    .orderBy(asc(workspaceMembers.id))
    .for("update");
  return rows.length;
}

export type ChangeRoleResult =
  | {
      ok: true;
      previousRole: WorkspaceRole;
      memberEmail: string;
      tokensRevoked: number;
    }
  | { ok: false; error: string; billingUrl?: string };

/** Owners can change admin/editor/viewer roles; the last owner cannot be demoted. */
export async function changeWorkspaceMemberRole(input: {
  workspaceId: string;
  workspaceSlug?: string;
  memberId: string;
  role: WorkspaceRole;
  actorUserId: string;
}): Promise<ChangeRoleResult> {
  if (!isWorkspaceRole(input.role)) return { ok: false, error: "Choose a valid role." };

  // A viewer is a free seat. Promoting one to admin or editor consumes a paid
  // seat, so it has to pass the same member allowance as an invitation.
  const current = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.id, input.memberId),
        eq(workspaceMembers.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);
  if (current[0]?.role === "viewer" && input.role !== "viewer") {
    const limit = await checkWorkspaceLimit(input.workspaceId, "members");
    if (!limit.allowed) {
      return {
        ok: false,
        error:
          limit.limit === null
            ? "The team limit is unavailable."
            : `Your plan allows ${limit.limit} paid team members. Upgrade before promoting this viewer.`,
        ...(input.workspaceSlug
          ? { billingUrl: billingSettingsPath(input.workspaceSlug) }
          : {}),
      };
    }
  }

  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        userId: workspaceMembers.userId,
        role: workspaceMembers.role,
        email: user.email,
      })
      .from(workspaceMembers)
      .innerJoin(user, eq(workspaceMembers.userId, user.id))
      .where(
        and(
          eq(workspaceMembers.id, input.memberId),
          eq(workspaceMembers.workspaceId, input.workspaceId),
        ),
      )
      .for("update")
      .limit(1);
    const member = rows[0];
    if (!member) return { ok: false as const, error: "Member not found." };

    if (member.role === "owner" && input.role !== "owner") {
      if (member.userId === input.actorUserId) {
        return {
          ok: false as const,
          error: "You cannot change your own owner role. Transfer ownership to another member instead.",
        };
      }
      if ((await lockOwnerCount(tx, input.workspaceId)) <= 1) {
        return { ok: false as const, error: LAST_OWNER_ERROR };
      }
    }

    if (
      (input.role === "editor" || input.role === "viewer") &&
      (member.role === "owner" || member.role === "admin") &&
      (await lockManagerCount(tx, input.workspaceId)) <= 1
    ) {
      return { ok: false as const, error: LAST_MANAGER_ERROR };
    }

    await tx
      .update(workspaceMembers)
      .set({ role: input.role, updatedAt: new Date() })
      .where(
        and(
          eq(workspaceMembers.id, input.memberId),
          eq(workspaceMembers.workspaceId, input.workspaceId),
        ),
      );

    // Losing settings access also loses the API keys that were minted with it.
    const tokensRevoked =
      input.role === "owner" || input.role === "admin"
        ? []
        : await revokeApiTokensCreatedBy(tx, {
            workspaceId: input.workspaceId,
            userId: member.userId,
            reason: "settings:manage removed",
          });

    return {
      ok: true as const,
      previousRole: member.role as WorkspaceRole,
      memberEmail: member.email,
      tokensRevoked: tokensRevoked.length,
    };
  });
}

export type RemoveMemberResult =
  | { ok: true; memberEmail: string; role: WorkspaceRole; tokensRevoked: number }
  | { ok: false; error: string };

export async function removeWorkspaceMember(input: {
  workspaceId: string;
  memberId: string;
  actorUserId: string;
}): Promise<RemoveMemberResult> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        userId: workspaceMembers.userId,
        role: workspaceMembers.role,
        email: user.email,
      })
      .from(workspaceMembers)
      .innerJoin(user, eq(workspaceMembers.userId, user.id))
      .where(
        and(
          eq(workspaceMembers.id, input.memberId),
          eq(workspaceMembers.workspaceId, input.workspaceId),
        ),
      )
      .for("update")
      .limit(1);
    const member = rows[0];
    if (!member) return { ok: false as const, error: "Member not found." };
    if (member.userId === input.actorUserId) {
      return { ok: false as const, error: "You cannot remove yourself. Ask another owner to do it." };
    }
    if (member.role === "owner" && (await lockOwnerCount(tx, input.workspaceId)) <= 1) {
      return { ok: false as const, error: LAST_OWNER_ERROR };
    }
    if (
      (member.role === "owner" || member.role === "admin") &&
      (await lockManagerCount(tx, input.workspaceId)) <= 1
    ) {
      return { ok: false as const, error: LAST_MANAGER_ERROR };
    }

    const tokensRevoked = await revokeApiTokensCreatedBy(tx, {
      workspaceId: input.workspaceId,
      userId: member.userId,
      reason: "membership removed",
    });

    await tx
      .delete(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.id, input.memberId),
          eq(workspaceMembers.workspaceId, input.workspaceId),
        ),
      );
    return {
      ok: true as const,
      memberEmail: member.email,
      role: member.role as WorkspaceRole,
      tokensRevoked: tokensRevoked.length,
    };
  });
}
