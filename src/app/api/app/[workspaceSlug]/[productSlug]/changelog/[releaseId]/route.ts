import { NextResponse } from "next/server";
import { z } from "zod";

import { findReleaseForProduct } from "@/db/queries/releases";
import { authorizeAppApi } from "@/features/app-api/auth";
import { releaseDraftUpdateSchema } from "@/features/releases/draft-schema";
import { updateReleaseDraft } from "@/features/releases/draft-service";
import { reportError } from "@/lib/error-report";
import { requestIdFor } from "@/lib/request-context";

/**
 * Update a changelog draft.
 *
 * The service refuses any row that is not a draft, so a caller cannot change a
 * published or scheduled entry or overwrite its publication date. Publishing
 * stays in the editor action.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "cache-control": "private, no-store" } as const;
const releaseIdSchema = z.uuid("That release id is not valid.");

function failure(
  status: number,
  error: string,
  fieldErrors?: Record<string, string[]>,
): NextResponse {
  return NextResponse.json(
    fieldErrors ? { error, fieldErrors } : { error },
    { status, headers: NO_STORE },
  );
}

function fieldErrors(error: z.ZodError): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "body";
    result[key] = [...(result[key] ?? []), issue.message];
  }
  return result;
}

export async function PATCH(
  request: Request,
  context: {
    params: Promise<{ workspaceSlug: string; productSlug: string; releaseId: string }>;
  },
): Promise<NextResponse> {
  const { workspaceSlug, productSlug, releaseId } = await context.params;
  const authorized = await authorizeAppApi({
    request,
    workspaceSlug,
    productSlug,
    permission: "release:write",
    mutation: true,
  });
  if (!authorized.ok) return authorized.response;

  const id = releaseIdSchema.safeParse(releaseId);
  if (!id.success) return failure(400, "That release id is not valid.");

  const body = await request.json().catch(() => null);
  const parsed = releaseDraftUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return failure(400, "Check the draft fields.", fieldErrors(parsed.error));
  }

  const result = await updateReleaseDraft(
    {
      workspaceId: authorized.context.workspace.id,
      productId: authorized.context.product.id,
      userId: authorized.context.user.id,
    },
    id.data,
    parsed.data,
  );

  if (!result.ok) {
    if (result.status === 500) {
      await reportError(
        new Error(result.error),
        {
          requestId: requestIdFor(request),
          route: "PATCH /api/app/changelog/:releaseId",
          productId: authorized.context.product.id,
        },
        "releases.draft_update_failed",
      );
    }
    return failure(result.status, result.error, result.fieldErrors);
  }

  const release = await findReleaseForProduct(
    authorized.context.product.id,
    result.releaseId,
  );
  if (!release) return failure(500, "The draft was updated but could not be read back.");

  return NextResponse.json(
    { release: { ...release, status: "draft" } },
    { headers: NO_STORE },
  );
}
