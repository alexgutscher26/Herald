import { NextResponse, type NextRequest } from "next/server";

import { consumeMagicLink } from "@/features/customer-auth/magic-link";
import {
  readCustomerSessionCookie,
  setCustomerSessionCookie,
} from "@/features/customer-session/http";
import {
  consumeRateLimit,
  rateLimitKey,
} from "@/features/customer-session/rate-limit";
import { findActiveCustomerSession } from "@/features/customer-session/session";
import { escapeHtml } from "@/features/email/templates";
import { getServerEnv } from "@/lib/env";

/**
 * Consume a magic link and redirect into the public site.
 *
 * A link is clicked from an email client, so this endpoint cannot require a
 * same-origin `Origin` header. Single use, a fifteen-minute expiry and a
 * rate limit are the protection. Errors render a small HTML page with a link
 * back to the app; they never echo the token.
 */

export const dynamic = "force-dynamic";

function page(status: number, heading: string, detail: string): NextResponse {
  let origin = "/";
  try {
    origin = new URL(getServerEnv().BETTER_AUTH_URL).origin;
  } catch {
    // Keep the relative fallback rather than failing the page.
  }

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>${escapeHtml(heading)} — Herald</title>
  </head>
  <body style="margin:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a">
    <main style="max-width:520px;margin:12vh auto;padding:32px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px">
      <p style="margin:0 0 16px;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#64748b">Herald</p>
      <h1 style="margin:0 0 12px;font-size:22px">${escapeHtml(heading)}</h1>
      <p style="margin:0 0 20px;color:#475569;line-height:1.6">${escapeHtml(detail)}</p>
      <a href="${escapeHtml(origin)}" style="color:#0f172a;font-weight:600">Return to Herald</a>
    </main>
  </body>
</html>`;

  return new NextResponse(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const limit = await consumeRateLimit({
    bucket: rateLimitKey(request, "magic-link:verify"),
    limit: 30,
    windowSeconds: 60,
  });
  if (!limit.allowed) {
    return page(429, "Too many attempts", "Wait a minute, then open the link again.");
  }

  const token = request.nextUrl.searchParams.get("token") ?? "";
  if (token.length === 0) {
    return page(400, "This link is incomplete", "Open the link from your sign-in email again.");
  }

  const active = await findActiveCustomerSession(readCustomerSessionCookie(request));
  const result = await consumeMagicLink({ token, activeSession: active });

  if (!result.ok) {
    if (result.reason === "banned") {
      return page(403, "This account cannot sign in", "Contact the team if you think this is a mistake.");
    }
    if (result.reason === "closed") {
      return page(400, "This link is no longer available", "This workspace's public site is not open.");
    }
    return page(
      400,
      "This link has expired",
      "Sign-in links work once for fifteen minutes. Request a new one from the sign-in page.",
    );
  }

  const origin = new URL(getServerEnv().BETTER_AUTH_URL).origin;
  const response = NextResponse.redirect(
    new URL(result.nextPath ?? "/", origin),
    303,
  );
  setCustomerSessionCookie(response, result.cookieValue);
  return response;
}

