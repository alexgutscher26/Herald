import { describe, expect, test } from "bun:test";

import {
  isEmptyViewFilters,
  normalizeViewFilters,
} from "@/features/feedback/saved-view-filters";
import type { FeedbackSavedViewFilters } from "@/types";

describe("saved view filters", () => {
  test("keeps valid filters and trims the search", () => {
    expect(
      normalizeViewFilters({
        search: "  crash  ",
        status: "planned",
        category: "bug",
        sort: "priority",
        minScore: 4,
        segment: { key: " plan ", value: " pro " },
      }),
    ).toEqual({
      search: "crash",
      status: "planned",
      category: "bug",
      sort: "priority",
      customFieldSort: null,
      customFields: {},
      minScore: 4,
      segment: { key: "plan", value: "pro" },
      assignee: "all",
      stale: "all",
    });
  });

  test("falls back to safe defaults for malformed jsonb", () => {
    const defaults: FeedbackSavedViewFilters = {
      search: "",
      status: "all",
      category: "all",
      sort: "newest",
      customFieldSort: null,
      customFields: {},
      minScore: null,
      segment: null,
      assignee: "all",
      stale: "all",
    };
    expect(normalizeViewFilters(null)).toEqual(defaults);
    expect(normalizeViewFilters({ status: "deleted", sort: 7 })).toEqual(defaults);
    expect(normalizeViewFilters(["planned"])).toEqual(defaults);
  });

  test("drops out-of-range scores and incomplete segments", () => {
    expect(normalizeViewFilters({ minScore: 0 }).minScore).toBeNull();
    expect(normalizeViewFilters({ minScore: 101 }).minScore).toBeNull();
    expect(normalizeViewFilters({ minScore: 2.5 }).minScore).toBeNull();
    expect(normalizeViewFilters({ segment: { key: "plan", value: "" } }).segment).toBeNull();
    expect(normalizeViewFilters({ segment: { key: "", value: "pro" } }).segment).toBeNull();
  });

  test("keeps a valid custom-field sort and drops a malformed one", () => {
    expect(
      normalizeViewFilters({
        customFieldSort: { key: " seat_count ", direction: "desc" },
      }).customFieldSort,
    ).toEqual({ key: "seat_count", direction: "desc" });
    expect(
      normalizeViewFilters({ customFieldSort: { key: "Bad Key", direction: "asc" } })
        .customFieldSort,
    ).toBeNull();
    expect(
      normalizeViewFilters({ customFieldSort: { key: "seats", direction: "sideways" } })
        .customFieldSort,
    ).toBeNull();
  });

  test("caps an over-long search at the request limit", () => {
    expect(normalizeViewFilters({ search: "x".repeat(200) }).search).toHaveLength(120);
  });

  test("recognizes the unfiltered view", () => {
    expect(
      isEmptyViewFilters({
        search: "",
        status: "all",
        category: "all",
        sort: "newest",
      }),
    ).toBe(true);
    expect(
      isEmptyViewFilters({
        search: "",
        status: "planned",
        category: "all",
        sort: "newest",
      }),
    ).toBe(false);
    expect(
      isEmptyViewFilters({
        search: "",
        status: "all",
        category: "all",
        sort: "newest",
        minScore: 4,
      }),
    ).toBe(false);
    expect(
      isEmptyViewFilters({
        search: "",
        status: "all",
        category: "all",
        sort: "newest",
        segment: { key: "plan", value: "pro" },
      }),
    ).toBe(false);
    expect(
      isEmptyViewFilters({
        search: "",
        status: "all",
        category: "all",
        sort: "newest",
        customFieldSort: { key: "seats", direction: "asc" },
      }),
    ).toBe(false);
  });
});
