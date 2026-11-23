import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { getServerEnv } from "@/lib/env";

import { CUSTOMER_SESSION_COOKIE, CUSTOMER_SESSION_TTL_SECONDS } from "./config";
import { isSameOriginRequest } from "./origin";

export const NO_STORE = { "cache-control": "no-store" } as const;

export function jsonError(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

export function rejectCrossOrigin(request: NextRequest): NextResponse | null {
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(getServerEnv().BETTER_AUTH_URL).origin;
  } catch {
    // Configuration failures must never turn a write endpoint open.
    return jsonError(503, "Session service is not configured.");
  }

  const allowed = isSameOriginRequest({
    origin: request.headers.get("origin"),
    secFetchSite: request.headers.get("sec-fetch-site"),
    expectedOrigin,
  });

  return allowed ? null : jsonError(403, "This request did not come from the app.");
}

export function setCustomerSessionCookie(response: NextResponse, value: string): void {
  response.cookies.set(CUSTOMER_SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: CUSTOMER_SESSION_TTL_SECONDS,
  });
}

export function clearCustomerSessionCookie(response: NextResponse): void {
  response.cookies.set(CUSTOMER_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export function readCustomerSessionCookie(request: NextRequest): string | null {
  return request.cookies.get(CUSTOMER_SESSION_COOKIE)?.value ?? null;
}
