import "server-only";

import { randomUUID } from "node:crypto";

import { and, asc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { session, user } from "@/db/schema/auth";
import { conversations } from "@/db/schema/conversations";
import { workspaceMembers } from "@/db/schema/workspaces";
import { recordWorkspaceAudit } from "@/features/data-controls/service";
import { checkWorkspaceLimit } from "@/features/entitlements/entitlements";
import { normalizeEmail } from "@/lib/email";
import { hasPermission, isWorkspaceRole, type WorkspaceRole } from "@/lib/permissions";
import { revokeApiTokensCreatedBy } from "@/features/workspace-settings/token-revocation";

import { isScimAssignableRole } from "./policy";

/**
 * SCIM 2.0 user provisioning, scoped by the bearer token's workspace.
 *
 * Member ids (not Better Auth user ids) are the SCIM resource ids, so a
 * directory cannot address a user who is not a member of this workspace.
 * Deactivation removes the membership; the Better Auth user row is retained so
 * an audit trail and authored content stay intact.
 */

export class ScimError extends Error {
  readonly status: number;
  readonly scimType: string | null;

  constructor(status: number, message: string, scimType: string | null = null) {
    super(message);
    this.name = "ScimError";
    this.status = status;
    this.scimType = scimType;
  }
}

export type ScimUser = {
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"];
  id: string;
  userName: string;
  name: { givenName: string; familyName: string; formatted: string };
  displayName: string;
  active: boolean;
  emails: Array<{ value: string; primary: true }>;
  roles: Array<{ value: WorkspaceRole; primary: true }>;
  meta: { resourceType: "User"; location: string };
};

type ScimRow = {
  id: string;
  userId: string;
  role: WorkspaceRole;
  name: string;
  email: string;
};

function splitName(name: string): { givenName: string; familyName: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { givenName: "", familyName: "" };
  if (parts.length === 1) return { givenName: parts[0] ?? "", familyName: "" };
  return {
    givenName: parts.slice(0, -1).join(" "),
    familyName: parts[parts.length - 1] ?? "",
  };
}

function toScimUser(row: ScimRow, workspaceSlug: string): ScimUser {
  const name = splitName(row.name);
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    id: row.id,
    userName: row.email,
    name: { ...name, formatted: row.name },
    displayName: row.name,
    active: true,
    emails: [{ value: row.email, primary: true }],
    roles: [{ value: row.role, primary: true }],
    meta: {
      resourceType: "User",
      location: `/api/scim/v2/${encodeURIComponent(workspaceSlug)}/Users/${row.id}`,
    },
  };
}

async function listRows(workspaceId: string): Promise<ScimRow[]> {
  const rows = await db
    .select({
      id: workspaceMembers.id,
      userId: workspaceMembers.userId,
      role: workspaceMembers.role,
      name: user.name,
      email: user.email,
    })
    .from(workspaceMembers)
    .innerJoin(user, eq(workspaceMembers.userId, user.id))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(asc(user.email));
  return rows.map((row) => ({ ...row, role: row.role as WorkspaceRole }));
}

export async function listScimUsers(workspaceId: string, workspaceSlug: string) {
  const rows = await listRows(workspaceId);
  return {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"] as const,
    totalResults: rows.length,
    startIndex: 1,
    itemsPerPage: rows.length,
    Resources: rows.map((row) => toScimUser(row, workspaceSlug)),
  };
}

export async function getScimUser(
  workspaceId: string,
  memberId: string,
  workspaceSlug: string,
): Promise<ScimUser | null> {
  const rows = await db
    .select({
      id: workspaceMembers.id,
      userId: workspaceMembers.userId,
      role: workspaceMembers.role,
      name: user.name,
      email: user.email,
    })
    .from(workspaceMembers)
    .innerJoin(user, eq(workspaceMembers.userId, user.id))
    .where(
      and(eq(workspaceMembers.id, memberId), eq(workspaceMembers.workspaceId, workspaceId)),
    )
    .limit(1);
  const row = rows[0];
  return row ? toScimUser({ ...row, role: row.role as WorkspaceRole }, workspaceSlug) : null;
}

export async function findScimUserByEmail(
  workspaceId: string,
  email: string,
  workspaceSlug: string,
): Promise<ScimUser | null> {
  const rows = await db
    .select({
      id: workspaceMembers.id,
      userId: workspaceMembers.userId,
      role: workspaceMembers.role,
      name: user.name,
      email: user.email,
    })
    .from(workspaceMembers)
    .innerJoin(user, eq(workspaceMembers.userId, user.id))
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(sql`lower(${user.email})`, normalizeEmail(email)),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row ? toScimUser({ ...row, role: row.role as WorkspaceRole }, workspaceSlug) : null;
}

export type ScimUserInput = {
  userName: string;
  givenName?: string | undefined;
  familyName?: string | undefined;
  active?: boolean | undefined;
  role?: string | undefined;
};

