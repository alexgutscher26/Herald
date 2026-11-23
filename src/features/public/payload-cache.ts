/**
 * Small TTL cache for immutable public payloads.
 *
 * Cache-key review (what is deliberately inside and outside the key):
 *
 *  - IN: product id, the public slug(s), and the collection slug for a help
 *    article. Nothing else identifies the stored row.
 *  - OUT: the viewer. Only the row, its tags and its authors are cached; linked
 *    requests, moderation state, bans, merges and visibility switches are read
 *    live on every request, so moderation stays immediate.
 *  - OUT: locale. The raw row carries every translation and is translated after
 *    the cache read, so one entry serves every locale.
 *  - OUT: signed storage URLs. The raw cover key is cached and signed per
 *    request, so an expiring URL can never be served from cache.
 *
 * The store is per process and bounded. A mutation invalidates the matching
 * prefix in the process that handled it; other instances converge at the TTL
 * (default 60 s). A release body or help article is immutable between edits, so
 * that window only affects the editor who just saved, not visitors.
 */
import { logEvent } from "@/lib/logger";

type Entry = { value: Promise<unknown>; expiresAt: number };

const entries = new Map<string, Entry>();
const MAX_ENTRIES = 500;
const DEFAULT_TTL_SECONDS = 60;

export function publicPayloadTtlMs(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = Number(env.PUBLIC_PAYLOAD_TTL_SECONDS ?? DEFAULT_TTL_SECONDS);
  if (!Number.isFinite(raw)) return DEFAULT_TTL_SECONDS * 1000;
  // 0 disables the cache (useful in tests and for an instant rollout kill).
  return Math.min(Math.max(Math.trunc(raw), 0), 3_600) * 1000;
}

function evictIfNeeded(): void {
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next();
    if (oldest.done) return;
    entries.delete(oldest.value);
  }
}

/** Read through the cache, deduplicating concurrent loads of the same key. */
export function cachedPublicPayload<T>(
  key: string,
  load: () => Promise<T>,
  options: { ttlMs?: number; now?: number } = {},
): Promise<T> {
  const ttlMs = options.ttlMs ?? publicPayloadTtlMs();
  if (ttlMs <= 0) return load();

  const now = options.now ?? Date.now();
  const hit = entries.get(key);
  if (hit && hit.expiresAt > now) return hit.value as Promise<T>;

  const value = load();
  entries.set(key, { value, expiresAt: now + ttlMs });
  evictIfNeeded();
  // A failed load must never be cached: the next request retries.
  void value.catch(() => {
    if (entries.get(key)?.value === value) entries.delete(key);
  });
  return value;
}

/** Drop every entry whose key starts with `prefix`. Returns the count removed. */
export function invalidatePublicPayload(prefix: string): number {
  let removed = 0;
  for (const key of entries.keys()) {
    if (key.startsWith(prefix)) {
      entries.delete(key);
      removed += 1;
    }
  }
  if (removed > 0) {
    logEvent("info", "public_payload.invalidated", { prefix, removed });
  }
  return removed;
}

export function publicPayloadCacheSize(): number {
  return entries.size;
}

/** Test helper; also called by the integration harness between tests. */
export function clearPublicPayloadCache(): void {
  entries.clear();
}

export const publicPayloadKeys = {
  release: (productId: string) => `release:${productId}:`,
  releaseEntry: (productId: string, slug: string) => `release:${productId}:${slug}`,
  helpArticle: (productId: string) => `help:${productId}:`,
  helpArticleEntry: (productId: string, collectionSlug: string, articleSlug: string) =>
    `help:${productId}:${collectionSlug}:${articleSlug}`,
};

export function invalidatePublicRelease(productId: string): void {
  invalidatePublicPayload(publicPayloadKeys.release(productId));
}

export function invalidatePublicHelpArticle(productId: string): void {
  invalidatePublicPayload(publicPayloadKeys.helpArticle(productId));
}

/**
 * Flush every cached release on a write.
 *
 * Writes are rare and the cache is bounded at 500 entries, so a coarse flush is
 * cheaper to reason about than threading a product id through every editor and
 * publisher path. Read paths simply repopulate on the next request.
 */
export function invalidateAllPublicReleases(): void {
  invalidatePublicPayload("release:");
}

export function invalidateAllPublicHelpArticles(): void {
  invalidatePublicPayload("help:");
}
