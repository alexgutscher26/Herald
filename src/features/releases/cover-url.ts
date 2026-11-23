import "server-only";

import { createSignedStorageUrl } from "@/features/storage/urls";

/**
 * Resolve a stored cover key to a short-lived signed URL.
 *
 * Signing needs the storage secret, so this stays on the server. A key that no
 * longer signs (missing secret, invalid shape) resolves to null and the cover
 * surface falls back to its placeholder instead of failing the page.
 */
export function coverImageUrl(key: string): string | null {
  try {
    return createSignedStorageUrl(key);
  } catch {
    return null;
  }
}
