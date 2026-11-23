import { NextResponse } from "next/server";

import { authorizeAppApi } from "@/features/app-api/auth";
import { parseCancellationCsv } from "@/features/winback/csv";
import { importCancellations } from "@/features/winback/service";
import { reportError } from "@/lib/error-report";
import { requestIdFor } from "@/lib/request-context";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const MAX_IMPORT_ROWS = 10_000;
const NO_STORE = { "cache-control": "private, no-store" } as const;

function failure(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceSlug: string; productSlug: string }> },
): Promise<NextResponse> {
  const { workspaceSlug, productSlug } = await context.params;
  const authorized = await authorizeAppApi({
    request,
    workspaceSlug,
    productSlug,
    permission: "winback:manage",
    mutation: true,
  });
  if (!authorized.ok) return authorized.response;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return failure(400, "Send the CSV as multipart form data.");
  }

  const file = form.get("file");
  if (!(file instanceof File)) return failure(400, "Choose a CSV file to import.");
  if (file.size === 0) return failure(400, "The file is empty.");
  if (file.size > MAX_IMPORT_BYTES) {
    return failure(400, `The file is larger than ${MAX_IMPORT_BYTES / (1024 * 1024)} MB.`);
  }

  try {
    const parsed = parseCancellationCsv(await file.text());
    if (parsed.totalRows > MAX_IMPORT_ROWS) {
      return failure(400, `Import at most ${MAX_IMPORT_ROWS.toLocaleString("en")} rows at a time.`);
    }
    if (parsed.rows.length === 0) {
      return failure(400, "No valid cancellation rows were found in that file.");
    }

    const result = await importCancellations({
      workspaceId: authorized.context.workspace.id,
      productId: authorized.context.product.id,
      rows: parsed.rows,
    });

    return NextResponse.json(
      {
        import: {
          total: result.total,
          created: result.created,
          updated: result.updated,
          skipped: result.skipped,
          invalid: parsed.invalidRows,
        },
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    if (error instanceof Error && error.message === "The file needs an email column.") {
      return failure(400, error.message);
    }
    await reportError(
      error,
      {
        requestId: requestIdFor(request),
        route: "POST /api/app/winback/import",
        productId: authorized.context.product.id,
      },
      "winback.import_failed",
    );
    return failure(500, "The import could not be completed.");
  }
}
