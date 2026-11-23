import { NextResponse } from "next/server";

import { authorizeAppApi } from "@/features/app-api/auth";
import { isSearchableQuery, normalizeSearchQuery } from "@/features/search/query";
import { searchWorkspace } from "@/features/search/service";

/**
 * Authenticated dashboard search for the command palette.
 *
 * The route resolves the product through the caller's own membership and
 * returns only groups the member's role can open. Responses are tenant-scoped
 * and private, so they are never cached.
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
    permission: "workspace:read",
  });
  if (!authorized.ok) return authorized.response;

  const query = normalizeSearchQuery(new URL(request.url).searchParams.get("q"));
  if (!isSearchableQuery(query)) {
    return NextResponse.json({ groups: [] }, { headers: NO_STORE });
  }

  const { role } = authorized.context;
  const groups = await searchWorkspace({
    workspaceId: authorized.context.workspace.id,
    productId: authorized.context.product.id,
    role,
    permissions: authorized.context.permissions,
    workspaceSlug,
    productSlug,
    query,
  });

  return NextResponse.json({ groups }, { headers: NO_STORE });
}
