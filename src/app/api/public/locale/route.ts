import { NextResponse, type NextRequest } from "next/server";

import {
  PUBLIC_LOCALE_COOKIE,
  PUBLIC_LOCALE_COOKIE_MAX_AGE,
  isLocaleCode,
  safePublicNext,
} from "@/features/public/i18n";

/**
 * Remember a visitor's language choice, then send them back to the page they
 * came from. The destination is restricted to the public site, so this cannot
 * become an open redirect.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const locale = request.nextUrl.searchParams.get("locale");
  const next = safePublicNext(request.nextUrl.searchParams.get("next"));
  const destination = new URL(next, request.nextUrl.origin);

  const response = NextResponse.redirect(destination, 307);

  if (isLocaleCode(locale)) {
    response.cookies.set({
      name: PUBLIC_LOCALE_COOKIE,
      value: locale,
      path: "/",
      maxAge: PUBLIC_LOCALE_COOKIE_MAX_AGE,
      sameSite: "lax",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
    });
  }

  response.headers.set("cache-control", "private, no-store");
  return response;
}
