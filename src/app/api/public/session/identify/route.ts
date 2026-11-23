import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

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
  findActiveCustomerSession,
  identifyCustomer,
  toCustomerSessionView,
} from "@/features/customer-session/session";
import { isValidEmail } from "@/lib/email";

/**
 * Attach an email (and optional name) to the current guest session.
 *
 * No email is verified yet — `verified` stays false until the magic-link flow
 * lands. The session token is rotated, so the guest token is no longer valid.
 */

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  email: z.string().trim().min(3).max(254),
  name: z.string().trim().max(120).optional(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  const limit = await consumeRateLimit({
    bucket: rateLimitKey(request, "customer-session:identify"),
    limit: 10,
    windowSeconds: 60,
  });
  if (!limit.allowed) {
    return jsonError(429, "Too many attempts. Please try again in a minute.");
  }

  const active = await findActiveCustomerSession(readCustomerSessionCookie(request));
  if (!active) return jsonError(401, "Start a session before identifying.");

  const body: unknown = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "Enter a valid email address.");

  if (!isValidEmail(parsed.data.email)) {
    return jsonError(400, "Enter a valid email address.");
  }

  const result = await identifyCustomer(active, {
    email: parsed.data.email,
    name: parsed.data.name?.trim() || undefined,
  });

  if (!result.ok && result.reason === "banned") {
    return jsonError(403, "This account cannot submit requests.");
  }
  if (!result.ok && result.reason === "conflict") {
    return jsonError(409, "That email is already in use.");
  }
  if (!result.ok) return jsonError(400, "Could not identify this session.");

  const response = NextResponse.json(
    { session: toCustomerSessionView(result.active) },
    { headers: NO_STORE },
  );
  setCustomerSessionCookie(response, result.cookieValue);
  return response;
}
