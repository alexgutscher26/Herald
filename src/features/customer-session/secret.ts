import "server-only";

import { createHmac } from "node:crypto";

import { getServerEnv } from "@/lib/env";

/**
 * Customer-session signing key.
 *
 * Derived from `BETTER_AUTH_SECRET` with a fixed context so a customer cookie
 * and a Better Auth session can never be confused for one another. Deriving
 * avoids adding a second required secret to every existing deployment.
 */
let cached: string | null = null;

export function getCustomerSessionSecret(): string {
  if (cached) return cached;

  cached = createHmac("sha256", getServerEnv().BETTER_AUTH_SECRET)
    .update("herald.customer-session.signing-key.v1")
    .digest("hex");
  return cached;
}
