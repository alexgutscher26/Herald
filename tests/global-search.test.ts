import { describe, expect, test } from "bun:test";

import {
  escapeSearchPattern,
  isSearchableQuery,
  normalizeSearchQuery,
  searchPattern,
  SEARCH_MAX_LENGTH,
} from "@/features/search/query";

describe("global search query", () => {
  test("trims, collapses whitespace and caps the length", () => {
    expect(normalizeSearchQuery("  export   csv  ")).toBe("export csv");
    expect(normalizeSearchQuery("a".repeat(SEARCH_MAX_LENGTH + 20))).toHaveLength(
      SEARCH_MAX_LENGTH,
    );
    expect(normalizeSearchQuery(null)).toBe("");
    expect(normalizeSearchQuery(undefined)).toBe("");
  });

  test("requires at least two characters", () => {
    expect(isSearchableQuery("")).toBe(false);
    expect(isSearchableQuery("a")).toBe(false);
    expect(isSearchableQuery("ab")).toBe(true);
  });

  test("escapes LIKE metacharacters instead of treating them as wildcards", () => {
    expect(escapeSearchPattern("100%_done\\now")).toBe("100\\%\\_done\\\\now");
    expect(searchPattern("50%")).toBe("%50\\%%");
  });
});
