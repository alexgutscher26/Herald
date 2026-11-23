import "server-only";

import { and, eq, gt, isNull, or } from "drizzle-orm";

import { db } from "@/db";
import { apiTokens } from "@/db/schema";

/**
 * API tokens are credentials for the person who minted them, not for the
 * workspace forever. When that person loses `settings:manage` (demoted, removed
 * or deprovisioned) the tokens they created must stop working, otherwise a
 * former admin keeps an unattended key with no membership behind it.
 *
 * Only the creator's tokens in that workspace are touched: a token someone else
 * minted is theirs to revoke. Rows are kept so the audit view still shows what
 * existed and when it stopped.
 */

export type TokenTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function revokeApiTokensCreatedBy(
  tx: TokenTransaction,
  input: { workspaceId: string; userId: string; reason: string },
): Promise<string[]> {
  const now = new Date();
  const rows = await tx
    .update(apiTokens)
    .set({ revokedAt: now, updatedAt: now })
    .where(
      and(
        eq(apiTokens.workspaceId, input.workspaceId),
        eq(apiTokens.createdBy, input.userId),
        // A token already revoked in the past stays as it was; a retiring one is
        // stopped now rather than being allowed its remaining grace period.
        or(isNull(apiTokens.revokedAt), gt(apiTokens.revokedAt, now)),
      ),
    )
    .returning({ id: apiTokens.id });
  return rows.map((row) => row.id);
}

/** The same revocation for callers that are not already inside a transaction. */
export async function revokeApiTokensForLostAccess(input: {
  workspaceId: string;
  userId: string;
  reason: string;
}): Promise<string[]> {
  return db.transaction((tx) =>
    revokeApiTokensCreatedBy(tx, {
      workspaceId: input.workspaceId,
      userId: input.userId,
      reason: input.reason,
    }),
  );
}
