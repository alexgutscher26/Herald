import { NextResponse } from "next/server";
import { z } from "zod";

import { WEBHOOK_EVENTS } from "@/db/schema";
import { authorizeWorkspaceApi } from "@/features/app-api/auth";
import { enqueueTestWebhookDelivery } from "@/features/webhooks/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "cache-control": "private, no-store" } as const;

const bodySchema = z.object({
  event: z.enum(WEBHOOK_EVENTS),
});

/**
 * Queue a real test delivery. The cron worker signs and sends it like any other
 * event; this route never calls the customer endpoint directly.
 */
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

  const hook = z.uuid().safeParse(webhookId);
  if (!hook.success) {
    return NextResponse.json({ error: "Webhook not found." }, { status: 404, headers: NO_STORE });
  }

  const json: unknown = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: `event must be one of ${WEBHOOK_EVENTS.join(", ")}.` },
      { status: 400, headers: NO_STORE },
    );
  }

  const result = await enqueueTestWebhookDelivery({
    workspaceId: authorized.workspace.id,
    webhookId: hook.data,
    event: parsed.data.event,
    userId: authorized.user.id,
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400, headers: NO_STORE });
  }

  return NextResponse.json(
    {
      delivery: { id: result.id, status: "pending" },
      note: "Queued for the next webhook delivery run. The delivery log records the real receiver response.",
    },
    { status: 202, headers: NO_STORE },
  );
}
