import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { resolveCustomerProductForSession } from "@/features/conversations/customer";
import { enforcePublicWriteLimit } from "@/features/customer-session/public-write-limit";
import {
  NO_STORE,
  jsonError,
  readCustomerSessionCookie,
  rejectCrossOrigin,
} from "@/features/customer-session/http";
import { findActiveCustomerSession } from "@/features/customer-session/session";
import { respondToFeedbackCard } from "@/features/juno/feedback-cards";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  actionId: z.uuid(),
  decision: z.enum(["confirm", "decline"]),
});

type Params = { conversationId: string };

/**
 * Confirm or decline one Juno feedback card.
 *
 * The card id is never trusted on its own: the action must belong to the
 * conversation in the URL and to the customer in the first-party session.
 * Nothing is filed or voted before this endpoint runs.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<Params> },
) {
  const blocked = rejectCrossOrigin(request);
  if (blocked) return blocked;

  const limited = await enforcePublicWriteLimit(request, "public:feedback-card", 30);
  if (limited) return limited;

  const { conversationId } = await params;
  const url = new URL(request.url);
  const workspaceSlug = url.searchParams.get("workspaceSlug") ?? "";
  const productSlug = url.searchParams.get("productSlug") ?? "";
  if (!workspaceSlug || !productSlug) {
    return jsonError(400, "A workspace and product are required.");
  }

  const json: unknown = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return jsonError(400, "That card is not valid.");

  const product = await resolveCustomerProductForSession({
    workspaceSlug,
    productSlug,
  });
  if (!product) return jsonError(404, "Not found.");

  const active = await findActiveCustomerSession(
    readCustomerSessionCookie(request),
  );
  if (!active || active.session.workspaceId !== product.workspaceId) {
    return jsonError(401, "Start a session first.");
  }

  const result = await respondToFeedbackCard({
    actionId: parsed.data.actionId,
    conversationId,
    customerId: active.customer.id,
    isGuest: active.session.guest,
    decision: parsed.data.decision,
  });

  if (!result.ok) return jsonError(400, result.error);
  return NextResponse.json(result, { headers: NO_STORE });
}
