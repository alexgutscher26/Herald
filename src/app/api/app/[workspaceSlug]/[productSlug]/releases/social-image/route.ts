import { NextResponse } from "next/server";

import { authorizeAppApi } from "@/features/app-api/auth";
import { createSignedStorageUrl } from "@/features/storage/urls";
import { storeUpload } from "@/features/storage/upload";
import { reportError } from "@/lib/error-report";
import { requestIdFor } from "@/lib/request-context";

/**
 * Upload one release's Open Graph image.
 *
 * Like the cover upload, only the stored key reaches the release row; the
 * image itself is validated against its magic bytes and served through a
 * signed storage URL. Leaving this unset keeps the generated OG card.
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
    return failure(400, "Send the image as multipart form data.");
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
      kind: "social",
      fileName: file.name || "social-image",
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
      { requestId, route: "/api/app/[workspace]/[product]/releases/social-image" },
      "storage.social_image_upload_failed",
    );
    return failure(500, "The social image could not be stored.");
  }
}