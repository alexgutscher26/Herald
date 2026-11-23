import { NextResponse } from "next/server";
import { z } from "zod";

import { WEBHOOK_DELIVERY_STATUSES } from "@/db/schema";
import { authorizeWorkspaceApi } from "@/features/app-api/auth";
import { listWorkspaceDeliveries } from "@/features/webhooks/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "cache-control": "private, no-store" } as const;

/**
 * Dead-letter view: the workspace-wide delivery log, failed deliveries by
 * default. It is intentionally a static route beside `[webhookId]` so the
 * filter is reachable without knowing a hook id.
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

  const search = new URL(request.url).searchParams;
  const rawStatus = search.get("status") ?? "failed";
  const status = z.enum(WEBHOOK_DELIVERY_STATUSES).safeParse(rawStatus);
  if (!status.success) {
    return NextResponse.json(
      { error: `status must be one of ${WEBHOOK_DELIVERY_STATUSES.join(", ")}.` },
      { status: 400, headers: NO_STORE },
    );
  }

  const rawLimit = search.get("limit") ?? "50";
  const limit = /^\d{1,3}$/.test(rawLimit) ? Number.parseInt(rawLimit, 10) : 50;
  const deliveries = await listWorkspaceDeliveries({
    workspaceId: authorized.workspace.id,
    status: status.data,
    limit,
  });

  return NextResponse.json(
    { deliveries, filter: { status: status.data, limit } },
    { headers: NO_STORE },
  );
}
