import { NextResponse } from "next/server";

import { listAllSuppressions } from "@/db/queries/subscribers";
import { authorizeAppApi } from "@/features/app-api/auth";
import { toSuppressionCsv } from "@/features/email/suppression-csv";

/**
 * Download the workspace suppression list.
 *
 * The list is workspace-wide, so the export is too. Reads require
 * `subscriber:read`; the response is never cached.
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

  const rows = await listAllSuppressions(authorized.context.workspace.id);
  const date = new Date().toISOString().slice(0, 10);
  const filename = `herald-${authorized.context.product.slug}-suppressions-${date}.csv`;

  return new NextResponse(toSuppressionCsv(rows), {
    headers: {
      ...NO_STORE,
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
