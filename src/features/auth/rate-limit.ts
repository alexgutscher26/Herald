import "server-only";

import { createHash } from "node:crypto";

import { consumeRateLimit } from "@/features/customer-session/rate-limit";
import { logEvent, serializeError } from "@/lib/logger";

/**
 * Better Auth request throttling.
 *
 * Better Auth calls `consume` before handling a request and answers 429 with an
 * `X-Retry-After` header when the allowance is spent. Counters live in the same
 * Postgres table as the public-endpoint limiter (`rate_limit_counters`), so a
 * limit holds across instances and deploys — an in-memory counter on a
 * serverless deployment is per-instance and resets constantly.
 *
 * Buckets are hashed, never a raw address: the key Better Auth passes in is
 * `<ip>|<path>`.
 *
 * Fails open. A rate-limit read failure must not take sign-in down; it is
 * logged instead, and session reads would fail anyway in a real database
 * outage.
 */

/** Rules that differ from the 60s / 100 baseline. */
export const AUTH_RATE_LIMIT_RULES = {
  // Password guessing: 10 attempts per address per five minutes.
  "/sign-in/email": { window: 300, max: 10 },
  // Account farming, and the same ceiling as a sign-in burst.
  "/sign-up/email": { window: 3600, max: 20 },
  // Reset and verification mail: enough for a typo or a lost email, not enough
  // to use the account as a mail relay.
  "/request-password-reset": { window: 3600, max: 5 },
  "/send-verification-email": { window: 3600, max: 5 },
  // Sensitive signed-in changes.
  "/change-password": { window: 300, max: 10 },
  "/change-email": { window: 300, max: 5 },
} as const;

export type AuthRateLimitRule = { window: number; max: number };

function bucketFor(key: string): string {
  return `auth:${createHash("sha256").update(key).digest("hex")}`;
}

export const authRateLimitStorage = {
  async consume(
    key: string,
    rule: AuthRateLimitRule,
  ): Promise<{ allowed: boolean; retryAfter: number | null }> {
    try {
      const outcome = await consumeRateLimit({
        bucket: bucketFor(key),
        limit: rule.max,
        windowSeconds: rule.window,
      });
      return {
        allowed: outcome.allowed,
        retryAfter: outcome.allowed ? null : rule.window,
      };
    } catch (error) {
      logEvent("error", "auth.rate_limit_unavailable", {
        error: serializeError(error),
      });
      return { allowed: true, retryAfter: null };
    }
  },
};
