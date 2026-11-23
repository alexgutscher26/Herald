import { NextResponse } from "next/server";
import { z } from "zod";

import { authorizeWorkspaceApi } from "@/features/app-api/auth";
import { revokeWebhook } from "@/features/webhooks/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "cache-control": "private, no-store" } as const;

export async function DELETE(
  request: Request,
  context: { params: Promise<{ workspaceSlug: string; webhookId: string }> },
): Promise<NextResponse> {
  const { workspaceSlug, webhookId } = await context.params;
  const authorized = await authorizeWorkspaceApi({
    request,
    workspaceSlug,
    permission: "settings:manage",
    mutation: true,
  });
  if (!authorized.ok) return authorized.response;

  const parsed = z.uuid().safeParse(webhookId);
  if (!parsed.success) {
    return NextResponse.json({ error: "Webhook not found." }, { status: 404, headers: NO_STORE });
  }

  const revoked = await revokeWebhook(authorized.workspace.id, parsed.data);
  if (!revoked) {
    return NextResponse.json({ error: "Webhook not found." }, { status: 404, headers: NO_STORE });
  }

  return NextResponse.json({ revoked: true }, { headers: NO_STORE });
}
