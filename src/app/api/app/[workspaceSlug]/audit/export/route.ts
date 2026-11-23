import { NextResponse } from "next/server";

import { authorizeWorkspaceApi } from "@/features/app-api/auth";
import { toAuditCsv } from "@/features/data-controls/audit-csv";
import { parseAuditFilters } from "@/features/data-controls/audit-filters";
import { listWorkspaceAuditEvents } from "@/features/data-controls/service";

/**
 * Owner-only audit export.
 *
 * The same filters as the settings table are parsed here, so the downloaded
 * file describes exactly the rows the owner was looking at. Admins manage
 * settings but cannot read the audit log, so they get a 403 rather than a
 * filtered file.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "cache-control": "private, no-store" } as const;

export async function GET(
  request: Request,
  context: { params: Promise<{ workspaceSlug: string }> },
): Promise<NextResponse> {
  const { workspaceSlug } = await context.params;
  const authorized = await authorizeWorkspaceApi({
    request,
    workspaceSlug,
    permission: "member:read",
  });
  if (!authorized.ok) return authorized.response;

  if (authorized.role !== "owner") {
    return NextResponse.json(
      { error: "Only a workspace owner can export the audit log." },
      { status: 403, headers: NO_STORE },
    );
  }

  const url = new URL(request.url);
  const filters = parseAuditFilters(Object.fromEntries(url.searchParams));
  const entries = await listWorkspaceAuditEvents(authorized.workspace.id, {
    filters,
    limit: 5000,
  });

  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse(toAuditCsv(entries), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${authorized.workspace.slug}-audit-${day}.csv"`,
      ...NO_STORE,
    },
  });
}
