import { describe, expect, test } from "bun:test";

import {
  escapeLikePattern,
  parsePublicBoardQuery,
  parsePublicRoadmapSort,
  publicBoardQueryString,
  PUBLIC_BOARD_PAGE_SIZE,
} from "@/features/public/query";
import { resolveBoardSlug } from "@/features/boards/schema";

describe("parsePublicBoardQuery", () => {
  test("defaults to newest, first page and the standard page size", () => {
    expect(parsePublicBoardQuery({})).toEqual({
      search: "",
      status: null,
      tag: null,
      sort: "newest",
      page: 1,
      pageSize: PUBLIC_BOARD_PAGE_SIZE,
    });
  });

  test("accepts valid filters and trims the search", () => {
    expect(
      parsePublicBoardQuery({
        q: "  dark mode  ",
        status: "planned",
        tag: "billing",
        sort: "top",
        page: "3",
        pageSize: "10",
      }),
    ).toEqual({
      search: "dark mode",
      status: "planned",
      tag: "billing",
      sort: "top",
      page: 3,
      pageSize: 10,
    });
  });

  test("uses the first value when Next.js supplies an array", () => {
    expect(
      parsePublicBoardQuery({ q: ["first", "second"], sort: ["trending", "top"] }),
    ).toMatchObject({ search: "first", sort: "trending" });
  });

  test("falls back on unknown status and sort instead of passing them through", () => {
    const query = parsePublicBoardQuery({
      status: "deleted",
      sort: "random",
      tag: "   ",
    });
    expect(query.status).toBeNull();
    expect(query.sort).toBe("newest");
    expect(query.tag).toBeNull();
  });

  test("clamps pagination to sane bounds", () => {
    expect(parsePublicBoardQuery({ page: "0", pageSize: "0" })).toMatchObject({
      page: 1,
      pageSize: PUBLIC_BOARD_PAGE_SIZE,
    });
    expect(parsePublicBoardQuery({ page: "-4", pageSize: "1000" })).toMatchObject({
      page: 1,
      pageSize: 50,
    });
    expect(parsePublicBoardQuery({ page: "abc" }).page).toBe(1);
  });

  test("caps the search length", () => {
    expect(parsePublicBoardQuery({ q: "a".repeat(500) }).search).toHaveLength(120);
  });
});

describe("publicBoardQueryString", () => {
  const query = parsePublicBoardQuery({});

  test("omits default values", () => {
    expect(publicBoardQueryString(query)).toBe("");
  });

  test("includes filters, sort and page as overrides", () => {
    expect(publicBoardQueryString(query, { sort: "top" })).toBe("?sort=top");
    expect(
      publicBoardQueryString(query, {
        search: "dark mode",
        status: "planned",
        tag: "billing",
        sort: "trending",
        page: 2,
      }),
    ).toBe("?q=dark+mode&status=planned&tag=billing&sort=trending&page=2");
  });

  test("keeps a non-default page size visible", () => {
    expect(publicBoardQueryString(query, { pageSize: 5 })).toBe("?pageSize=5");
  });

  test("resets a filter by passing null", () => {
    const filtered = parsePublicBoardQuery({ status: "planned", page: "4" });
    expect(publicBoardQueryString(filtered, { status: null, page: 1 })).toBe("");
  });
});

describe("parsePublicRoadmapSort", () => {
  test("defaults to recent and accepts the public vote switch", () => {
    expect(parsePublicRoadmapSort(undefined)).toBe("recent");
    expect(parsePublicRoadmapSort("recent")).toBe("recent");
    expect(parsePublicRoadmapSort("votes")).toBe("votes");
    expect(parsePublicRoadmapSort(["votes", "recent"])).toBe("votes");
  });

  test("never accepts an internal score mode", () => {
    expect(parsePublicRoadmapSort("priority")).toBe("recent");
    expect(parsePublicRoadmapSort("impact")).toBe("recent");
    expect(parsePublicRoadmapSort(7)).toBe("recent");
  });
});

describe("escapeLikePattern", () => {
  test("escapes wildcards and the escape character", () => {
    expect(escapeLikePattern("100%")).toBe("100\\%");
    expect(escapeLikePattern("a_b")).toBe("a\\_b");
    expect(escapeLikePattern("c:\\temp")).toBe("c:\\\\temp");
    expect(escapeLikePattern("plain")).toBe("plain");
  });
});

describe("resolveBoardSlug", () => {
  test("derives a slug from the name when the field is blank", () => {
    expect(resolveBoardSlug({ slug: "", name: "Feature Requests" })).toEqual({
      ok: true,
      slug: "feature-requests",
    });
  });

  test("keeps a supplied slug instead of rewriting it", () => {
    expect(resolveBoardSlug({ slug: "feedback", name: "Anything" })).toEqual({
      ok: true,
      slug: "feedback",
    });
  });

  test("rejects an invalid or reserved slug with a reason", () => {
    const invalid = resolveBoardSlug({ slug: "Not A Slug", name: "Anything" });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.reason).toContain("lowercase");

    const reserved = resolveBoardSlug({ slug: "api", name: "Anything" });
    expect(reserved.ok).toBe(false);
  });

  test("rejects a name with no URL-safe characters", () => {
    const result = resolveBoardSlug({ slug: "", name: "✨✨" });
    expect(result.ok).toBe(false);
  });
});
