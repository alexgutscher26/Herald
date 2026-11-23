import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { workspaceBranding } from "@/db/schema/branding";
import { workspaces } from "@/db/schema/workspaces";
import { hasFeature, toPlanId } from "@/features/entitlements/plans";
import { getStorage } from "@/features/storage";
import { isSafeStorageKey } from "@/features/storage/limits";

/**
 * Public logo.
 *
 * The object key stays private; this route is the only public way to read it.
 * The version query string changes whenever branding is saved, so the response
 * can be cached as immutable. A missing workspace and a missing logo are the
 * same 404.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NOT_FOUND = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };

export async function GET(
  _request: Request,
  context: { params: Promise<{ workspaceSlug: string }> },
): Promise<NextResponse> {
  const { workspaceSlug } = await context.params;

  const rows = await db
    .select({ logoKey: workspaceBranding.logoKey, plan: workspaces.plan })
    .from(workspaces)
    .innerJoin(workspaceBranding, eq(workspaceBranding.workspaceId, workspaces.id))
    .where(eq(workspaces.slug, workspaceSlug))
    .limit(1);

  const row = rows[0];
  // Custom logos are a paid branding feature. A downgraded workspace keeps the
  // file, but this public route must stop serving it.
  const key = row && hasFeature(toPlanId(row.plan), "customBranding") ? row.logoKey : null;
  if (!key || !isSafeStorageKey(key)) {
    return new NextResponse("Not found.", { status: 404, headers: NOT_FOUND });
  }

  const stored = await getStorage().get(key);
  if (!stored) {
    return new NextResponse("Not found.", { status: 404, headers: NOT_FOUND });
  }

  return new NextResponse(new Uint8Array(stored.body), {
    status: 200,
    headers: {
      "content-type": stored.object.contentType,
      "content-length": String(stored.object.byteSize),
      etag: `"sha256-${stored.object.checksum}"`,
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
}
