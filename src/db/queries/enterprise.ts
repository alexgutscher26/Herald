import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { account } from "@/db/schema/auth";
import { workspaceEnterpriseIdentity, workspaceScimTokens } from "@/db/schema/enterprise";
import { ssoAccessDecision } from "@/features/enterprise/policy";

/**
 * True when an enforced-SSO workspace must turn this user away.
 *
 * A user with a live session but no linked account for the workspace's SAML
 * provider is sent back to sign-in. Disabling enforcement (or removing the
 * provider) immediately restores the password path — the downgrade is a single
 * stored flag, not a migration.
 */
export async function isEnterpriseSsoRequired(
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const rows = await db
    .select({
      enforced: workspaceEnterpriseIdentity.enforced,
      providerId: workspaceEnterpriseIdentity.providerId,
    })
    .from(workspaceEnterpriseIdentity)
    .where(eq(workspaceEnterpriseIdentity.workspaceId, workspaceId))
    .limit(1);

  const settings = rows[0];
  if (!settings?.enforced || !settings.providerId) return false;

  const linked = await db
    .select({ id: account.id })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, settings.providerId)))
    .limit(1);

  return (
    ssoAccessDecision({
      enforced: settings.enforced,
      providerId: settings.providerId,
      hasLinkedAccount: Boolean(linked[0]),
    }) === "sso_required"
  );
}

/** Whether an actor can still get in after enforcement is switched on. */
export async function hasLinkedSamlAccount(
  userId: string,
  providerId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: account.id })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, providerId)))
    .limit(1);
  return Boolean(rows[0]);
}

/** Revoked SCIM tokens stay in the table for auditability. */
export async function listActiveScimTokens(workspaceId: string) {
  return db
    .select()
    .from(workspaceScimTokens)
    .where(
      and(
        eq(workspaceScimTokens.workspaceId, workspaceId),
        isNull(workspaceScimTokens.revokedAt),
      ),
    );
}
