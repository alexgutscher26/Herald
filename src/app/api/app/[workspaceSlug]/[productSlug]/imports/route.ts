import { NextResponse } from "next/server";

import { authorizeAppApi } from "@/features/app-api/auth";
import { parseCsv } from "@/features/import/csv";
import { analyzeFeedbackImport, createFeedbackImport } from "@/features/import/service";
import {
  IMPORT_FORMATS,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  isImportFormat,
  type ImportMapping,
} from "@/features/import/types";
import { reportError } from "@/lib/error-report";
import { requestIdFor } from "@/lib/request-context";

/**
 * Start a CSV import.
 *
 * The file is parsed here, copied into import rows and queued as a job; the
 * request returns as soon as the rows are stored. The browser's preview is
 * only a convenience — the server parses the same file and validates the
 * mapping against the headers it actually found.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "cache-control": "private, no-store" } as const;

function failure(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

function readMapping(value: FormDataEntryValue | null): ImportMapping | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;

    const mapping: ImportMapping = {};
    for (const [field, header] of Object.entries(parsed)) {
      if (typeof header === "string" && header.trim() !== "") {
        mapping[field as keyof ImportMapping] = header;
      }
    }
    return mapping;
  } catch {
    return null;
  }
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
    permission: "settings:manage",
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

  const formatValue = form.get("format");
  const format = isImportFormat(formatValue) ? formatValue : "generic";
  if (formatValue !== null && typeof formatValue === "string" && !isImportFormat(formatValue)) {
    return failure(400, `Choose one of: ${IMPORT_FORMATS.join(", ")}.`);
  }

  const boardId = form.get("boardId");
  if (typeof boardId !== "string" || boardId.trim() === "") {
    return failure(400, "Choose the board that rows without a board column belong to.");
  }

  const mapping = readMapping(form.get("mapping"));
  if (!mapping) return failure(400, "The column mapping is missing or invalid.");

  let parsed;
  try {
    parsed = parseCsv(await file.text());
  } catch (error) {
    return failure(400, error instanceof Error ? error.message : "The file could not be read.");
  }

  if (parsed.rows.length > MAX_IMPORT_ROWS) {
    return failure(
      400,
      `Import at most ${MAX_IMPORT_ROWS.toLocaleString("en")} rows at a time.`,
    );
  }

  const unknown = Object.values(mapping).filter(
    (header) => header !== undefined && !parsed.headers.includes(header),
  );
  if (unknown.length > 0) {
    return failure(400, "The mapping names a column that is not in the file.");
  }

  const dryRun = form.get("dryRun") === "true";

  try {
    if (dryRun) {
      const analysis = await analyzeFeedbackImport({
        productId: authorized.context.product.id,
        boardId,
        headers: parsed.headers,
        rows: parsed.rows,
        mapping,
      });
      if (!analysis.ok) return failure(400, analysis.error);
      return NextResponse.json({ dryRun: analysis.plan }, { headers: NO_STORE });
    }

    const created = await createFeedbackImport({
      workspaceId: authorized.context.workspace.id,
      productId: authorized.context.product.id,
      createdBy: authorized.context.user.id,
      fileName: file.name || "import.csv",
      format,
      boardId,
      headers: parsed.headers,
      rows: parsed.rows,
      mapping,
    });

    if (!created.ok) return failure(400, created.error);

    return NextResponse.json(
      {
        import: {
          id: created.importId,
          totalRows: created.totalRows,
          status: "queued",
        },
      },
      { status: 202, headers: NO_STORE },
    );
  } catch (error) {
    await reportError(
      error,
      {
        requestId: requestIdFor(request),
        route: "POST /api/app/imports",
        productId: authorized.context.product.id,
      },
      "import.create_failed",
    );
    return failure(500, "The import could not be started.");
  }
}
