import { NextResponse } from "next/server";

import { getStorage } from "@/features/storage";
import { safeFileName } from "@/features/storage/limits";
import { getStorageSigningSecret } from "@/features/storage/signing";
import { verifyStorageSignature } from "@/features/storage/signed";
import { reportError } from "@/lib/error-report";
import { attachRequestId, requestIdFor } from "@/lib/request-context";

/**
 * Signed object download.
 *
 * A missing, malformed, expired or wrongly-signed URL is a 404 — the same
 * answer as a missing object, so the endpoint is not an existence oracle.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "cache-control": "private, no-store" } as const;

export async function GET(
  request: Request,
  context: { params: Promise<{ key: string[] }> },
): Promise<NextResponse> {
  const requestId = requestIdFor(request);
  const notFound = () =>
    attachRequestId(new NextResponse("Not found.", { status: 404, headers: NO_STORE }), requestId);

  const params = await context.params;
  const key = params.key.join("/");
  const url = new URL(request.url);
  const expires = Number(url.searchParams.get("expires"));
  const signature = url.searchParams.get("signature") ?? "";

  const valid =
    Number.isInteger(expires) &&
    verifyStorageSignature({
      key,
      expiresAt: expires,
      signature,
      secret: getStorageSigningSecret(),
    });

  if (!valid) return notFound();

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
          ...NO_STORE,
        },
      }),
      requestId,
    );
  } catch (error) {
    await reportError(error, { requestId, route: "/api/storage" }, "storage.read_failed");
    return notFound();
  }
}
