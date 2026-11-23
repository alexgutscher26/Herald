import { afterEach, describe, expect, test } from "bun:test";

import {
  cachedPublicPayload,
  clearPublicPayloadCache,
  invalidateAllPublicHelpArticles,
  invalidateAllPublicReleases,
  publicPayloadCacheSize,
  publicPayloadKeys,
  publicPayloadTtlMs,
} from "@/features/public/payload-cache";

afterEach(() => clearPublicPayloadCache());

describe("public payload cache", () => {
  test("serves a value inside the TTL and reloads after it", async () => {
    let loads = 0;
    const load = async () => {
      loads += 1;
      return { value: loads };
    };

    expect(await cachedPublicPayload("k", load, { ttlMs: 60_000, now: 1_000 })).toEqual({
      value: 1,
    });
    expect(await cachedPublicPayload("k", load, { ttlMs: 60_000, now: 2_000 })).toEqual({
      value: 1,
    });
    expect(await cachedPublicPayload("k", load, { ttlMs: 60_000, now: 61_000 })).toEqual({
      value: 2,
    });
    expect(loads).toBe(2);
  });

  test("deduplicates concurrent loads of one key", async () => {
    let loads = 0;
    const load = async () => {
      loads += 1;
      return "value";
    };

    const [first, second] = await Promise.all([
      cachedPublicPayload("same", load, { ttlMs: 60_000 }),
      cachedPublicPayload("same", load, { ttlMs: 60_000 }),
    ]);
    expect(first).toBe("value");
    expect(second).toBe("value");
    expect(loads).toBe(1);
  });

  test("never caches a failed load", async () => {
    let loads = 0;
    const failing = async () => {
      loads += 1;
      throw new Error("boom");
    };

    await expect(cachedPublicPayload("bad", failing, { ttlMs: 60_000 })).rejects.toThrow(
      "boom",
    );
    expect(publicPayloadCacheSize()).toBe(0);
    await expect(cachedPublicPayload("bad", failing, { ttlMs: 60_000 })).rejects.toThrow(
      "boom",
    );
    expect(loads).toBe(2);
  });

  test("a zero TTL bypasses the cache entirely", async () => {
    let loads = 0;
    const load = async () => ++loads;
    await cachedPublicPayload("off", load, { ttlMs: 0 });
    await cachedPublicPayload("off", load, { ttlMs: 0 });
    expect(loads).toBe(2);
    expect(publicPayloadCacheSize()).toBe(0);
  });

  test("invalidation is prefix-scoped and never touches other payloads", async () => {
    await cachedPublicPayload(publicPayloadKeys.releaseEntry("p1", "one"), async () => 1);
    await cachedPublicPayload(publicPayloadKeys.releaseEntry("p2", "one"), async () => 2);
    await cachedPublicPayload(
      publicPayloadKeys.helpArticleEntry("p1", "guides", "start"),
      async () => 3,
    );

    invalidateAllPublicReleases();
    expect(publicPayloadCacheSize()).toBe(1);

    invalidateAllPublicHelpArticles();
    expect(publicPayloadCacheSize()).toBe(0);
  });

  test("the TTL honours the environment and is clamped", () => {
    expect(publicPayloadTtlMs({})).toBe(60_000);
    expect(publicPayloadTtlMs({ PUBLIC_PAYLOAD_TTL_SECONDS: "5" })).toBe(5_000);
    expect(publicPayloadTtlMs({ PUBLIC_PAYLOAD_TTL_SECONDS: "0" })).toBe(0);
    expect(publicPayloadTtlMs({ PUBLIC_PAYLOAD_TTL_SECONDS: "999999" })).toBe(
      3_600_000,
    );
    expect(publicPayloadTtlMs({ PUBLIC_PAYLOAD_TTL_SECONDS: "nope" })).toBe(60_000);
  });
});
