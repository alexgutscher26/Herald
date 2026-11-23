import { NextResponse } from "next/server";
import { z } from "zod";

import { WEBHOOK_DELIVERY_STATUSES } from "@/db/schema";
import { authorizeWorkspaceApi } from "@/features/app-api/auth";
import { listDeliveries } from "@/features/webhooks/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "cache-control": "private, no-store" } as const;

export async function GET(
  request: Request,
  context: { params: Promise<{ workspaceSlug: string; webhookId: string }> },
): Promise<NextResponse> {
  const { workspaceSlug, webhookId } = await context.params;
  const authorized = await authorizeWorkspaceApi({
    request,
    workspaceSlug,
    permission: "settings:manage",
  });
  if (!authorized.ok) return authorized.response;

  const parsed = z.uuid().safeParse(webhookId);
  if (!parsed.success) {
    return NextResponse.json({ error: "Webhook not found." }, { status: 404, headers: NO_STORE });
  }

  const search = new URL(request.url).searchParams;
  const rawLimit = search.get("limit") ?? "25";
  const limit = /^\d{1,3}$/.test(rawLimit) ? Number.parseInt(rawLimit, 10) : 25;
  const rawStatus = search.get("status");
  const status = rawStatus
    ? z.enum(WEBHOOK_DELIVERY_STATUSES).safeParse(rawStatus)
    : null;
  if (status && !status.success) {
    return NextResponse.json(
      { error: `status must be one of ${WEBHOOK_DELIVERY_STATUSES.join(", ")}.` },
      { status: 400, headers: NO_STORE },
    );
  }
  const deliveries = await listDeliveries({
    workspaceId: authorized.workspace.id,
    webhookId: parsed.data,
    limit,
    status: status?.data,
  });
  if (deliveries === null) {
    return NextResponse.json({ error: "Webhook not found." }, { status: 404, headers: NO_STORE });
  }

  // Payloads are omitted from the log: they can contain customer content, and
  // the delivery row id is enough to replay.
  return NextResponse.json({ deliveries }, { headers: NO_STORE });
}
