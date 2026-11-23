import { NextResponse } from "next/server";
import { z } from "zod";

import { authorizeWorkspaceApi } from "@/features/app-api/auth";
import { replayDeliveries } from "@/features/webhooks/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "cache-control": "private, no-store" } as const;

const bodySchema = z.object({
  delivery_ids: z.array(z.uuid()).min(1).max(100),
});

/** Bulk replay from the dead-letter view. The next cron run sends each row. */
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

  const json: unknown = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Choose between 1 and 100 failed deliveries." },
      { status: 400, headers: NO_STORE },
    );
  }

  const result = await replayDeliveries({
    workspaceId: authorized.workspace.id,
    deliveryIds: parsed.data.delivery_ids,
    userId: authorized.user.id,
  });
  return NextResponse.json(result, { headers: NO_STORE });
}
