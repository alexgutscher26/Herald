import { NextResponse } from "next/server";

import { authorizeAppApi } from "@/features/app-api/auth";
import {
  inlineImageMarkdown,
  inlineImagePath,
} from "@/features/releases/inline-images";
import { MAX_UPLOAD_BYTES } from "@/features/storage/limits";
import { storeUpload } from "@/features/storage/upload";
import { reportError } from "@/lib/error-report";
import { requestIdFor } from "@/lib/request-context";

/**
 * Upload one inline release image.
 *
 * The editor inserts the returned stable path into Markdown. No base64 and no
 * expiring signed URL is ever written to the release body: the image route
 * resolves the key and applies its own read authorization.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "cache-control": "private, no-store" } as const;
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

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
  if (!ALLOWED_TYPES.includes(file.type)) {
    return failure(400, "Choose a PNG, JPEG, WebP or GIF image.");
  }
  if (file.size > MAX_UPLOAD_BYTES.image) {
    return failure(400, "Inline images must be smaller than 5 MB.");
  }

  const requestId = requestIdFor(request);
  try {
    const uploaded = await storeUpload({
      workspaceId: authorized.context.workspace.id,
      productId: authorized.context.product.id,
      kind: "image",
      fileName: file.name || "image",
      mimeType: file.type,
      body: new Uint8Array(await file.arrayBuffer()),
    });
    if (!uploaded.ok) return failure(400, uploaded.error);

    return NextResponse.json(
      {
        key: uploaded.object.key,
        url: inlineImagePath(uploaded.object.key),
        markdown: inlineImageMarkdown(uploaded.object.key, file.name || "Release image"),
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    await reportError(
      error,
      { requestId, route: "/api/app/[workspace]/[product]/releases/images" },
      "storage.inline_image_upload_failed",
    );
    return failure(500, "The image could not be stored.");
  }
}
