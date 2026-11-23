import { NextResponse } from "next/server";

import { authorizeAppApi } from "@/features/app-api/auth";
import { exportSurveyResponses } from "@/features/engagement/service";

/**
 * Download every response to one survey.
 *
 * Same permission as the results page (`settings:manage`), scoped through the
 * product the caller already authorized, so a survey id from another product
 * resolves to 404 rather than a file. The CSV is never cached.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "cache-control": "private, no-store" } as const;

export async function GET(
  request: Request,
  context: {
    params: Promise<{ workspaceSlug: string; productSlug: string; surveyId: string }>;
  },
): Promise<NextResponse> {
  const { workspaceSlug, productSlug, surveyId } = await context.params;
  const authorized = await authorizeAppApi({
    request,
    workspaceSlug,
    productSlug,
    permission: "settings:manage",
  });
  if (!authorized.ok) return authorized.response;

  const exported = await exportSurveyResponses(
    authorized.context.product.id,
    surveyId,
  );
  if (!exported) {
    return NextResponse.json({ error: "Survey not found." }, { status: 404 });
  }

  const date = new Date().toISOString().slice(0, 10);
  const filename = `herald-${authorized.context.product.slug}-${exported.survey.slug}-responses-${date}.csv`;

  return new NextResponse(exported.csv, {
    headers: {
      ...NO_STORE,
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
