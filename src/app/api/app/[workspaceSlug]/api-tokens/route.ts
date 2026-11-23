import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/db";
import { API_SCOPES, apiTokens } from "@/db/schema";
import { authorizeWorkspaceApi } from "@/features/app-api/auth";
import { serializeToken } from "@/features/api-v1/serialize";
import { createApiTokenMaterial } from "@/features/api-v1/token";

/**
 * API tokens are workspace-scoped, so this route sits outside a product.
 * Only `settings:manage` can list, mint or revoke them. The raw token is
 * returned exactly once, on creation.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "cache-control": "private, no-store" } as const;

const createSchema = z.object({
  name: z.string().trim().min(1, "Name the token.").max(120),
  scopes: z
    .array(z.enum(API_SCOPES))
    .min(1, "Choose at least one scope.")
    .max(API_SCOPES.length)
    .default(["read", "write"]),
});

function failure(status: number, error: string, fieldErrors?: Record<string, string[]>) {
  return NextResponse.json(
    fieldErrors ? { error, fieldErrors } : { error },
    { status, headers: NO_STORE },
  );
}

function fieldErrors(error: z.ZodError): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "body";
    result[key] = [...(result[key] ?? []), issue.message];
  }
  return result;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ workspaceSlug: string }> },
): Promise<NextResponse> {
  const { workspaceSlug } = await context.params;
  const authorized = await authorizeWorkspaceApi({
    request,
    workspaceSlug,
    permission: "settings:manage",
  });
  if (!authorized.ok) return authorized.response;

  const rows = await db
    .select()
    .from(apiTokens)
    .where(eq(apiTokens.workspaceId, authorized.workspace.id))
    .orderBy(desc(apiTokens.createdAt));

  return NextResponse.json(
    { tokens: rows.map(serializeToken) },
    { headers: NO_STORE },
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceSlug: string }> },
): Promise<NextResponse> {
  const { workspaceSlug } = await context.params;
  const authorized = await authorizeWorkspaceApi({
    request,
    workspaceSlug,
    permission: "settings:manage",
    mutation: true,
  });
  if (!authorized.ok) return authorized.response;

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return failure(400, "Check the token fields.", fieldErrors(parsed.error));
  }

  const material = createApiTokenMaterial();
  const rows = await db
    .insert(apiTokens)
    .values({
      workspaceId: authorized.workspace.id,
      name: parsed.data.name,
      tokenHash: material.tokenHash,
      prefix: material.prefix,
      scopes: [...new Set(parsed.data.scopes)],
      createdBy: authorized.user.id,
    })
    .returning({
      id: apiTokens.id,
      name: apiTokens.name,
      prefix: apiTokens.prefix,
      scopes: apiTokens.scopes,
      lastUsedAt: apiTokens.lastUsedAt,
      revokedAt: apiTokens.revokedAt,
      expiresAt: apiTokens.expiresAt,
      createdAt: apiTokens.createdAt,
    });

  const token = rows[0];
  if (!token) return failure(500, "The token was created but could not be read back.");

  return NextResponse.json(
    { token: material.token, api_token: serializeToken(token) },
    { status: 201, headers: NO_STORE },
  );
}

/** Revoke is a soft delete: the row and its audit fields stay. */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ workspaceSlug: string }> },
): Promise<NextResponse> {
  const { workspaceSlug } = await context.params;
  const authorized = await authorizeWorkspaceApi({
    request,
    workspaceSlug,
    permission: "settings:manage",
    mutation: true,
  });
  if (!authorized.ok) return authorized.response;

  const tokenId = new URL(request.url).searchParams.get("token_id");
  const parsed = z.uuid().safeParse(tokenId);
  if (!parsed.success) return failure(400, "That token id is not valid.");

  const revoked = await db
    .update(apiTokens)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(apiTokens.id, parsed.data),
        eq(apiTokens.workspaceId, authorized.workspace.id),
      ),
    )
    .returning({ id: apiTokens.id });

  if (!revoked[0]) return failure(404, "Token not found.");
  return NextResponse.json({ revoked: true }, { headers: NO_STORE });
}
