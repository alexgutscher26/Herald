import { NextResponse } from "next/server";

import { listAllSubscribers } from "@/db/queries/subscribers";
import { authorizeAppApi } from "@/features/app-api/auth";
import { toSubscriberCsv } from "@/features/subscribers/csv";

/**
 * Download every subscriber for this product.
 *
 * Reads require `subscriber:read`; the CSV includes status and source so an
 * operator can rebuild the list elsewhere without guessing why an address is
 * pending or unsubscribed. The response is never cached.
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
    permission: "subscriber:read",
  });
  if (!authorized.ok) return authorized.response;

  const rows = await listAllSubscribers(authorized.context.product.id);
  const date = new Date().toISOString().slice(0, 10);
  const filename = `herald-${authorized.context.product.slug}-subscribers-${date}.csv`;

  return new NextResponse(toSubscriberCsv(rows), {
    headers: {
      ...NO_STORE,
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
