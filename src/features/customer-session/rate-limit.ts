import "server-only";

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";

import { db } from "@/db";
import { rateLimitCounters } from "@/db/schema";

/**
 * Fixed-window rate limiting backed by Postgres.
 *
 * The counter is incremented atomically by `ON CONFLICT DO UPDATE`, so two
 * concurrent requests cannot both read the same count. Buckets are hashed
 * identifiers, never raw IP addresses.
 */
export async function consumeRateLimit(input: {
  bucket: string;
  limit: number;
  windowSeconds: number;
  now?: Date;
}): Promise<{ allowed: boolean; count: number }> {
  const now = input.now ?? new Date();
  const windowMs = input.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);

  const rows = await db
    .insert(rateLimitCounters)
    .values({ bucket: input.bucket, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimitCounters.bucket, rateLimitCounters.windowStart],
      set: { count: sql`${rateLimitCounters.count} + 1` },
    })
    .returning({ count: rateLimitCounters.count });

  const count = rows[0]?.count ?? input.limit + 1;
  return { allowed: count <= input.limit, count };
}

/**
 * Stable, hashed client key. Prefers the proxy-provided address and falls back
 * to a shared bucket so a missing header cannot bypass the limit.
 */
export function rateLimitKey(request: Request, scope: string): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address =
    forwarded ||
    request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown";

  const digest = createHash("sha256").update(address.slice(0, 64)).digest("hex");
  return `${scope}:${digest}`;
}
