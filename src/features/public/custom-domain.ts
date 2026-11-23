import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { workspaceDomains } from "@/db/schema/domains";
import { products, workspaces } from "@/db/schema/workspaces";
import { hasFeature, toPlanId } from "@/features/entitlements/plans";

import type { CustomDomainRoute } from "./custom-domain-path";

export {
  customDomainPath,
  normalizeDomainHost,
  requestHost,
  type CustomDomainRoute,
} from "./custom-domain-path";

/**
 * Custom-domain routing.
 *
 * A hostname serves a product's public tree only after its TXT challenge was
 * verified and while the workspace's plan still includes custom domains. The
 * lookup is cached briefly because the proxy runs on every request; a removed
 * or downgraded domain stops serving within the cache window.
 */

const CACHE_TTL_MS = 60_000;
const MISS_TTL_MS = 10_000;

type DomainRoute = CustomDomainRoute;
type CacheEntry = { route: DomainRoute | null; expiresAt: number };

const cache = new Map<string, CacheEntry>();

export async function resolveCustomDomain(
  host: string,
  now = Date.now(),
): Promise<DomainRoute | null> {
  const cached = cache.get(host);
  if (cached && cached.expiresAt > now) return cached.route;

  let route: DomainRoute | null = null;
  try {
    const rows = await db
      .select({
        workspaceSlug: workspaces.slug,
        productSlug: products.slug,
        plan: workspaces.plan,
      })
      .from(workspaceDomains)
      .innerJoin(workspaces, eq(workspaceDomains.workspaceId, workspaces.id))
      .innerJoin(products, eq(workspaceDomains.productId, products.id))
      .where(
        and(
          eq(workspaceDomains.domain, host),
          eq(workspaceDomains.status, "verified"),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (row && hasFeature(toPlanId(row.plan), "customDomains")) {
      route = { workspaceSlug: row.workspaceSlug, productSlug: row.productSlug };
    }
  } catch (error) {
    // A database outage must not make the canonical app unreachable. The
    // canonical host keeps serving; the custom host falls through to 404s.
    console.error("[custom-domain] lookup failed:", error instanceof Error ? error.message : error);
  }

  cache.set(host, {
    route,
    expiresAt: now + (route ? CACHE_TTL_MS : MISS_TTL_MS),
  });
  return route;
}

/** Test seam: the cache is process-wide and must not leak between tests. */
export function clearCustomDomainCache(): void {
  cache.clear();
}
