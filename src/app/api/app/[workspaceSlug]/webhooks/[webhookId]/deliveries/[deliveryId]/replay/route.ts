import { NextResponse } from "next/server";
import { z } from "zod";

import { authorizeWorkspaceApi } from "@/features/app-api/auth";
import { replayDelivery } from "@/features/webhooks/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "cache-control": "private, no-store" } as const;

/**
 * Requeue a delivery with its original, already-signed-in-storage payload.
 * The next cron run sends it; this endpoint does not call the receiver itself,
 * so a slow receiver cannot hold the dashboard request open.
 */
export async function POST(
  request: Request,
  context: {
    params: Promise<{ workspaceSlug: string; webhookId: string; deliveryId: string }>;
  },
): Promise<NextResponse> {
  const { workspaceSlug, webhookId, deliveryId } = await context.params;
  const authorized = await authorizeWorkspaceApi({
    request,
    workspaceSlug,
    permission: "settings:manage",
    mutation: true,
  });
  if (!authorized.ok) return authorized.response;

  const hook = z.uuid().safeParse(webhookId);
  const delivery = z.uuid().safeParse(deliveryId);
  if (!hook.success || !delivery.success) {
    return NextResponse.json({ error: "Delivery not found." }, { status: 404, headers: NO_STORE });
  }

  const replayed = await replayDelivery({
    workspaceId: authorized.workspace.id,
    webhookId: hook.data,
    deliveryId: delivery.data,
  });
  if (!replayed) {
    return NextResponse.json({ error: "Delivery not found." }, { status: 404, headers: NO_STORE });
  }

  return NextResponse.json({ replayed: true }, { headers: NO_STORE });
}
