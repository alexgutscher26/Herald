import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { publicSurfaceEnabled } from "@/features/entitlements/entitlements";
import { resolvePublicWorkspace } from "@/features/public/resolver";
import {
  consumeRateLimit,
  rateLimitKey,
} from "@/features/customer-session/rate-limit";
import {
  NO_STORE,
  jsonError,
  readCustomerSessionCookie,
  rejectCrossOrigin,
  setCustomerSessionCookie,
} from "@/features/customer-session/http";
import {
  createGuestCustomerSession,
  findActiveCustomerSession,
  toCustomerSessionView,
} from "@/features/customer-session/session";
import { validateSlug } from "@/lib/slug";

/**
 * Customer session bootstrap.
 *
 * POST creates a guest customer + session for a workspace that has a public
 * board. GET reports the current session without creating one. Both responses
 * are private and uncached.
 */

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  workspaceSlug: z.string().trim().min(1).max(80),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  const active = await findActiveCustomerSession(readCustomerSessionCookie(request));

  return NextResponse.json(
    { session: active ? toCustomerSessionView(active) : null },
    { headers: NO_STORE },
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  const limit = await consumeRateLimit({
    bucket: rateLimitKey(request, "customer-session:create"),
    limit: 30,
    windowSeconds: 60,
  });
  if (!limit.allowed) {
    return jsonError(429, "Too many attempts. Please try again in a minute.");
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "Choose a workspace first.");

  const slug = validateSlug(parsed.data.workspaceSlug);
  if (!slug.ok) return jsonError(400, "That workspace URL is not valid.");

  const workspace = await resolvePublicWorkspace(slug.slug);
  if (!workspace || !publicSurfaceEnabled(workspace.plan)) {
    return jsonError(404, "Workspace not found.");
  }

  const existing = await findActiveCustomerSession(readCustomerSessionCookie(request));
  if (existing && existing.session.workspaceId === workspace.id) {
    return NextResponse.json(
      { session: toCustomerSessionView(existing) },
      { headers: NO_STORE },
    );
  }

  const created = await createGuestCustomerSession(workspace.id);
  const response = NextResponse.json(
    { session: toCustomerSessionView(created.active) },
    { headers: NO_STORE },
  );
  setCustomerSessionCookie(response, created.cookieValue);
  return response;
}
