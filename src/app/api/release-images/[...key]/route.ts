import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { releases, workspaceMembers } from "@/db/schema";
import { isInlineImageKey } from "@/features/releases/inline-images";
import { getStorage } from "@/features/storage";
import { safeFileName } from "@/features/storage/limits";
import { reportError } from "@/lib/error-report";
import { attachRequestId, requestIdFor } from "@/lib/request-context";

/**
 * Serve an inline release image.
 *
 * A key is readable when it appears in the body of a published, public
 * changelog entry, or when the signed-in user belongs to the workspace that
 * owns it (so drafts and editor previews work). Everything else is a 404. The
 * object itself still comes from the storage module; the body only ever stores
 * this stable path.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function workspaceIdFromKey(key: string): string | null {
  const parts = key.split("/");
  return parts[0] === "workspaces" && parts[1] ? parts[1] : null;
}

async function isPubliclyPublished(key: string): Promise<boolean> {
  const rows = await db
    .select({ id: releases.id })
    .from(releases)
    .where(
      and(
        eq(releases.status, "published"),
        eq(releases.channelPublicChangelog, true),
        sql`position(${key} in coalesce(${releases.bodyMarkdown}, '')) > 0`,
      ),
    )
    .limit(1);
  return Boolean(rows[0]);
}

async function isWorkspaceMember(workspaceId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .limit(1);
  return Boolean(rows[0]);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ key: string[] }> },
): Promise<NextResponse> {
  const requestId = requestIdFor(request);
  const notFound = () =>
    attachRequestId(
      new NextResponse("Not found.", {
        status: 404,
        headers: { "cache-control": "private, no-store" },
      }),
      requestId,
    );

  const key = (await context.params).key.join("/");
  if (!isInlineImageKey(key)) return notFound();

  const publiclyVisible = await isPubliclyPublished(key);
  if (!publiclyVisible) {
    // Load auth only for private draft previews. Published public images never
    // touch the session stack, which keeps the hot path lean.
    const { getSessionUser } = await import("@/lib/authz");
    const user = await getSessionUser();
    const workspaceId = workspaceIdFromKey(key);
    if (!user || !workspaceId || !(await isWorkspaceMember(workspaceId, user.id))) {
      return notFound();
    }
  }

  try {
    const stored = await getStorage().get(key);
    if (!stored) return notFound();

    const fileName = safeFileName(stored.object.fileName).replaceAll('"', "");
    return attachRequestId(
      new NextResponse(new Uint8Array(stored.body), {
        status: 200,
        headers: {
          "content-type": stored.object.contentType,
          "content-length": String(stored.object.byteSize),
          etag: `"sha256-${stored.object.checksum}"`,
          "content-disposition": `inline; filename="${fileName}"`,
          "cache-control": publiclyVisible
            ? "public, max-age=60, stale-while-revalidate=300"
            : "private, max-age=60",
          "x-content-type-options": "nosniff",
        },
      }),
      requestId,
    );
  } catch (error) {
    await reportError(
      error,
      { requestId, route: "/api/release-images" },
      "storage.inline_image_read_failed",
    );
    return notFound();
  }
}
