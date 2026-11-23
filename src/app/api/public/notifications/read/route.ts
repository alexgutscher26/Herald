import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { jsonError, rejectCrossOrigin } from "@/features/customer-session/http";
import { consumeRateLimit, rateLimitKey } from "@/features/customer-session/rate-limit";
import { markPublicNotificationsRead } from "@/features/notifications/inbox";
import { validateSlug } from "@/lib/slug";

/**
 * Mark every unread in-app notification as read for the signed-in customer.
 *
 * The browser supplies only the product coordinates. The customer comes from
 * the session cookie, and the query is scoped by the product id that belongs
 * to that workspace, so a forged body cannot mark another customer's inbox.
 */

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  workspaceSlug: z.string().trim().min(1).max(80),
  productSlug: z.string().trim().min(1).max(80),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  const limit = await consumeRateLimit({
    bucket: rateLimitKey(request, "notifications-read"),
    limit: 60,
    windowSeconds: 60,
  });
  if (!limit.allowed) {
    return jsonError(429, "Too many updates. Try again in a minute.");
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "That inbox link is not valid.");

  const workspaceSlug = validateSlug(parsed.data.workspaceSlug);
  const productSlug = validateSlug(parsed.data.productSlug);
  if (!workspaceSlug.ok || !productSlug.ok) {
    return jsonError(400, "That inbox link is not valid.");
  }

  const result = await markPublicNotificationsRead({
    workspaceSlug: workspaceSlug.slug,
    productSlug: productSlug.slug,
  });
  if (!result.signedIn) {
    return jsonError(401, "Sign in to manage notifications.");
  }

  return NextResponse.json(
    { ok: true, marked: result.marked },
    { headers: { "cache-control": "no-store" } },
  );
}
