import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/db";
import { apiIdempotencyKeys, apiTokens } from "@/db/schema";
import { authorizeWorkspaceApi } from "@/features/app-api/auth";
import { getApiIdempotencyTtlHours } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "cache-control": "private, no-store" } as const;

const querySchema = z.object({
  key: z.string().trim().min(1).max(255).optional(),
  endpoint: z.string().trim().min(1).max(200).optional(),
  status: z.enum(["stored", "pending"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * Replay inspection for `Idempotency-Key` rows in this workspace.
 *
 * Only metadata is returned: a stored response can contain customer content, and
 * this endpoint exists to answer "did my retry replay, and when does it stop?"
 * without turning the API into a read path for another client's payload.
 */
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

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    key: url.searchParams.get("key") ?? undefined,
    endpoint: url.searchParams.get("endpoint") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Check the filters." },
      { status: 400, headers: NO_STORE },
    );
  }

  const now = new Date();
  const conditions = [
    eq(apiIdempotencyKeys.workspaceId, authorized.workspace.id),
    ...(parsed.data.key ? [eq(apiIdempotencyKeys.key, parsed.data.key)] : []),
    ...(parsed.data.endpoint
      ? [eq(apiIdempotencyKeys.endpoint, parsed.data.endpoint)]
      : []),
    ...(parsed.data.status === "stored"
      ? [gt(apiIdempotencyKeys.responseStatus, -1)]
      : []),
    ...(parsed.data.status === "pending"
      ? [isNull(apiIdempotencyKeys.responseStatus)]
      : []),
  ];

  const rows = await db
    .select({
      id: apiIdempotencyKeys.id,
      key: apiIdempotencyKeys.key,
      endpoint: apiIdempotencyKeys.endpoint,
      requestHash: apiIdempotencyKeys.requestHash,
      responseStatus: apiIdempotencyKeys.responseStatus,
      createdAt: apiIdempotencyKeys.createdAt,
      expiresAt: apiIdempotencyKeys.expiresAt,
      tokenId: apiIdempotencyKeys.tokenId,
      tokenName: apiTokens.name,
      tokenPrefix: apiTokens.prefix,
    })
    .from(apiIdempotencyKeys)
    .innerJoin(apiTokens, eq(apiIdempotencyKeys.tokenId, apiTokens.id))
    .where(and(...conditions))
    .orderBy(desc(apiIdempotencyKeys.createdAt))
    .limit(parsed.data.limit);

  const filtered = rows.filter((row) => {
    const pending = row.responseStatus === null;
    if (parsed.data.status === "pending" && !pending) return false;
    if (parsed.data.status === "stored" && pending) return false;
    return true;
  });

  return NextResponse.json(
    {
      ttl_hours: getApiIdempotencyTtlHours(),
      keys: filtered.map((row) => ({
        id: row.id,
        key: row.key,
        endpoint: row.endpoint,
        request_hash: row.requestHash,
        response_status: row.responseStatus,
        state: row.responseStatus === null ? "pending" : "stored",
        replayable:
          row.responseStatus !== null && row.expiresAt.getTime() > now.getTime(),
        active: row.expiresAt.getTime() > now.getTime(),
        token: { id: row.tokenId, name: row.tokenName, prefix: row.tokenPrefix },
        created_at: row.createdAt.toISOString(),
        expires_at: row.expiresAt.toISOString(),
      })),
    },
    { headers: NO_STORE },
  );
}
