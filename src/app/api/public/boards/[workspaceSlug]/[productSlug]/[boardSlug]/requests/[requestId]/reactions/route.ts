import type { NextRequest } from "next/server";
import { z } from "zod";

import { setCustomerSessionCookie } from "@/features/customer-session/http";
import {
  consumeRateLimit,
  rateLimitKey,
} from "@/features/customer-session/rate-limit";
import { publicJson, resolvePublicActor } from "@/features/public/actor";
import { setCustomerReaction } from "@/features/public/engagement";

/**
 * Add or remove one emoji reaction.
 *
 * The kind is a closed enum, and the unique index on (post, customer, kind)
 * makes a repeated reaction a no-op rather than a duplicate.
 */

export const dynamic = "force-dynamic";

const kindSchema = z.enum(["like", "love", "celebrate"]);
type ReactionKind = z.infer<typeof kindSchema>;

type Params = {
  workspaceSlug: string;
  productSlug: string;
  boardSlug: string;
  requestId: string;
};

async function handle(
  request: NextRequest,
  params: Params,
  kind: ReactionKind,
  reacted: boolean,
): Promise<Response> {
  const actor = await resolvePublicActor(request, params);
  if (!actor.ok) return actor.response;

  const limit = await consumeRateLimit({
    bucket: rateLimitKey(request, "public:reaction"),
    limit: 120,
    windowSeconds: 60 * 60,
  });
  if (!limit.allowed) {
    return publicJson({ error: "Too many changes. Please try again later." }, 429);
  }

  const result = await setCustomerReaction({
    tenant: actor.actor.tenant,
    requestId: params.requestId,
    customerId: actor.actor.customerId,
    kind,
    reacted,
  });

  if (!result.ok) return publicJson({ error: result.error }, result.status);

  const response = publicJson({ reacted: result.reacted, count: result.count });
  if (actor.actor.guestCookie) {
    setCustomerSessionCookie(response, actor.actor.guestCookie);
  }
  return response;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<Params> },
): Promise<Response> {
  const body: unknown = await request.json().catch(() => null);
  const parsed = kindSchema.safeParse((body as { kind?: unknown } | null)?.kind);
  if (!parsed.success) return publicJson({ error: "Choose a reaction." }, 400);

  return handle(request, await context.params, parsed.data, true);
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<Params> },
): Promise<Response> {
  const parsed = kindSchema.safeParse(new URL(request.url).searchParams.get("kind"));
  if (!parsed.success) return publicJson({ error: "Choose a reaction." }, 400);

  return handle(request, await context.params, parsed.data, false);
}
