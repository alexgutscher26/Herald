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

export const dynamic = "force-dynamic";

const startSchema = z.object({
  workspaceSlug: z.string().min(1).max(120),
  productSlug: z.string().min(1).max(120),
  subject: z.string().max(160).nullish(),
  body: z.string().min(1).max(4000),
  email: z.string().max(254).nullish(),
  sourceUrl: z.string().max(2048).nullish(),
  timezone: z.string().max(64).nullish(),
  /** Optional structured intake; unknown keys are ignored by the service. */
  intake: z.record(z.string(), z.unknown()).nullish(),
});

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

  const json: unknown = await request.json().catch(() => null);
  const parsed = startSchema.safeParse(json);
  if (!parsed.success) return jsonError(400, "Check the message and try again.");

  const product = await resolveCustomerProductForSession({
    workspaceSlug: parsed.data.workspaceSlug,
    productSlug: parsed.data.productSlug,
  });
  if (!product) return jsonError(404, "Not found.");

  let cookie = readCustomerSessionCookie(request);
  let issued: string | null = null;

  // A visitor may write before any session exists; the widget gets a guest
  // session at that point, exactly like a first vote on a public board.
  if (!cookie) {
    const guest = await createGuestCustomerSession(product.workspaceId);
    cookie = guest.cookieValue;
    issued = guest.cookieValue;
  }

  const { sourceUrl, timezone, ...message } = parsed.data;
  const sourceContext = buildWidgetSourceContext({
    sourceUrl,
    timezone,
    locale: request.headers.get("accept-language"),
    userAgent: request.headers.get("user-agent"),
  });

  const result = await startCustomerConversation({
    ...message,
    sourceUrl: normalizeSourceUrl(sourceUrl),
    sourceContext,
    sessionCookie: cookie,
  });

  if (result.state === "not_found") return jsonError(404, "Not found.");
  if (result.state === "signed_out") return jsonError(401, "Start a session first.");
  if (result.state === "invalid") return jsonError(400, result.error);

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
