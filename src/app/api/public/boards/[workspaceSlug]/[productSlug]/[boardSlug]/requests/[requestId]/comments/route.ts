import type { NextRequest } from "next/server";
import { z } from "zod";

import { setCustomerSessionCookie } from "@/features/customer-session/http";
import {
  consumeRateLimit,
  rateLimitKey,
} from "@/features/customer-session/rate-limit";
import { publicJson, resolvePublicActor } from "@/features/public/actor";
import { addPublicComment } from "@/features/public/engagement";
import { reportError } from "@/lib/error-report";

/**
 * Add a public comment.
 *
 * A moderated board records a pending review and answers `awaiting_review`;
 * the comment is then visible only to its author until a moderator approves it.
 */

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  body: z.string().trim().min(2, "Write a little more.").max(4_000),
  privacy: z.enum(["public", "author", "company"]).default("public"),
});

type Params = {
  workspaceSlug: string;
  productSlug: string;
  boardSlug: string;
  requestId: string;
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<Params> },
): Promise<Response> {
  const params = await context.params;

  try {
    const actor = await resolvePublicActor(request, params);
    if (!actor.ok) return actor.response;

    const limit = await consumeRateLimit({
      bucket: rateLimitKey(request, "public:comment"),
      limit: 30,
      windowSeconds: 60 * 60,
    });
    if (!limit.allowed) {
      return publicJson({ error: "Too many comments. Please try again later." }, 429);
    }

    const body: unknown = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return publicJson(
        { error: parsed.error.issues[0]?.message ?? "Write a comment first." },
        400,
      );
    }

    const result = await addPublicComment({
      tenant: actor.actor.tenant,
      requestId: params.requestId,
      customerId: actor.actor.customerId,
      customerName: actor.actor.customerName,
      body: parsed.data.body,
      privacy: parsed.data.privacy,
    });

    if (!result.ok) {
      return publicJson(
        { error: result.error, ...(result.field ? { field: result.field } : {}) },
        result.status,
      );
    }

    const response = publicJson(
      { status: result.status, commentId: result.commentId },
      201,
    );
    if (actor.actor.guestCookie) {
      setCustomerSessionCookie(response, actor.actor.guestCookie);
    }
    return response;
  } catch (error) {
    await reportError(error, { route: "public.comment.create" }, "public.comment_failed");
    return publicJson({ error: "Could not add the comment." }, 500);
  }
}
