import { NextResponse } from "next/server";

import { authorizeAppApi } from "@/features/app-api/auth";
import { buildRawEventCsv } from "@/features/analytics/export";

/**
 * Raw public-event CSV. Requires analytics read, is never cached, and applies
 * the redactions in `buildRawEventCsv` rather than exporting the event table.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "cache-control": "private, no-store" } as const;

export async function GET(
  request: Request,
  context: { params: Promise<{ workspaceSlug: string; productSlug: string }> },
): Promise<NextResponse> {
  const { workspaceSlug, productSlug } = await context.params;
  const authorized = await authorizeAppApi({
    request,
    workspaceSlug,
    productSlug,
    permission: "analytics:read",
  });
  if (!authorized.ok) return authorized.response;

  const days = Number(new URL(request.url).searchParams.get("days") ?? 30);
  const { csv, from, to } = await buildRawEventCsv({
    productId: authorized.context.product.id,
    days: Number.isFinite(days) ? days : 30,
  });

  return new NextResponse(csv, {
    headers: {
      ...NO_STORE,
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="herald-${authorized.context.product.slug}-events-${from}-to-${to}.csv"`,
    },
  });
}
