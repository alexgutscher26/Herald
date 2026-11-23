import { NextResponse } from "next/server";
import { z } from "zod";

import { authorizeAppApi } from "@/features/app-api/auth";
import { getGithubInstallationTokenForProduct } from "@/features/github/service";
import { analyzeFeedbackImport, createFeedbackImport } from "@/features/import/service";
import { ImportSourceError, fetchGithubIssues, fetchHeraldRequests } from "@/features/import/sources";
import { reportError } from "@/lib/error-report";
import { requestIdFor } from "@/lib/request-context";

/**
 * Start an import from a Git host or another Herald workspace.
 *
 * The remote is read on the server for a bounded number of pages and normalized
 * into the same stored rows a CSV produces. Tokens are used only for this fetch
 * and are never written to the database or returned in a response.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "cache-control": "private, no-store" } as const;

const bodySchema = z.object({
  source: z.enum(["github", "herald"]),
  boardId: z.uuid(),
  repo: z.string().trim().max(200).optional(),
  includeClosed: z.boolean().optional(),
  token: z.string().max(4096).optional(),
  baseUrl: z.string().trim().max(2048).optional(),
  dryRun: z.boolean().optional(),
});

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
    permission: "settings:manage",
    mutation: true,
  });
  if (!authorized.ok) return authorized.response;

  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    return failure(400, "Send a JSON body.");
  }

  const parsed = bodySchema.safeParse(parsedBody);
  if (!parsed.success) return failure(400, "Check the source details and try again.");

  try {
    const githubToken =
      parsed.data.source === "github"
        ? parsed.data.token?.trim() ||
          (await getGithubInstallationTokenForProduct(authorized.context.product.id))
        : null;
    const rows =
      parsed.data.source === "github"
        ? await fetchGithubIssues({
            repo: parsed.data.repo ?? "",
            token: githubToken,
            includeClosed: parsed.data.includeClosed ?? true,
          })
        : await fetchHeraldRequests({
            baseUrl: parsed.data.baseUrl ?? "",
            token: parsed.data.token ?? "",
          });

    if (parsed.data.dryRun) {
      const analysis = await analyzeFeedbackImport({
        productId: authorized.context.product.id,
        boardId: parsed.data.boardId,
        headers: rows.headers,
        rows: rows.rows,
        mapping: rows.mapping,
      });
      if (!analysis.ok) return failure(400, analysis.error);
      return NextResponse.json({ dryRun: analysis.plan }, { headers: NO_STORE });
    }

    const created = await createFeedbackImport({
      workspaceId: authorized.context.workspace.id,
      productId: authorized.context.product.id,
      createdBy: authorized.context.user.id,
      fileName: rows.fileName,
      format: "generic",
      source: parsed.data.source,
      sourceConfig: rows.sourceConfig,
      boardId: parsed.data.boardId,
      headers: rows.headers,
      rows: rows.rows,
      mapping: rows.mapping,
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
    if (error instanceof ImportSourceError) return failure(400, error.message);

    await reportError(
      error,
      {
        requestId: requestIdFor(request),
        route: "POST /api/app/imports/source",
        productId: authorized.context.product.id,
      },
      "import.source_failed",
    );
    return failure(500, "The source could not be imported.");
  }
}
