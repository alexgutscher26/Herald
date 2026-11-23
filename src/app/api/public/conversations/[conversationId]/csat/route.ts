import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { submitCustomerCsat } from "@/features/conversations/customer";
import { enforcePublicWriteLimit } from "@/features/customer-session/public-write-limit";
import {
  NO_STORE,
  jsonError,
  readCustomerSessionCookie,
  rejectCrossOrigin,
} from "@/features/customer-session/http";

export const dynamic = "force-dynamic";

const ratingSchema = z.object({
  rating: z.number().int().min(1).max(5),
});

type Params = { conversationId: string };

/**
 * One CSAT rating for a resolved conversation.
 *
 * The customer session is the only identity accepted; the conversation id from
 * the path is scoped to that session and product on the server. A thread that
 * was not resolved with CSAT enabled, or was already rated, is refused rather
 * than overwritten.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<Params> },
) {
  const blocked = rejectCrossOrigin(request);
  if (blocked) return blocked;

  const limited = await enforcePublicWriteLimit(request, "public:csat", 10);
  if (limited) return limited;

  const { conversationId } = await params;
  const url = new URL(request.url);
  const workspaceSlug = url.searchParams.get("workspaceSlug") ?? "";
  const productSlug = url.searchParams.get("productSlug") ?? "";
  if (!workspaceSlug || !productSlug) {
    return jsonError(400, "A workspace and product are required.");
  }

  const json: unknown = await request.json().catch(() => null);
  const parsed = ratingSchema.safeParse(json);
  if (!parsed.success) return jsonError(400, "Choose a rating from 1 to 5.");

  const result = await submitCustomerCsat({
    workspaceSlug,
    productSlug,
    conversationId,
    rating: parsed.data.rating,
    sessionCookie: readCustomerSessionCookie(request),
  });

  if (result.state === "not_found") return jsonError(404, "Not found.");
  if (result.state === "signed_out") return jsonError(401, "Start a session first.");
  if (result.state === "invalid") return jsonError(400, result.error);

  return NextResponse.json(
    { ok: true, rating: result.rating },
    { headers: NO_STORE },
  );
}
