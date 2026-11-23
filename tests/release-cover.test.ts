import { describe, expect, test } from "bun:test";

import { coverInputSchema, isCustomCoverKey } from "@/features/releases/cover";
import { customCoverFingerprint, toRevisionCover } from "@/features/releases/revision-types";

const KEY =
  "workspaces/11111111-1111-4111-8111-111111111111/products/22222222-2222-4222-8222-222222222222/cover/33333333-3333-4333-8333-333333333333.png";

describe("release cover input", () => {
  test("accepts a stored cover key", () => {
    expect(coverInputSchema.parse({ kind: "custom", key: KEY })).toEqual({
      kind: "custom",
      key: KEY,
    });
  });

  test("rejects an inline data: URL", () => {
    const parsed = coverInputSchema.safeParse({
      kind: "custom",
      dataUrl: "data:image/png;base64,AAAA",
    });
    expect(parsed.success).toBe(false);
  });

  test("rejects a key outside the cover scope", () => {
    expect(isCustomCoverKey(KEY.replace("/cover/", "/attachment/"))).toBe(false);
    expect(isCustomCoverKey("workspaces/other/products/x/cover/y.png")).toBe(false);
    expect(isCustomCoverKey("../cover.png")).toBe(false);
    expect(isCustomCoverKey("data:image/png;base64,AAAA")).toBe(false);
  });

  test("drops the read-time preview url before a cover is persisted", () => {
    expect(
      coverInputSchema.parse({ kind: "custom", key: KEY, url: "/api/storage/example" }),
    ).toEqual({ kind: "custom", key: KEY });
  });

  test("fingerprints a replaced image differently", () => {
    expect(toRevisionCover({ kind: "custom", key: KEY })).toEqual({
      kind: "custom",
      fingerprint: customCoverFingerprint(KEY),
    });
    expect(customCoverFingerprint(KEY)).not.toBe(
      customCoverFingerprint(KEY.replace(".png", ".webp")),
    );
  });
});
