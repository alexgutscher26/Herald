import "server-only";

import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { apiTokens } from "@/db/schema";

/**
 * Token listings for the workspace settings page.
 *
 * Kept out of the server-actions module: every export from a `"use server"`
 * file is callable by the browser, and a listing helper must not be. The page
 * authorizes the workspace before calling this function.
 */
export async function listWorkspaceTokens(workspaceId: string) {
  return db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      prefix: apiTokens.prefix,
      scopes: apiTokens.scopes,
      createdAt: apiTokens.createdAt,
      revokedAt: apiTokens.revokedAt,
      expiresAt: apiTokens.expiresAt,
      lastUsedAt: apiTokens.lastUsedAt,
      lastUsedIpPrefix: apiTokens.lastUsedIpPrefix,
      lastUsedUserAgent: apiTokens.lastUsedUserAgent,
    })
    .from(apiTokens)
    .where(eq(apiTokens.workspaceId, workspaceId))
    .orderBy(desc(apiTokens.createdAt));
}
