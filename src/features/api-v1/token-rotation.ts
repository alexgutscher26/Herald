import "server-only";

import { and, eq, gt, isNull, or } from "drizzle-orm";

import { db } from "@/db";
import { apiTokens, type ApiScope } from "@/db/schema";

import { createApiTokenMaterial } from "./token";

/**
 * Rotate a workspace token without downtime.
 *
 * A new token with the same name and scopes is created first; the old row gets
 * a future `revoked_at`, so both authenticate until the grace period ends.
 * Callers return the new raw token once and never store it.
 */

const MAX_GRACE_HOURS = 168;

export type RotatedApiToken = {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiScope[];
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date | null;
  rotatedFromId: string | null;
  createdAt: Date;
};

export async function rotateApiToken(input: {
  workspaceId: string;
  userId: string | null;
  tokenId: string;
  graceHours?: number;
}): Promise<
  | { ok: true; token: string; apiToken: RotatedApiToken; previousRetiresAt: Date }
  | { ok: false; code: "not_found" | "already_retired"; error: string }
> {
  const graceHours = Math.min(
    Math.max(Math.trunc(input.graceHours ?? 24), 0),
    MAX_GRACE_HOURS,
  );
  const now = new Date();

  const rows = await db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      scopes: apiTokens.scopes,
      prefix: apiTokens.prefix,
      expiresAt: apiTokens.expiresAt,
    })
    .from(apiTokens)
    .where(
      and(
        eq(apiTokens.id, input.tokenId),
        eq(apiTokens.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);

  const previous = rows[0];
  if (!previous) {
    return { ok: false, code: "not_found", error: "Token not found." };
  }

  // A token already inside its grace period can still be replaced, but one
  // that has fully retired cannot be revived by rotating it.
  const expiredRows = await db
    .select({ id: apiTokens.id })
    .from(apiTokens)
    .where(
      and(
        eq(apiTokens.id, previous.id),
        or(isNull(apiTokens.revokedAt), gt(apiTokens.revokedAt, now)),
        or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, now)),
      ),
    )
    .limit(1);
  if (!expiredRows[0]) {
    return {
      ok: false,
      code: "already_retired",
      error: "That token has already been revoked; create a new one instead.",
    };
  }

  const graceMs = graceHours * 60 * 60 * 1000;
  const previousRetiresAt = new Date(now.getTime() + graceMs);
  const material = createApiTokenMaterial();

  const created = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(apiTokens)
      .values({
        workspaceId: input.workspaceId,
        name: previous.name,
        tokenHash: material.tokenHash,
        prefix: material.prefix,
        scopes: previous.scopes,
        createdBy: input.userId,
        rotatedFromId: previous.id,
      })
      .returning({
        id: apiTokens.id,
        name: apiTokens.name,
        prefix: apiTokens.prefix,
        scopes: apiTokens.scopes,
        lastUsedAt: apiTokens.lastUsedAt,
        revokedAt: apiTokens.revokedAt,
        expiresAt: apiTokens.expiresAt,
        rotatedFromId: apiTokens.rotatedFromId,
        createdAt: apiTokens.createdAt,
      });

    await tx
      .update(apiTokens)
      .set({ revokedAt: previousRetiresAt, updatedAt: now })
      .where(
        and(
          eq(apiTokens.id, previous.id),
          eq(apiTokens.workspaceId, input.workspaceId),
        ),
      );

    return inserted[0];
  });

  if (!created) throw new Error("Rotated token insert returned no row.");

  return {
    ok: true,
    token: material.token,
    apiToken: created,
    previousRetiresAt,
  };
}
