import { NextResponse } from "next/server";
import { z } from "zod";

import { findReleaseForProduct } from "@/db/queries/releases";
import { authorizeAppApi } from "@/features/app-api/auth";
import { releaseDraftCreateSchema } from "@/features/releases/draft-schema";
import { createReleaseDraft } from "@/features/releases/draft-service";
import { reportError } from "@/lib/error-report";
import { requestIdFor } from "@/lib/request-context";

/**
 * Create a changelog draft.
 *
 * Session-authenticated like the other `/api/app` routes. There is no `status`
 * field: the API cannot publish, schedule or archive. Publishing remains the
 * explicit editor action.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "cache-control": "private, no-store" } as const;

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

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceSlug: string; productSlug: string }> },
): Promise<NextResponse> {
  const { workspaceSlug, productSlug } = await context.params;
  const authorized = await authorizeAppApi({
    request,
    workspaceSlug,
    productSlug,
    permission: "release:write",
    mutation: true,
  });
  if (!authorized.ok) return authorized.response;

  const body = await request.json().catch(() => null);
  const parsed = releaseDraftCreateSchema.safeParse(body);
  if (!parsed.success) {
    return failure(400, "Check the draft fields.", fieldErrors(parsed.error));
  }

  const result = await createReleaseDraft(
    {
      workspaceId: authorized.context.workspace.id,
      productId: authorized.context.product.id,
      userId: authorized.context.user.id,
    },
    parsed.data,
  );

  if (!result.ok) {
    if (result.status === 500) {
      await reportError(
        new Error(result.error),
        {
          requestId: requestIdFor(request),
          route: "POST /api/app/changelog",
          productId: authorized.context.product.id,
        },
        "releases.draft_create_failed",
      );
    }
    return failure(result.status, result.error, result.fieldErrors);
  }

  const release = await findReleaseForProduct(
    authorized.context.product.id,
    result.releaseId,
  );
  if (!release) return failure(500, "The draft was created but could not be read back.");

  return NextResponse.json(
    { release: { ...release, status: "draft" } },
    { status: 201, headers: NO_STORE },
  );
}
