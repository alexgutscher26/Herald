import { describe, expect, test } from "bun:test";

import {
  firstRoadmapIssue,
  resolveRoadmapSlug,
  roadmapFormSchema,
} from "@/features/roadmap/schema";

describe("public roadmap views", () => {
  test("derives a URL slug from the name when none is supplied", () => {
    expect(resolveRoadmapSlug({ name: "Enterprise roadmap", slug: "" })).toEqual({
      ok: true,
      slug: "enterprise-roadmap",
    });
  });

  test("keeps a valid explicit slug and rejects an unsafe one", () => {
    expect(resolveRoadmapSlug({ name: "Enterprise", slug: "enterprise" })).toEqual({
      ok: true,
      slug: "enterprise",
    });
    expect(resolveRoadmapSlug({ name: "Enterprise", slug: "Enterprise Roadmap" }).ok).toBe(
      false,
    );
  });

  test("defaults to a listed, unpublished view with no boards", () => {
    const parsed = roadmapFormSchema.parse({ name: "Enterprise roadmap" });
    expect(parsed.visibility).toBe("public");
    expect(parsed.published).toBe(false);
    expect(parsed.boardIds).toEqual([]);
  });

  test("accepts unlisted views and reports the first field issue", () => {
    const parsed = roadmapFormSchema.parse({
      name: "Partner roadmap",
      visibility: "unlisted",
    });
    expect(parsed.visibility).toBe("unlisted");

    const invalid = roadmapFormSchema.safeParse({ name: "" });
    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      expect(firstRoadmapIssue(invalid.error).message).toContain("name");
    }
  });
});
