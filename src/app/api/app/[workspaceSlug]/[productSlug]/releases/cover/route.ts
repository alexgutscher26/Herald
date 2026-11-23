import { NextResponse } from "next/server";

import { authorizeAppApi } from "@/features/app-api/auth";
import { createSignedStorageUrl } from "@/features/storage/urls";
import { storeUpload } from "@/features/storage/upload";
import { reportError } from "@/lib/error-report";
import { requestIdFor } from "@/lib/request-context";

/**
 * Upload one release cover.
 *
 * A cover is bytes in the storage module, so the upload cannot travel through
 * the action that saves the release: the object is validated against its magic
 * bytes, stored, and answered with its key plus a signed preview URL. The
 * editor persists only the key. This route never touches the database.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
    permission: "release:write",
    mutation: true,
  });
  if (!authorized.ok) return authorized.response;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return failure(400, "Send the cover as multipart form data.");
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return failure(400, "Choose an image to upload.");
  }

  const requestId = requestIdFor(request);
  try {
    const uploaded = await storeUpload({
      workspaceId: authorized.context.workspace.id,
      productId: authorized.context.product.id,
      kind: "cover",
      fileName: file.name || "cover",
      mimeType: file.type,
      body: new Uint8Array(await file.arrayBuffer()),
    });
    if (!uploaded.ok) return failure(400, uploaded.error);

    return NextResponse.json(
      {
        key: uploaded.object.key,
        url: createSignedStorageUrl(uploaded.object.key),
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    await reportError(
      error,
      { requestId, route: "/api/app/[workspace]/[product]/releases/cover" },
      "storage.cover_upload_failed",
    );
    return failure(500, "The cover could not be stored.");
  }
}
