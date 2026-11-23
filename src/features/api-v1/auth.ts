import "server-only";

import { and, eq, gt, isNull, or } from "drizzle-orm";

import { db } from "@/db";
import { apiTokens, workspaces, type ApiScope } from "@/db/schema";
import { consumeRateLimit } from "@/features/customer-session/rate-limit";
import { getWorkspacePlan } from "@/features/entitlements/entitlements";
import { apiRequestsPerMinute, hasFeature } from "@/features/entitlements/plans";
import { isFeatureEnabled } from "@/features/entitlements/flags";
import { logEvent, serializeError } from "@/lib/logger";

import { clientMetadataFromHeaders } from "./client-metadata";
import { ApiFailure } from "./http";
import { scopeAllows, scopeAllowsRead } from "./scopes";
import { hashApiToken, isApiTokenShaped, readBearerToken } from "./token";

/**
 * Bearer-token authentication for `/api/v1`.
 *
 * The workspace comes from the token row, never from a header or path. A
 * revoked token, a token from another deployment, or a malformed header all
 * produce the same 401 body so a probe learns nothing about which failed.
 *
 * Rate limits are per token and durable (Postgres), so scaling out does not
 * multiply the allowance. They are checked after the token resolves because
 * the bucket key is the token id; junk headers never reach the database.
 */

/** Window over which a plan's per-token request allowance is counted. */
export const API_RATE_WINDOW_SECONDS = 60;

export type ApiAuth = {
  tokenId: string;
  tokenName: string;
  scopes: ApiScope[];
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  userId: string | null;
  requestId: string;
  rateLimit: { limit: number; remaining: number };
};

export async function authenticateApiRequest(request: Request): Promise<ApiAuth> {
  if (!isFeatureEnabled("api")) {
    throw new ApiFailure(
      503,
      "api_disabled",
      "The REST API is not enabled on this deployment.",
    );
  }

  const raw = readBearerToken(request.headers.get("authorization"));
  if (!raw || !isApiTokenShaped(raw)) {
    throw new ApiFailure(401, "unauthorized", "A valid bearer token is required.", {
      headers: { "www-authenticate": 'Bearer realm="api"' },
    });
  }

  const now = new Date();
  const rows = await db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      scopes: apiTokens.scopes,
      userId: apiTokens.createdBy,
      workspaceId: workspaces.id,
      workspaceName: workspaces.name,
      workspaceSlug: workspaces.slug,
      workspacePlan: workspaces.plan,
    })
    .from(apiTokens)
    .innerJoin(workspaces, eq(apiTokens.workspaceId, workspaces.id))
    .where(
      and(
        eq(apiTokens.tokenHash, hashApiToken(raw)),
        // `revoked_at` in the future is a rotation grace period: the new token
        // is already in use while the old one gets time to be redeployed.
        or(isNull(apiTokens.revokedAt), gt(apiTokens.revokedAt, now)),
        // OAuth-issued tokens carry a hard expiry independent of revocation.
        or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, now)),
      ),
    )
    .limit(1);

  const token = rows[0];
  if (!token) {
    throw new ApiFailure(401, "unauthorized", "A valid bearer token is required.", {
      headers: { "www-authenticate": 'Bearer realm="api"' },
    });
  }

  const plan = await getWorkspacePlan(token.workspaceId);
  if (!hasFeature(plan, "api")) {
    throw new ApiFailure(
      403,
      "plan_required",
      "The REST API is available on the Professional plan.",
    );
  }

  const rateLimit = apiRequestsPerMinute(plan);
  const limit = await consumeRateLimit({
    bucket: `api:v1:${token.id}`,
    limit: rateLimit,
    windowSeconds: API_RATE_WINDOW_SECONDS,
  });

  if (!limit.allowed) {
    throw new ApiFailure(429, "rate_limited", "Too many requests; retry later.", {
      headers: {
        "retry-after": String(API_RATE_WINDOW_SECONDS),
        "x-ratelimit-limit": String(rateLimit),
        "x-ratelimit-remaining": "0",
      },
    });
  }

  const remaining = Math.max(0, rateLimit - limit.count);

  // Best-effort usage audit: a failure here must not fail the request. Only a
  // network prefix and a short user-agent label are kept, never a full IP.
  const seen = clientMetadataFromHeaders(request.headers);
  try {
    await db
      .update(apiTokens)
      .set({
        lastUsedAt: new Date(),
        lastUsedIpPrefix: seen.ipPrefix,
        lastUsedUserAgent: seen.userAgent,
        updatedAt: new Date(),
      })
      .where(eq(apiTokens.id, token.id));
  } catch (error) {
    logEvent("warn", "api.token_touch_failed", {
      tokenId: token.id,
      error: serializeError(error),
    });
  }

  logEvent("info", "api.request", {
    tokenId: token.id,
    workspaceId: token.workspaceId,
    method: request.method,
    path: new URL(request.url).pathname,
  });

  return {
    tokenId: token.id,
    tokenName: token.name,
    scopes: token.scopes,
    workspaceId: token.workspaceId,
    workspaceName: token.workspaceName,
    workspaceSlug: token.workspaceSlug,
    userId: token.userId,
    requestId: "",
    rateLimit: { limit: rateLimit, remaining },
  };
}

/**
 * Throw a 403 unless the token grants reads for this resource.
 *
 * `read` remains workspace-wide for existing integrations. New tokens can be
 * narrowed to `feedback:read` or `support:read`; `admin` implies every scope.
 * A `null` resource is the root endpoint and accepts any read scope.
 */
export function requireReadScope(
  auth: ApiAuth,
  resource: "feedback" | "support" | null,
): void {
  if (scopeAllowsRead(auth.scopes, resource)) return;

  throw new ApiFailure(
    403,
    "forbidden",
    resource === null
      ? "This token does not have a read scope."
      : `This token does not have the "${resource}:read" scope.`,
  );
}

/** Throw a 403 unless the token carries the scope the operation needs. */
export function requireScope(auth: ApiAuth, scope: ApiScope): void {
  // Resource routes are narrowed by `requireReadScope` in the router before
  // the handler runs; this check only answers "can it read at all?".
  if (scopeAllows(auth.scopes, scope)) return;

  throw new ApiFailure(
    403,
    "forbidden",
    `This token does not have the "${scope}" scope.`,
  );
}

/** The acting team user for writes that record attribution. */
export function actingUserId(auth: ApiAuth): string {
  if (!auth.userId) {
    throw new ApiFailure(
      409,
      "conflict",
      "This token's creator no longer exists, so it cannot author content. Create a new token.",
    );
  }
  return auth.userId;
}
