import { NextResponse } from "next/server";
import { z } from "zod";

import { authorizeAppApi } from "@/features/app-api/auth";
import { cancelFeedbackImport, getFeedbackImport } from "@/features/import/service";

/**
 * Import progress.
 *
 * The import page polls this while a queued job works through the stored rows.
 * It is scoped to the authorized product, so an import id from another product
 * is the same 404 as a missing one.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "cache-control": "private, no-store" } as const;
const uuidSchema = z.uuid();

export async function GET(
  request: Request,
  context: {
    params: Promise<{ workspaceSlug: string; productSlug: string; importId: string }>;
  },
): Promise<NextResponse> {
  const { workspaceSlug, productSlug, importId } = await context.params;

  const authorized = await authorizeAppApi({
    request,
    workspaceSlug,
    productSlug,
    permission: "settings:manage",
  });
  if (!authorized.ok) return authorized.response;

  // A malformed id must be a 404, not a database cast error.
  if (!uuidSchema.safeParse(importId).success) {
    return NextResponse.json({ error: "Import not found." }, { status: 404, headers: NO_STORE });
  }

  const detail = await getFeedbackImport(authorized.context.product.id, importId);
  if (!detail) {
    return NextResponse.json({ error: "Import not found." }, { status: 404, headers: NO_STORE });
  }

  return NextResponse.json({ import: detail }, { headers: NO_STORE });
}

/** Cancel a queued or running import; finished imports are left as they are. */
export async function DELETE(
  request: Request,
  context: {
    params: Promise<{ workspaceSlug: string; productSlug: string; importId: string }>;
  },
): Promise<NextResponse> {
  const { workspaceSlug, productSlug, importId } = await context.params;

  const authorized = await authorizeAppApi({
    request,
    workspaceSlug,
    productSlug,
    permission: "settings:manage",
    mutation: true,
  });
  if (!authorized.ok) return authorized.response;

  if (!uuidSchema.safeParse(importId).success) {
    return NextResponse.json({ error: "Import not found." }, { status: 404, headers: NO_STORE });
  }

  const cancelled = await cancelFeedbackImport(authorized.context.product.id, importId);
  if (!cancelled) {
    return NextResponse.json(
      { error: "That import is no longer running." },
      { status: 409, headers: NO_STORE },
    );
  }

  return NextResponse.json({ cancelled: true }, { headers: NO_STORE });
}
