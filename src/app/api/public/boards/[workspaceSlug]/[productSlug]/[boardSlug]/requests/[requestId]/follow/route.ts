import type { NextRequest } from "next/server";

import { setCustomerSessionCookie } from "@/features/customer-session/http";
import {
  consumeRateLimit,
  rateLimitKey,
} from "@/features/customer-session/rate-limit";
import { publicJson, resolvePublicActor } from "@/features/public/actor";
import { setCustomerFollow } from "@/features/public/engagement";

/**
 * Follow or unfollow a request.
 *
 * Following is what will notify this customer about status changes; the row is
 * unique per (post, customer), so repeated follows are harmless.
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
  follows: boolean,
): Promise<Response> {
  const actor = await resolvePublicActor(request, params);
  if (!actor.ok) return actor.response;

  const limit = await consumeRateLimit({
    bucket: rateLimitKey(request, "public:follow"),
    limit: 120,
    windowSeconds: 60 * 60,
  });
  if (!limit.allowed) {
    return publicJson({ error: "Too many changes. Please try again later." }, 429);
  }

  const result = await setCustomerFollow({
    tenant: actor.actor.tenant,
    requestId: params.requestId,
    customerId: actor.actor.customerId,
    follows,
  });

  if (!result.ok) return publicJson({ error: result.error }, result.status);

  const response = publicJson({ follows: result.follows });
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
