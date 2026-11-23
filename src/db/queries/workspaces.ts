import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { user } from "@/db/schema/auth";
import { workspaceMemberCustomRoles, workspaceCustomRoles } from "@/db/schema/enterprise";
import { products, workspaceMembers, workspaces } from "@/db/schema";
import type { Product, Workspace, WorkspaceRoleValue } from "@/db/schema";
import { resolveEffectivePermissions, type Permission } from "@/lib/permissions";

/**
 * Tenant-scoped data access.
 *
 * Every query here takes an explicit `userId` or `workspaceId` as its first
 * scoping argument — never a client-supplied identifier on its own. Cross
 * tenant reads are impossible without passing the scope that was already
 * validated by `src/lib/authz.ts`.
 */

export type WorkspaceWithRole = {
  workspace: Workspace;
  role: WorkspaceRoleValue;
  /** Resolved custom role, when a member has one assigned. */
  customRoleId?: string | null;
  customRoleName?: string | null;
  /** Base role ∪ custom role. Always resolved on the server. */
  effectivePermissions?: readonly Permission[];
};

/** Workspaces the user belongs to, ordered by creation for a stable switcher. */
export async function listWorkspacesForUser(userId: string): Promise<WorkspaceWithRole[]> {
  const rows = await db
    .select({ workspace: workspaces, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(asc(workspaces.createdAt));

  return rows.map((row) => ({ workspace: row.workspace, role: row.role }));
}

/** Resolve a workspace by slug *and* the user's membership in one query. */
export async function findMembershipBySlug(
  workspaceSlug: string,
  userId: string,
): Promise<WorkspaceWithRole | null> {
  const rows = await db
    .select({
      workspace: workspaces,
      role: workspaceMembers.role,
      customRoleId: workspaceCustomRoles.id,
      customRoleName: workspaceCustomRoles.name,
      customPermissions: workspaceCustomRoles.permissions,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .leftJoin(
      workspaceMemberCustomRoles,
      and(
        eq(workspaceMemberCustomRoles.workspaceId, workspaceMembers.workspaceId),
        eq(workspaceMemberCustomRoles.userId, workspaceMembers.userId),
      ),
    )
    .leftJoin(
      workspaceCustomRoles,
      and(
        eq(workspaceCustomRoles.id, workspaceMemberCustomRoles.customRoleId),
        eq(workspaceCustomRoles.workspaceId, workspaceMembers.workspaceId),
      ),
    )
    .where(and(eq(workspaces.slug, workspaceSlug), eq(workspaceMembers.userId, userId)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return {
    workspace: row.workspace,
    role: row.role,
    customRoleId: row.customRoleId,
    customRoleName: row.customRoleName,
    effectivePermissions: resolveEffectivePermissions(row.role, row.customPermissions),
  };
}

export async function listProductsForWorkspace(workspaceId: string): Promise<Product[]> {
  return db
    .select()
    .from(products)
    .where(eq(products.workspaceId, workspaceId))
    .orderBy(asc(products.createdAt));
}

/**
 * Resolve a product *inside an already-authorized workspace*. The workspace
 * constraint is part of the WHERE clause, so a slug from another tenant can
 * never match.
 */
export async function findProductInWorkspace(
  workspaceId: string,
  productSlug: string,
): Promise<Product | null> {
  const rows = await db
    .select()
    .from(products)
    .where(and(eq(products.workspaceId, workspaceId), eq(products.slug, productSlug)))
    .limit(1);

  return rows[0] ?? null;
}

export type WorkspaceTeamMember = {
  id: string;
  name: string;
  email: string;
  role: WorkspaceRoleValue;
};

/** Teammates in one workspace, for changelog author credits. */
export async function listWorkspaceTeamMembers(
  workspaceId: string,
): Promise<WorkspaceTeamMember[]> {
  return db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(user, eq(workspaceMembers.userId, user.id))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(asc(user.name), asc(user.email));
}

export type WorkspaceSummary = WorkspaceWithRole & { products: Product[] };

/** Everything the workspace/product switcher needs for one user. */
export async function listWorkspaceSummaries(userId: string): Promise<WorkspaceSummary[]> {
  const memberships = await listWorkspacesForUser(userId);
  const summaries: WorkspaceSummary[] = [];

  for (const membership of memberships) {
    summaries.push({
      ...membership,
      products: await listProductsForWorkspace(membership.workspace.id),
    });
  }

  return summaries;
}