export async function createScimUser(input: {
  workspaceId: string;
  workspaceSlug: string;
  user: ScimUserInput;
}): Promise<ScimUser> {
  const emailNormalized = normalizeEmail(input.user.userName);
  if (!emailNormalized.includes("@")) {
    throw new ScimError(400, "userName must be an email address.", "invalidValue");
  }
  if (input.user.active === false) {
    throw new ScimError(
      400,
      "Inactive users cannot be provisioned. Create the user active, then deactivate it.",
      "invalidValue",
    );
  }

  const role = input.user.role ?? "viewer";
  if (!isWorkspaceRole(role) || !isScimAssignableRole(role)) {
    throw new ScimError(400, "role must be admin, editor or viewer.", "invalidValue");
  }

  const name =
    [input.user.givenName?.trim(), input.user.familyName?.trim()]
      .filter(Boolean)
      .join(" ")
      .trim() || input.user.userName.trim();

  const existingUser = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(sql`lower(${user.email})`, emailNormalized))
    .limit(1);

  let userId = existingUser[0]?.id;
  if (!userId) {
    const limit = role !== "viewer"
      ? await checkWorkspaceLimit(input.workspaceId, "members")
      : { allowed: true as const };
    if (!limit.allowed) {
      throw new ScimError(403, "The workspace has reached its paid member limit.", "tooMany");
    }
    userId = randomUUID();
    try {
      await db.insert(user).values({
        id: userId,
        name,
        email: input.user.userName.trim(),
        emailVerified: false,
      });
    } catch {
      throw new ScimError(409, "A user with that email already exists.", "uniqueness");
    }
  }

  const existingMembership = await db
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(
      and(eq(workspaceMembers.workspaceId, input.workspaceId), eq(workspaceMembers.userId, userId)),
    )
    .limit(1);

  if (existingMembership[0]) {
    await db
      .update(workspaceMembers)
      .set({ role, updatedAt: new Date() })
      .where(eq(workspaceMembers.id, existingMembership[0].id));
  } else {
    const limit = role !== "viewer"
      ? await checkWorkspaceLimit(input.workspaceId, "members")
      : { allowed: true as const };
    if (!limit.allowed) {
      throw new ScimError(403, "The workspace has reached its paid member limit.", "tooMany");
    }
    await db.insert(workspaceMembers).values({
      workspaceId: input.workspaceId,
      userId,
      role,
    });
  }

  const result = await findScimUserByEmail(
    input.workspaceId,
    input.user.userName,
    input.workspaceSlug,
  );
  if (!result) throw new ScimError(500, "The user was created but could not be read back.");
  return result;
}

/**
 * The SCIM operator to hand the departing member's open conversations to.
 *
 * The token's creator is used only while they still administer the workspace;
 * a revoked or demoted operator would otherwise inherit work they can no longer
 * see. With no such operator the conversations are unassigned, which puts them
 * back in the shared queue instead of hiding them behind a departed user.
 */
async function resolveReassignTarget(
  workspaceId: string,
  actorUserId: string | null | undefined,
  departingUserId: string,
): Promise<string | null> {
  if (!actorUserId || actorUserId === departingUserId) return null;
  const rows = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, actorUserId),
      ),
    )
    .limit(1);
  const role = rows[0]?.role;
  return role === "owner" || role === "admin" ? actorUserId : null;
}

/**
 * Deprovision one member, as SCIM DELETE or `active: false` asks.
 *
 * Removing the membership alone is not enough to end access: a live session
 * would keep working until it expired, and open conversations would stay
 * assigned to somebody who is gone. This revokes the sessions, hands the work
 * on (or back to the queue), then removes the membership — in one transaction,
 * so a failure leaves the member fully provisioned rather than half-departed.
 * The last owner is refused, because a workspace without an owner has nobody
 * who can fix it.
 */
async function deprovisionScimMember(input: {
  workspaceId: string;
  memberId: string;
  actorUserId: string | null;
}): Promise<boolean> {
  const rows = await db
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
    .limit(1);
  const member = rows[0];
  if (!member) return false;

  if (member.role === "owner") {
    const owners = await db
      .select({ id: workspaceMembers.id })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, input.workspaceId),
          eq(workspaceMembers.role, "owner"),
        ),
      );
    if (owners.length <= 1) {
      throw new ScimError(
        409,
        "The last owner cannot be deprovisioned. Transfer ownership first.",
        "mutability",
      );
    }
  }

  const reassignTo = await resolveReassignTarget(
    input.workspaceId,
    input.actorUserId,
    member.userId,
  );

  const tokensRevoked = await db.transaction(async (tx) => {
    await tx
      .update(conversations)
      .set({ assigneeId: reassignTo, updatedAt: new Date() })
      .where(
        and(
          eq(conversations.workspaceId, input.workspaceId),
          eq(conversations.assigneeId, member.userId),
        ),
      );
    await tx.delete(session).where(eq(session.userId, member.userId));
    // Credentials minted with settings access die with the membership.
    const revoked = await revokeApiTokensCreatedBy(tx, {
      workspaceId: input.workspaceId,
      userId: member.userId,
      reason: "scim deprovisioned",
    });
    await tx
      .delete(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.id, input.memberId),
          eq(workspaceMembers.workspaceId, input.workspaceId),
        ),
      );
    return revoked.length;
  });

  await recordWorkspaceAudit({
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    action: "member.removed",
    targetType: "member",
    targetId: input.memberId,
    metadata: {
      memberEmail: member.email,
      role: member.role,
      source: "scim",
      sessionsRevoked: true,
      tokensRevoked,
      reassigned: reassignTo ? "scim_operator" : "unassigned",
    },
  });

  return true;
}

