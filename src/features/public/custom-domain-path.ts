import { publicProductPath } from "./paths";

export type CustomDomainRoute = { workspaceSlug: string; productSlug: string };

/** Normalize a public hostname from `Host` or `x-forwarded-host`. */
export function normalizeDomainHost(value: string): string | null {
  const host = value.trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  if (!host || host === "localhost" || host.length > 253) return null;
  if (!host.includes(".")) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
  if (host.startsWith("[") || host.includes("/") || host.includes("@")) return null;
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(
    host,
  )
    ? host
    : null;
}

export function requestHost(headers: Headers): string | null {
  const forwarded = headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  const host = forwarded || headers.get("host")?.trim().toLowerCase() || "";
  return normalizeDomainHost(host);
}

/**
 * Paths owned by the application rather than the product surface. On a custom
 * domain `/` is the product, so its `/help`, `/updates` and board paths map
 * under `/p/{workspace}/{product}` while these stay at the root.
 */
const RESERVED_PREFIXES = [
  "/_next",
  "/api",
  "/p/",
  "/app",
  "/widget",
  "/sign-in",
  "/sign-up",
  "/auth",
  "/legal",
  "/status",
  "/robots.txt",
  "/sitemap.xml",
  "/manifest.webmanifest",
  "/sw.js",
  "/offline",
  "/icon",
  "/apple-icon",
  "/favicon",
] as const;

export function customDomainPath(
  route: CustomDomainRoute,
  pathname: string,
): string | null {
  if (pathname.startsWith("/p/")) return null;
  if (RESERVED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix))) {
    return null;
  }

  const base = publicProductPath(route.workspaceSlug, route.productSlug);
  return pathname === "/" ? base : `${base}${pathname}`;
}
