import { NextResponse, type NextRequest } from "next/server";

import {
  consumeRateLimit,
  rateLimitKey,
} from "@/features/customer-session/rate-limit";
import {
  NO_STORE,
  clearCustomerSessionCookie,
  jsonError,
  readCustomerSessionCookie,
  rejectCrossOrigin,
} from "@/features/customer-session/http";
import {
  findActiveCustomerSession,
  revokeCustomerSession,
} from "@/features/customer-session/session";

/**
 * Revoke the customer session and clear the cookie. Idempotent: logging out
 * without a valid session still succeeds and still clears the cookie.
 */

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  const limit = await consumeRateLimit({
    bucket: rateLimitKey(request, "customer-session:logout"),
    limit: 30,
    windowSeconds: 60,
  });
  if (!limit.allowed) {
    return jsonError(429, "Too many attempts. Please try again in a minute.");
  }

  const active = await findActiveCustomerSession(readCustomerSessionCookie(request));
  if (active) await revokeCustomerSession(active.session.id);

  const response = NextResponse.json({ ok: true }, { headers: NO_STORE });
  clearCustomerSessionCookie(response);
  return response;
}
