import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  NO_STORE,
  jsonError,
  readCustomerSessionCookie,
  rejectCrossOrigin,
  setCustomerSessionCookie,
} from "@/features/customer-session/http";
import {
  consumeRateLimit,
  rateLimitKey,
} from "@/features/customer-session/rate-limit";
import { findActiveCustomerSession } from "@/features/customer-session/session";
import { publicSurfaceEnabled } from "@/features/entitlements/entitlements";
import { resolvePublicWorkspace } from "@/features/public/resolver";
import { validateSlug } from "@/lib/slug";

import { identifyWithSso } from "./sso";

/**
 * Shared handler for signed identity handoff.
 *
 * Used by the public session endpoint and by the widget identify endpoint so
 * both enforce the same origin check, rate limit, workspace resolution and
 * error mapping. The body is `{ workspaceSlug, token }`; the token never
 * appears in a URL and is never logged.
 */

const bodySchema = z.object({
  workspaceSlug: z.string().trim().min(1).max(80),
  token: z.string().trim().min(1).max(8192),
});

export async function handleSsoIdentify(request: NextRequest): Promise<NextResponse> {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  const limit = await consumeRateLimit({
    bucket: rateLimitKey(request, "customer-sso:identify"),
    limit: 30,
    windowSeconds: 60,
  });
  if (!limit.allowed) {
    return jsonError(429, "Too many attempts. Please try again in a minute.");
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "Send a workspace and a signed identity token.");
  }

  const slug = validateSlug(parsed.data.workspaceSlug);
  if (!slug.ok) return jsonError(400, "That workspace URL is not valid.");

  const workspace = await resolvePublicWorkspace(slug.slug);
  if (!workspace || !publicSurfaceEnabled(workspace.plan)) {
    return jsonError(404, "Workspace not found.");
  }

  const active = await findActiveCustomerSession(readCustomerSessionCookie(request));
  const result = await identifyWithSso({
    workspace: { id: workspace.id, slug: workspace.slug },
    token: parsed.data.token,
    activeSession: active,
  });

  if (!result.ok) {
    if (result.reason === "disabled") {
      return jsonError(403, "Single sign-on is not enabled for this workspace.");
    }
    if (result.reason === "banned") {
      return jsonError(403, "This account cannot submit requests.");
    }
    if (result.reason === "conflict") {
      return jsonError(409, "That identity conflicts with another customer.");
    }
    return jsonError(401, "That identity token is not valid.");
  }

  const response = NextResponse.json(
    { session: result.session },
    { headers: NO_STORE },
  );
  setCustomerSessionCookie(response, result.cookieValue);
  return response;
}
