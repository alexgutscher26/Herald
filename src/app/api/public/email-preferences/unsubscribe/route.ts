import { NextResponse, type NextRequest } from "next/server";

import {
  NO_STORE,
  jsonError,
} from "@/features/customer-session/http";
import {
  consumeRateLimit,
  rateLimitKey,
} from "@/features/customer-session/rate-limit";
import {
  isPreferenceToken,
  unsubscribeFromMarketing,
} from "@/features/subscribers/preferences";

/**
 * RFC 8058 one-click unsubscribe.
 *
 * Mailbox providers POST to the URL in List-Unsubscribe with an empty or
 * `List-Unsubscribe=One-Click` body and no browser Origin. The token in the
 * URL is the credential, so this route does not require a session or a
 * same-origin header; it is rate-limited and only turns off marketing lists.
 */

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const limit = await consumeRateLimit({
    bucket: rateLimitKey(request, "one-click-unsubscribe"),
    limit: 20,
    windowSeconds: 60,
  });
  if (!limit.allowed) {
    return jsonError(429, "Too many requests. Try again in a minute.");
  }

  const token = request.nextUrl.searchParams.get("token")?.trim() ?? "";
  if (!isPreferenceToken(token)) {
    return jsonError(404, "That unsubscribe link is not valid.");
  }

  const unsubscribed = await unsubscribeFromMarketing(token);
  if (!unsubscribed) {
    return jsonError(404, "That unsubscribe link is not valid.");
  }

  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}

export function GET(): NextResponse {
  return NextResponse.json(
    { error: "Use the unsubscribe button in the email." },
    { status: 405, headers: { ...NO_STORE, allow: "POST" } },
  );
}