export type ScimPatch = {
  active?: boolean;
  userName?: string;
  givenName?: string;
  familyName?: string;
  role?: string;
};

export async function patchScimUser(input: {
  workspaceId: string;
  workspaceSlug: string;
  memberId: string;
  patch: ScimPatch;
  /** The token owner, for the audit row and for handing work on. */
  actorUserId?: string | null;
}): Promise<ScimUser | { id: string; active: false }> {
  const current = await db
    .select({ userId: workspaceMembers.userId, role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.id, input.memberId),
        eq(workspaceMembers.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);
  const member = current[0];
  if (!member) throw new ScimError(404, "User not found.");

  if (input.patch.active === false) {
    const deprovisioned = await deprovisionScimMember({
      workspaceId: input.workspaceId,
      memberId: input.memberId,
      actorUserId: input.actorUserId ?? null,
    });
    if (!deprovisioned) throw new ScimError(404, "User not found.");
    return { id: input.memberId, active: false };
  }

  if (input.patch.role !== undefined) {
    if (!isScimAssignableRole(input.patch.role)) {
      throw new ScimError(400, "role must be admin, editor or viewer.", "invalidValue");
    }
    if (member.role !== input.patch.role && input.patch.role !== "viewer") {
      const limit = await checkWorkspaceLimit(input.workspaceId, "members");
      if (!limit.allowed) {
        throw new ScimError(403, "The workspace has reached its paid member limit.", "tooMany");
      }
    }
    const nextRole = input.patch.role as WorkspaceRole;
    // A demotion that removes settings access also stops the tokens that
    // person minted; otherwise a directory-managed demotion leaves a live key.
    const tokensRevoked = await db.transaction(async (tx) => {
      await tx
        .update(workspaceMembers)
        .set({ role: nextRole, updatedAt: new Date() })
        .where(eq(workspaceMembers.id, input.memberId));
      if (hasPermission(nextRole, "settings:manage")) return 0;
      const revoked = await revokeApiTokensCreatedBy(tx, {
        workspaceId: input.workspaceId,
        userId: member.userId,
        reason: "settings:manage removed",
      });
      return revoked.length;
    });

    if (member.role !== input.patch.role) {
      const emailRows = await db
        .select({ email: user.email })
        .from(user)
        .where(eq(user.id, member.userId))
        .limit(1);
      await recordWorkspaceAudit({
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId ?? null,
        action: "member.role_changed",
        targetType: "member",
        targetId: input.memberId,
        metadata: {
          role: input.patch.role,
          previousRole: member.role,
          memberEmail: emailRows[0]?.email ?? "",
          tokensRevoked,
          source: "scim",
        },
      });
    }
  }

  if (input.patch.userName) {
    const email = input.patch.userName.trim();
    if (!normalizeEmail(email).includes("@")) {
      throw new ScimError(400, "userName must be an email address.", "invalidValue");
    }
    try {
      await db
        .update(user)
        .set({ email, updatedAt: new Date() })
        .where(eq(user.id, member.userId));
    } catch {
      throw new ScimError(409, "A user with that email already exists.", "uniqueness");
    }
  }

  const nameParts = [input.patch.givenName, input.patch.familyName].filter(
    (part): part is string => typeof part === "string",
  );
  if (nameParts.length > 0) {
    const existing = await db
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, member.userId))
      .limit(1);
    const currentParts = splitName(existing[0]?.name ?? "");
    const givenName = input.patch.givenName ?? currentParts.givenName;
    const familyName = input.patch.familyName ?? currentParts.familyName;
    await db
      .update(user)
      .set({
        name: [givenName, familyName].filter(Boolean).join(" ").trim() || existing[0]?.name || "",
        updatedAt: new Date(),
      })
      .where(eq(user.id, member.userId));
  }

  const result = await getScimUser(input.workspaceId, input.memberId, input.workspaceSlug);
  if (!result) throw new ScimError(404, "User not found.");
  return result;
}

export async function deleteScimUser(
  workspaceId: string,
  memberId: string,
  actorUserId: string | null = null,
): Promise<boolean> {
  return deprovisionScimMember({ workspaceId, memberId, actorUserId });
}
