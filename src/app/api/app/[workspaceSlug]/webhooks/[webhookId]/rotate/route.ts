import { NextResponse } from "next/server";
import { z } from "zod";

import { authorizeWorkspaceApi } from "@/features/app-api/auth";
import { rotateWebhookSecret } from "@/features/webhooks/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "cache-control": "private, no-store" } as const;

/** Rotate a signing secret. The replacement is returned once. */
export async function POST(
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

  const rotated = await rotateWebhookSecret({
    workspaceId: authorized.workspace.id,
    webhookId: parsed.data,
    userId: authorized.user.id,
  });
  if (!rotated) {
    return NextResponse.json({ error: "Webhook not found." }, { status: 404, headers: NO_STORE });
  }

  return NextResponse.json(
    {
      secret: rotated.secret,
      previous_valid_until: rotated.previousValidUntil.toISOString(),
      signing: {
        header: "x-herald-signature",
        previous_header: "x-herald-signature-previous",
        algorithm: "HMAC-SHA256 over `${timestamp}.${rawBody}`, sent as `v1=<hex>`",
      },
    },
    { headers: NO_STORE },
  );
}
