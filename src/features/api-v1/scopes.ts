import type { ApiScope } from "@/db/schema";

/**
 * Pure scope decisions shared by the REST router, MCP and the unit suite.
 *
 * `read` and `write` retain their original workspace-wide meaning. The
 * resource-specific scopes narrow reads only; writes still require `write`
 * (or `admin`). `admin` is a superset, including scopes added in a later
 * release, so callers must treat it as an override rather than a literal list.
 */

export type ApiReadResource = "feedback" | "support";

export function hasAnyReadScope(scopes: readonly ApiScope[]): boolean {
  return (
    scopes.includes("read") ||
    scopes.includes("feedback:read") ||
    scopes.includes("support:read") ||
    scopes.includes("admin")
  );
}

export function scopeAllowsRead(
  scopes: readonly ApiScope[],
  resource: ApiReadResource | null,
): boolean {
  if (scopes.includes("admin") || scopes.includes("read")) return true;
  if (resource === null) return hasAnyReadScope(scopes);
  return scopes.includes(`${resource}:read` as ApiScope);
}

export function scopeAllows(scopes: readonly ApiScope[], scope: ApiScope): boolean {
  if (scopes.includes("admin")) return true;
  if (scope === "read") return hasAnyReadScope(scopes);
  return scopes.includes(scope);
}
