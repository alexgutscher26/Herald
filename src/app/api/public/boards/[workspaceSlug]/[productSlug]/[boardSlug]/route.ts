import { NextResponse } from "next/server";

import { parsePublicBoardQuery } from "@/features/public/query";
import { getPublicBoardPage } from "@/features/public/queries";

/**
 * Public board projection.
 *
 * Unknown workspaces, products, private boards and archived boards all return
 * the same 404. The response is uncached so a moderation decision takes effect
 * on the next request.
 */

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

export async function GET(
  request: Request,
  context: {
    params: Promise<{ workspaceSlug: string; productSlug: string; boardSlug: string }>;
  },
): Promise<NextResponse> {
  const params = await context.params;
  const url = new URL(request.url);
  const query = parsePublicBoardQuery({
    q: url.searchParams.get("q") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    tag: url.searchParams.get("tag") ?? undefined,
    sort: url.searchParams.get("sort") ?? undefined,
    page: url.searchParams.get("page") ?? undefined,
    pageSize: url.searchParams.get("pageSize") ?? undefined,
  });
  const page = await getPublicBoardPage(params, query);

  if (!page) {
    return NextResponse.json({ error: "Board not found." }, { status: 404, headers: NO_STORE });
  }

  return NextResponse.json(page, { headers: NO_STORE });
}
