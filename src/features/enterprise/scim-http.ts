import "server-only";

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { workspaces } from "@/db/schema/workspaces";

import { authenticateScimToken } from "./identity";

export const SCIM_CONTENT_TYPE = "application/scim+json";

export function scimJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "content-type": SCIM_CONTENT_TYPE, "cache-control": "private, no-store" },
  });
}

export function scimError(
  status: number,
  detail: string,
  scimType: string | null = null,
): NextResponse {
  return scimJson(
    {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      detail,
      status: String(status),
      ...(scimType ? { scimType } : {}),
    },
    status,
  );
}

/**
 * Resolve the bearer token to its workspace and require it to be the workspace
 * in the URL. A valid token from tenant A can never read or mutate tenant B.
 */
export async function authorizeScimRequest(
  request: Request,
  workspaceSlug: string,
): Promise<{ workspaceId: string; actorUserId: string | null } | { response: NextResponse }> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match?.[1]) {
    return { response: scimError(401, "A SCIM bearer token is required.") };
  }
  const token = await authenticateScimToken(match[1]);
  if (!token) {
    return { response: scimError(401, "The SCIM token is invalid or revoked.") };
  }

  const rows = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.slug, workspaceSlug))
    .limit(1);
  const workspace = rows[0];
  // Unknown tenants are 404s; a token for another tenant is also a 404 so the
  // route cannot be used to discover which workspaces exist.
  if (!workspace || workspace.id !== token.workspaceId) {
    return { response: scimError(404, "Workspace not found.") };
  }
  return { workspaceId: workspace.id, actorUserId: token.createdBy ?? null };
}
