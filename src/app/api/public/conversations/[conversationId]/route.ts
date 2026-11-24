import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  appendCustomerMessage,
  loadCustomerThread,
  markCustomerConversationRead,
  resolveCustomerProductForSession,
} from "@/features/conversations/customer";
import {
  NO_STORE,
  jsonError,
  readCustomerSessionCookie,
  rejectCrossOrigin,
} from "@/features/customer-session/http";
import { enforcePublicWriteLimit } from "@/features/customer-session/public-write-limit";
import { scheduleJunoAnswer } from "@/features/juno/schedule";
import { getStorage } from "@/features/storage";
import { safeFileName } from "@/features/storage/limits";
import type { StoredObject } from "@/features/storage/types";
import { storeUpload } from "@/features/storage/upload";

export const dynamic = "force-dynamic";

const replySchema = z.object({
  body: z.string().min(1).max(4000),
});
const replyFormSchema = z.object({
  body: z.string().max(4000),
});

type Params = { conversationId: string };

function formText(form: FormData, key: string): string | undefined {
  const value = form.get(key);
  return typeof value === "string" ? value : undefined;
}

async function parseReplyRequest(
  request: NextRequest,
): Promise<
  | { ok: true; body: string; image: File | null }
  | { ok: false; response: NextResponse }
> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.toLowerCase().includes("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    if (!form) {
      return { ok: false, response: jsonError(400, "The message could not be read.") };
    }

    const images = form
      .getAll("image")
      .filter((entry): entry is File => entry instanceof File && entry.size > 0);
    if (images.length > 1) {
      return { ok: false, response: jsonError(400, "Attach one image at a time.") };
    }

    const parsed = replyFormSchema.safeParse({
      body: formText(form, "body") ?? "",
    });
    if (!parsed.success) {
      return { ok: false, response: jsonError(400, "Write a message first.") };
    }

    const image = images[0] ?? null;
    if (!image && parsed.data.body.trim() === "") {
      return { ok: false, response: jsonError(400, "Write a message first.") };
    }

    return { ok: true, body: parsed.data.body, image };
  }

  const json: unknown = await request.json().catch(() => null);
  const parsed = replySchema.safeParse(json);
  if (!parsed.success) return { ok: false, response: jsonError(400, "Write a message first.") };
  return { ok: true, body: parsed.data.body, image: null };
}

async function discardUpload(stored: StoredObject | null): Promise<void> {
  if (!stored) return;
  await getStorage().delete(stored.key).catch(() => undefined);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<Params> },
) {
  const { conversationId } = await params;
  const url = new URL(request.url);
  const workspaceSlug = url.searchParams.get("workspaceSlug") ?? "";
  const productSlug = url.searchParams.get("productSlug") ?? "";
  if (!workspaceSlug || !productSlug) {
    return jsonError(400, "A workspace and product are required.");
  }

  const result = await loadCustomerThread({
    workspaceSlug,
    productSlug,
    conversationId,
    sessionCookie: readCustomerSessionCookie(request),
  });

  if (result.state === "not_found") return jsonError(404, "Not found.");
  if (result.state === "signed_out") return jsonError(401, "Start a session first.");
  return NextResponse.json(result, { headers: NO_STORE });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<Params> },
) {
  const blocked = rejectCrossOrigin(request);
  if (blocked) return blocked;

  const limited = await enforcePublicWriteLimit(request, "public:conversation-reply", 30);
  if (limited) return limited;

  const { conversationId } = await params;
  const url = new URL(request.url);
  const workspaceSlug = url.searchParams.get("workspaceSlug") ?? "";
  const productSlug = url.searchParams.get("productSlug") ?? "";
  if (!workspaceSlug || !productSlug) {
    return jsonError(400, "A workspace and product are required.");
  }

  const parsedInput = await parseReplyRequest(request);
  if (!parsedInput.ok) return parsedInput.response;
  const { body, image } = parsedInput;

  const product = image
    ? await resolveCustomerProductForSession({ workspaceSlug, productSlug })
    : null;
  if (image && !product) return jsonError(404, "Not found.");

  let stored: StoredObject | null = null;
  if (image && product) {
    try {
      const uploaded = await storeUpload({
        workspaceId: product.workspaceId,
        productId: product.productId,
        kind: "image",
        fileName: image.name || "image",
        mimeType: image.type,
        body: new Uint8Array(await image.arrayBuffer()),
      });
      if (!uploaded.ok) return jsonError(400, uploaded.error);
      stored = uploaded.object;
    } catch (error) {
      console.error("[conversations] widget reply image upload failed", error);
      return jsonError(500, "The image could not be stored.");
    }
  }

  let result: Awaited<ReturnType<typeof appendCustomerMessage>>;
  try {
    result = await appendCustomerMessage({
      workspaceSlug,
      productSlug,
      conversationId,
      body,
      sessionCookie: readCustomerSessionCookie(request),
      ...(stored && image
        ? {
            attachment: {
              storageKey: stored.key,
              fileName: safeFileName(image.name || "image"),
              mimeType: image.type,
              sizeBytes: image.size,
              kind: "image" as const,
            },
          }
        : {}),
    });
  } catch (error) {
    await discardUpload(stored);
    console.error("[conversations] widget reply failed", error);
    return jsonError(500, "Could not send the message.");
  }

  if (result.state !== "ready") {
    await discardUpload(stored);
    if (result.state === "not_found") return jsonError(404, "Not found.");
    if (result.state === "signed_out") return jsonError(401, "Start a session first.");
    return jsonError(400, result.error);
  }

  await scheduleJunoAnswer({
    conversationId: result.conversationId,
    messageId: result.messageId,
  });

  return NextResponse.json(
    { conversationId: result.conversationId },
    { status: 201, headers: NO_STORE },
  );
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<Params> },
) {
  const blocked = rejectCrossOrigin(request);
  if (blocked) return blocked;

  const { conversationId } = await params;
  const url = new URL(request.url);
  const workspaceSlug = url.searchParams.get("workspaceSlug") ?? "";
  const productSlug = url.searchParams.get("productSlug") ?? "";
  if (!workspaceSlug || !productSlug) {
    return jsonError(400, "A workspace and product are required.");
  }

  const result = await markCustomerConversationRead({
    workspaceSlug,
    productSlug,
    conversationId,
    sessionCookie: readCustomerSessionCookie(request),
  });

  if (!result.ok) return jsonError(404, "Not found.");
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
