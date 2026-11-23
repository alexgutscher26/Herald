import "server-only";

import { headers } from "next/headers";

import { isSameOriginRequest } from "@/features/customer-session/origin";

/**
 * Explicit same-origin guard for server actions.
 *
 * Next.js validates Server Action origins at the framework boundary, but that
 * protection is implicit and easy to lose when a function is called directly
 * from a route handler or a test. Action authorization helpers call this before
 * resolving a workspace so every action that goes through them has an explicit
 * check. Actions that do not use the helpers must call it themselves.
 *
 * `headers()` throws outside a request scope (a direct unit/integration call).
 * That is not a browser request, so there is no Origin to check; the action's
 * normal session authorization still applies.
 */
export async function assertSameOriginAction(): Promise<void> {
  let requestHeaders: Headers;
  try {
    requestHeaders = await headers();
  } catch {
    return;
  }

  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  if (!host) {
    throw new Error("This action must be called from the Herald app.");
  }

  const forwardedProto = requestHeaders.get("x-forwarded-proto");
  const protocol = forwardedProto === "http" || forwardedProto === "https"
    ? forwardedProto
    : "https";
  const configuredOrigin = process.env.BETTER_AUTH_URL?.trim().replace(/\/$/, "");
  const expectedOrigin = configuredOrigin || `${protocol}://${host}`;

  const allowed = isSameOriginRequest({
    origin: requestHeaders.get("origin"),
    secFetchSite: requestHeaders.get("sec-fetch-site"),
    expectedOrigin,
  });
  if (!allowed) {
    throw new Error("This action must be called from the Herald app.");
  }
}
