import { NextResponse } from "next/server";

import { findMembershipBySlug } from "@/db/queries/workspaces";
import { buildWorkspaceExport } from "@/features/data-controls/service";
import { getSessionUser } from "@/lib/authz";
import { requirePermission, type WorkspaceRole } from "@/lib/permissions";

/**
 * Download every product's data in a workspace.
 *
 * This is the portable data export required for a customer data request. It
 * omits credentials and session material and is never cached.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ workspaceSlug: string }> },
): Promise<NextResponse> {
  const { workspaceSlug } = await context.params;
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json(
      { error: "Sign in to export this workspace." },
      { status: 401, headers: { "cache-control": "private, no-store" } },
    );
  }

  const membership = await findMembershipBySlug(workspaceSlug, user.id);
  if (!membership) {
    return NextResponse.json(
      { error: "Not found." },
      { status: 404, headers: { "cache-control": "private, no-store" } },
    );
  }

  requirePermission(membership.role as WorkspaceRole, "settings:manage");
  const bundle = await buildWorkspaceExport({ workspaceId: membership.workspace.id });
  if (!bundle) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(bundle, null, 2), {
    headers: {
      "cache-control": "private, no-store",
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="herald-${workspaceSlug}-${date}.json"`,
    },
  });
}
