import { NextResponse } from "next/server";
import { z } from "zod";

import { authorizeWorkspaceApi } from "@/features/app-api/auth";
import { serializeToken } from "@/features/api-v1/serialize";
import { rotateApiToken } from "@/features/api-v1/token-rotation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "cache-control": "private, no-store" } as const;

const bodySchema = z
  .object({
    grace_hours: z.number().int().min(0).max(168).default(24),
  })
  .default({ grace_hours: 24 });

/**
 * Issue a replacement token and retire the old one after a grace period.
 * The raw replacement is returned exactly once.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceSlug: string; tokenId: string }> },
): Promise<NextResponse> {
  const { workspaceSlug, tokenId } = await context.params;
  const authorized = await authorizeWorkspaceApi({
    request,
    workspaceSlug,
    permission: "settings:manage",
    mutation: true,
  });
  if (!authorized.ok) return authorized.response;

  const id = z.uuid().safeParse(tokenId);
  if (!id.success) {
    return NextResponse.json({ error: "Token not found." }, { status: 404, headers: NO_STORE });
  }

  const json: unknown = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json ?? undefined);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "grace_hours must be an integer between 0 and 168." },
      { status: 400, headers: NO_STORE },
    );
  }

  const result = await rotateApiToken({
    workspaceId: authorized.workspace.id,
    userId: authorized.user.id,
    tokenId: id.data,
    graceHours: parsed.data.grace_hours,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.code === "not_found" ? 404 : 409, headers: NO_STORE },
    );
  }

  return NextResponse.json(
    {
      token: result.token,
      api_token: serializeToken(result.apiToken),
      previous_token: {
        id: result.apiToken.rotatedFromId,
        retires_at: result.previousRetiresAt.toISOString(),
      },
    },
    { status: 201, headers: NO_STORE },
  );
}
