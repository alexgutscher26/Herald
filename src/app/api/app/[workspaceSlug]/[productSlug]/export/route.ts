import { NextResponse } from "next/server";

import { authorizeAppApi } from "@/features/app-api/auth";
import { buildExportBundle, buildRequestsCsv } from "@/features/export/service";

/**
 * Download the product's feedback data.
 *
 * JSON is the complete bundle (including internal comments and merge history).
 * CSV is the request table for spreadsheets, with `merged_into_id` populated
 * for duplicates. Both require `settings:manage`; the response is never cached.
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
    permission: "settings:manage",
  });
  if (!authorized.ok) return authorized.response;

  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "csv" ? "csv" : "json";

  const bundle = await buildExportBundle({
    workspaceId: authorized.context.workspace.id,
    productId: authorized.context.product.id,
  });
  if (!bundle) {
    return NextResponse.json({ error: "Not found." }, { status: 404, headers: NO_STORE });
  }

  const date = bundle.exportedAt.slice(0, 10);
  const base = `herald-${bundle.product.slug}-feedback-${date}`;

  if (format === "csv") {
    return new NextResponse(buildRequestsCsv(bundle), {
      headers: {
        ...NO_STORE,
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${base}.csv"`,
      },
    });
  }

  return new NextResponse(JSON.stringify(bundle, null, 2), {
    headers: {
      ...NO_STORE,
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${base}.json"`,
    },
  });
}
