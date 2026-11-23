import type { NextRequest } from "next/server";

import { setCustomerSessionCookie } from "@/features/customer-session/http";
import {
  consumeRateLimit,
  rateLimitKey,
} from "@/features/customer-session/rate-limit";
import { publicJson, resolvePublicActor } from "@/features/public/actor";
import { setCustomerVote } from "@/features/public/engagement";
import { trackAnalyticsEvent } from "@/features/analytics/track";

/**
 * Toggle a customer's vote on a request.
 *
 * POST votes, DELETE removes the vote. Both are idempotent at the database
 * level, so a double click or a retried request cannot inflate the count.
 */

export const dynamic = "force-dynamic";

type Params = {
  workspaceSlug: string;
  productSlug: string;
  boardSlug: string;
  requestId: string;
};

async function handle(
  request: NextRequest,
  params: Params,
  voted: boolean,
): Promise<Response> {
  const actor = await resolvePublicActor(request, params);
  if (!actor.ok) return actor.response;

  const limit = await consumeRateLimit({
    bucket: rateLimitKey(request, "public:vote"),
    limit: 120,
    windowSeconds: 60 * 60,
  });
  if (!limit.allowed) {
    return publicJson({ error: "Too many votes. Please try again later." }, 429);
  }

  const result = await setCustomerVote({
    tenant: actor.actor.tenant,
    requestId: params.requestId,
    customerId: actor.actor.customerId,
    voted,
  });

  if (!result.ok) return publicJson({ error: result.error }, result.status);

  if (result.voted) {
    await trackAnalyticsEvent({
      workspaceId: actor.actor.tenant.workspace.id,
      productId: actor.actor.tenant.product.id,
      boardId: actor.actor.tenant.board.id,
      feedbackPostId: params.requestId,
      type: "vote",
    });
  }

  const response = publicJson({
    voted: result.voted,
    voteCount: result.voteCount,
  });
  if (actor.actor.guestCookie) {
    setCustomerSessionCookie(response, actor.actor.guestCookie);
  }
  return response;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<Params> },
): Promise<Response> {
  return handle(request, await context.params, true);
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<Params> },
): Promise<Response> {
  return handle(request, await context.params, false);
}
