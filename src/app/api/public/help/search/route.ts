import { NextResponse } from "next/server";

import { searchPublicHelp } from "@/features/help/service";

export const dynamic = "force-dynamic";

/** First-party help search. Published, public rows only. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const workspaceSlug = url.searchParams.get("workspaceSlug") ?? "";
  const productSlug = url.searchParams.get("productSlug") ?? "";
  const query = url.searchParams.get("q") ?? "";
  if (!workspaceSlug || !productSlug) {
    return NextResponse.json({ error: "workspaceSlug and productSlug are required." }, { status: 400 });
  }

  const result = await searchPublicHelp({ workspaceSlug, productSlug, query });
  if (!result) return NextResponse.json({ error: "Help center not found." }, { status: 404 });
  return NextResponse.json(
    { data: result.hits },
    { headers: { "cache-control": "private, no-store" } },
  );
}
