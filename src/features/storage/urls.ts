import "server-only";

import { isSafeStorageKey } from "./limits";
import { getStorageSigningSecret } from "./signing";
import { buildSignedStoragePath, signStorageKey } from "./signed";

export const DEFAULT_STORAGE_URL_TTL_SECONDS = 10 * 60;

export function createSignedStorageUrl(
  key: string,
  ttlSeconds = DEFAULT_STORAGE_URL_TTL_SECONDS,
): string {
  if (!isSafeStorageKey(key)) throw new Error("Invalid storage key.");

  const boundedTtl = Math.min(Math.max(Math.trunc(ttlSeconds), 60), 24 * 60 * 60);
  const expiresAt = Date.now() + boundedTtl * 1000;
  const signature = signStorageKey({
    key,
    expiresAt,
    secret: getStorageSigningSecret(),
  });

  return buildSignedStoragePath({ key, expiresAt, signature });
}
