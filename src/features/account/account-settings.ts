import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { account } from "@/db/schema/auth";
import { workspaceMembers, workspaces } from "@/db/schema/workspaces";

/**
 * Account-level settings that are not owned by Better Auth.
 *
 * Account deletion removes the `user` row, which cascades to sessions, linked
 * accounts and every `workspace_members` row. Workspaces themselves are not
 * cascaded — that is deliberate, because deleting a workspace is a separate,
 * audited flow with a grace period. The guard below is what stops an account
 * deletion from silently orphaning a workspace.
 */

export type AccountDeletionBlocker = {
  workspaceId: string;
  name: string;
  slug: string;
};

/**
 * Workspaces that would be left with no owner if this account were deleted.
 *
 * A user who owns a workspace together with someone else can leave: the other
 * owner keeps it. A sole owner must transfer ownership (or delete the
 * workspace) first, otherwise the workspace would keep its data but lose the
 * only person able to administer it.
 */
export async function listAccountDeletionBlockers(
  userId: string,
): Promise<AccountDeletionBlocker[]> {
  const owned = await db
    .select({
      workspaceId: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(
      and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.role, "owner")),
    );

  if (owned.length === 0) return [];

  const owners = await db
    .select({
      workspaceId: workspaceMembers.workspaceId,
      userId: workspaceMembers.userId,
    })
    .from(workspaceMembers)
    .where(
      and(
        inArray(
          workspaceMembers.workspaceId,
          owned.map((row) => row.workspaceId),
        ),
        eq(workspaceMembers.role, "owner"),
      ),
    );

  const ownerCounts = new Map<string, number>();
  for (const row of owners) {
    ownerCounts.set(row.workspaceId, (ownerCounts.get(row.workspaceId) ?? 0) + 1);
  }

  return owned.filter((row) => (ownerCounts.get(row.workspaceId) ?? 0) <= 1);
}

export type AccountSecuritySummary = {
  /** False for accounts that only sign in through SSO. */
  hasPassword: boolean;
};

export async function getAccountSecuritySummary(
  userId: string,
): Promise<AccountSecuritySummary> {
  const rows = await db
    .select({ password: account.password })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "credential")))
    .limit(1);

  return { hasPassword: Boolean(rows[0]?.password) };
}
