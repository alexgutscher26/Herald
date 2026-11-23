import { NextResponse, type NextRequest } from "next/server";

import { isPublicLocaleCode } from "@/features/branding/schema";
import {
  customDomainPath,
  requestHost,
  resolveCustomDomain,
} from "@/features/public/custom-domain";
import {
  PUBLIC_LOCALE_COOKIE,
  PUBLIC_LOCALE_COOKIE_MAX_AGE,
} from "@/features/public/locale-cookie";
import {
  contentSecurityPolicy,
  contentSecurityPolicyReportOnly,
  isWidgetEmbedPath,
  NOT_FRAMEABLE,
  permissionsPolicy,
} from "@/features/security/policy";
import { embedFrameAncestors } from "@/features/widget/frame-ancestors";
import {
  REQUEST_ID_HEADER,
  newRequestId,
  sanitizeRequestId,
} from "@/lib/request-context";

/**
 * Correlation and response hardening.
 *
 * The proxy does not authenticate or authorize anything — those decisions stay
 * in layouts, pages, route handlers and server actions, where they can read the
 * database. Its jobs are to guarantee that every request and response carries a
 * sane `x-request-id` so logs can be joined to a browser session, and to attach
 * the security headers, including the per-route `frame-ancestors` decision that
 * only the widget embed may relax.
 */

/** HSTS only means something on a TLS connection; behind a proxy, trust its proto. */
function isHttps(request: NextRequest): boolean {
  const forwarded = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  if (forwarded === "https") return true;
  return request.nextUrl.protocol === "https:";
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const id = sanitizeRequestId(request.headers.get(REQUEST_ID_HEADER)) ?? newRequestId();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_ID_HEADER, id);

  const pathname = request.nextUrl.pathname;
  const host = requestHost(request.headers);
  const customRoute = host ? await resolveCustomDomain(host) : null;
  const rewrittenPath = customRoute
    ? customDomainPath(customRoute, pathname)
    : null;
  const servingPath = rewrittenPath ?? pathname;
  requestHeaders.set("x-herald-path", servingPath);

  // `?lang=` makes each language a distinct, crawler-addressable URL for
  // hreflang alternates. The cookie remains what a visitor's switch writes, so
  // a later bare visit keeps their choice.
  const explicitLocale = request.nextUrl.searchParams.get("lang");
  if (servingPath.startsWith("/p/") && isPublicLocaleCode(explicitLocale)) {
    requestHeaders.set("x-herald-locale", explicitLocale);
  }

  const embed = isWidgetEmbedPath(pathname);
  const frameAncestors = embed
    ? await embedFrameAncestors(pathname)
    : NOT_FRAMEABLE;

  const response = rewrittenPath
    ? NextResponse.rewrite(
        (() => {
          const url = request.nextUrl.clone();
          url.pathname = rewrittenPath;
          return url;
        })(),
        { request: { headers: requestHeaders } },
      )
    : NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(REQUEST_ID_HEADER, id);

  if (servingPath.startsWith("/p/") && isPublicLocaleCode(explicitLocale)) {
    response.cookies.set(PUBLIC_LOCALE_COOKIE, explicitLocale, {
      path: "/",
      maxAge: PUBLIC_LOCALE_COOKIE_MAX_AGE,
      sameSite: "lax",
      httpOnly: false,
      secure: isHttps(request),
    });
  }

  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", permissionsPolicy(pathname));
  if (isHttps(request)) {
    // No `preload`: that is an irreversible operator decision, not a default.
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains",
    );
  }

  response.headers.set(
    "Content-Security-Policy",
    contentSecurityPolicy(frameAncestors),
  );
  response.headers.set(
    "Content-Security-Policy-Report-Only",
    contentSecurityPolicyReportOnly(frameAncestors, {
      allowEval: process.env.NODE_ENV !== "production",
    }),
  );

  // The embed's allowlist cannot be expressed in `X-Frame-Options`, so it is
  // omitted there and `frame-ancestors` is the only framing control.
  if (!embed) {
    response.headers.set("X-Frame-Options", "SAMEORIGIN");
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
