import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  loadCustomerThreads,
  resolveCustomerProductForSession,
  startCustomerConversation,
} from "@/features/conversations/customer";
import {
  createGuestCustomerSession,
} from "@/features/customer-session/session";
import {
  NO_STORE,
  jsonError,
  readCustomerSessionCookie,
  rejectCrossOrigin,
  setCustomerSessionCookie,
} from "@/features/customer-session/http";
import { enforcePublicWriteLimit } from "@/features/customer-session/public-write-limit";
import { buildWidgetSourceContext, normalizeSourceUrl } from "@/features/conversations/visitor";
import { scheduleJunoAnswer } from "@/features/juno/schedule";
import { getStorage } from "@/features/storage";
import { safeFileName } from "@/features/storage/limits";
import { storeUpload } from "@/features/storage/upload";
import type { StoredObject } from "@/features/storage/types";

export const dynamic = "force-dynamic";

const startSchema = z.object({
  workspaceSlug: z.string().min(1).max(120),
  productSlug: z.string().min(1).max(120),
  subject: z.string().max(160).nullish(),
  // An image can be sent without text; the service supplies the customer-
  // visible preview line for an attachment-only message.
  body: z.string().max(4000),
  email: z.string().max(254).nullish(),
  sourceUrl: z.string().max(2048).nullish(),
  timezone: z.string().max(64).nullish(),
  /** Optional structured intake; unknown keys are ignored by the service. */
  intake: z.record(z.string(), z.unknown()).nullish(),
});

type StartInput = z.infer<typeof startSchema>;

function formText(form: FormData, key: string): string | undefined {
  const value = form.get(key);
  return typeof value === "string" ? value : undefined;
}

async function parseStartRequest(
  request: NextRequest,
): Promise<
  | { ok: true; data: StartInput; image: File | null }
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

    const rawIntake = formText(form, "intake");
    let intake: unknown;
    if (rawIntake && rawIntake.trim() !== "") {
      try {
        intake = JSON.parse(rawIntake);
      } catch {
        return {
          ok: false,
          response: jsonError(400, "Check the message and try again."),
        };
      }
    }

    const parsed = startSchema.safeParse({
      workspaceSlug: formText(form, "workspaceSlug") ?? "",
      productSlug: formText(form, "productSlug") ?? "",
      subject: formText(form, "subject"),
      body: formText(form, "body") ?? "",
      email: formText(form, "email"),
      sourceUrl: formText(form, "sourceUrl"),
      timezone: formText(form, "timezone"),
      intake,
    });
    if (!parsed.success) {
      return {
        ok: false,
        response: jsonError(400, "Check the message and try again."),
      };
    }

    return { ok: true, data: parsed.data, image: images[0] ?? null };
  }

  const json: unknown = await request.json().catch(() => null);
  const parsed = startSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      response: jsonError(400, "Check the message and try again."),
    };
  }
  return { ok: true, data: parsed.data, image: null };
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const workspaceSlug = url.searchParams.get("workspaceSlug") ?? "";
  const productSlug = url.searchParams.get("productSlug") ?? "";
  if (!workspaceSlug || !productSlug) {
    return jsonError(400, "A workspace and product are required.");
  }

  const result = await loadCustomerThreads({
    workspaceSlug,
    productSlug,
    sessionCookie: readCustomerSessionCookie(request),
  });

  if (result.state === "not_found") return jsonError(404, "Not found.");
  return NextResponse.json(result, { headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  const blocked = rejectCrossOrigin(request);
  if (blocked) return blocked;

  const limited = await enforcePublicWriteLimit(
    request,
    "public:conversation-start",
    10,
  );
  if (limited) return limited;

  const parsedInput = await parseStartRequest(request);
  if (!parsedInput.ok) return parsedInput.response;
  const { data, image } = parsedInput;

  const product = await resolveCustomerProductForSession({
    workspaceSlug: data.workspaceSlug,
    productSlug: data.productSlug,
  });
  if (!product) return jsonError(404, "Not found.");

  let stored: StoredObject | null = null;
  if (image) {
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
      console.error("[conversations] widget image upload failed", error);
      return jsonError(500, "The image could not be stored.");
    }
  }

  let cookie = readCustomerSessionCookie(request);
  let issued: string | null = null;

  // A visitor may write before any session exists; the widget gets a guest
  // session at that point, exactly like a first vote on a public board.
  if (!cookie) {
    const guest = await createGuestCustomerSession(product.workspaceId);
    cookie = guest.cookieValue;
    issued = guest.cookieValue;
  }

  const { sourceUrl, ...message } = data;
  const sourceContext = buildWidgetSourceContext({
    sourceUrl,
    timezone: data.timezone,
    locale: request.headers.get("accept-language"),
    userAgent: request.headers.get("user-agent"),
  });

  let result: Awaited<ReturnType<typeof startCustomerConversation>>;
  try {
    result = await startCustomerConversation({
      ...message,
      sourceUrl: normalizeSourceUrl(sourceUrl),
      sourceContext,
      sessionCookie: cookie,
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
    if (stored) {
      await getStorage().delete(stored.key).catch(() => undefined);
    }
    console.error("[conversations] widget start failed", error);
    return jsonError(500, "Could not send the message.");
  }

  if (result.state !== "ready") {
    if (stored) {
      await getStorage().delete(stored.key).catch(() => undefined);
    }
    if (result.state === "not_found") return jsonError(404, "Not found.");
    if (result.state === "signed_out") return jsonError(401, "Start a session first.");
    return jsonError(400, result.error);
  }

  await scheduleJunoAnswer({
    conversationId: result.conversationId,
    messageId: result.messageId,
  });

  const response = NextResponse.json(
    { conversationId: result.conversationId },
    { status: 201, headers: NO_STORE },
  );
  if (issued) setCustomerSessionCookie(response, issued);
  return response;
}
