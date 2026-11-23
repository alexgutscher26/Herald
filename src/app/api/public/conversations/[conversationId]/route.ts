import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  appendCustomerMessage,
  loadCustomerThread,
  markCustomerConversationRead,
} from "@/features/conversations/customer";
import {
  NO_STORE,
  jsonError,
  readCustomerSessionCookie,
  rejectCrossOrigin,
} from "@/features/customer-session/http";
import { enforcePublicWriteLimit } from "@/features/customer-session/public-write-limit";
import { scheduleJunoAnswer } from "@/features/juno/schedule";

export const dynamic = "force-dynamic";

const replySchema = z.object({
  body: z.string().min(1).max(4000),
});

type Params = { conversationId: string };

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

  const json: unknown = await request.json().catch(() => null);
  const parsed = replySchema.safeParse(json);
  if (!parsed.success) return jsonError(400, "Write a message first.");

  const result = await appendCustomerMessage({
    workspaceSlug,
    productSlug,
    conversationId,
    body: parsed.data.body,
    sessionCookie: readCustomerSessionCookie(request),
  });

  if (result.state === "not_found") return jsonError(404, "Not found.");
  if (result.state === "signed_out") return jsonError(401, "Start a session first.");
  if (result.state === "invalid") return jsonError(400, result.error);

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
