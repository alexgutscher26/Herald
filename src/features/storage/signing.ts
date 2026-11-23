import "server-only";

import { createHmac } from "node:crypto";

import { getServerEnv } from "@/lib/env";

/** Domain-separated key so storage URLs cannot be confused with sessions. */
let cached: string | null = null;

export function getStorageSigningSecret(): string {
  if (cached) return cached;

  cached = createHmac("sha256", getServerEnv().BETTER_AUTH_SECRET)
    .update("herald.storage.signing-key.v1")
    .digest("hex");
  return cached;
}
