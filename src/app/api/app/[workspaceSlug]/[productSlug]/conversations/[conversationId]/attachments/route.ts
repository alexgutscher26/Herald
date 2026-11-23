import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { conversationAttachments, conversations } from "@/db/schema/conversations";
import { authorizeAppApi } from "@/features/app-api/auth";
import { safeFileName } from "@/features/storage/limits";
import { storeUpload } from "@/features/storage/upload";
import { createSignedStorageUrl } from "@/features/storage/urls";

/**
 * Upload one operator attachment.
 *
 * The row starts with `messageId` null. The reply service consumes it in the
 * transaction that creates the message, so an uploaded file that is never sent
 * is not shown in the customer thread. The operator UI sends at most five ids
 * with one reply.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "cache-control": "private, no-store" } as const;

function failure(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

export async function POST(
  request: Request,
  context: {
    params: Promise<{
      workspaceSlug: string;
      productSlug: string;
      conversationId: string;
    }>;
  },
): Promise<NextResponse> {
  const { workspaceSlug, productSlug, conversationId } = await context.params;
  const authorized = await authorizeAppApi({
    request,
    workspaceSlug,
    productSlug,
    permission: "conversation:write",
    mutation: true,
  });
  if (!authorized.ok) return authorized.response;

  const conversation = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.productId, authorized.context.product.id),
      ),
    )
    .limit(1);
  if (!conversation[0]) return failure(404, "Not found.");

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return failure(400, "Send the file as multipart form data.");
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return failure(400, "Choose a file to attach.");
  }

  try {
    const uploaded = await storeUpload({
      workspaceId: authorized.context.workspace.id,
      productId: authorized.context.product.id,
      kind: "attachment",
      fileName: file.name || "attachment",
      mimeType: file.type,
      body: new Uint8Array(await file.arrayBuffer()),
    });
    if (!uploaded.ok) return failure(400, uploaded.error);

    const inserted = await db
      .insert(conversationAttachments)
      .values({
        conversationId,
        productId: authorized.context.product.id,
        kind: file.type.startsWith("image/") ? "image" : "file",
        storageKey: uploaded.object.key,
        filename: safeFileName(file.name || "attachment"),
        mimeType: file.type,
        sizeBytes: file.size,
      })
      .returning({ id: conversationAttachments.id });

    const attachment = inserted[0];
    if (!attachment) return failure(500, "The attachment could not be saved.");

    return NextResponse.json(
      {
        id: attachment.id,
        filename: safeFileName(file.name || "attachment"),
        mimeType: file.type,
        sizeBytes: file.size,
        kind: file.type.startsWith("image/") ? "image" : "file",
        url: createSignedStorageUrl(uploaded.object.key),
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    console.error("[conversations] attachment upload failed", error);
    return failure(500, "The attachment could not be stored.");
  }
}
