import { describe, expect, test } from "bun:test";

import { getNavItems } from "@/components/layout/nav-items";

/**
 * The primary navigation should only advertise destinations that work. The
 * unbuilt sections stay defined so direct URLs still resolve to an explanatory
 * page and a breadcrumb, but they must not appear in the sidebar or mobile
 * sheet until they ship.
 */

const HIDDEN: string[] = [];

const VISIBLE = [
  "Overview",
  "Releases",
  "Feedback",
  "Inbox",
  "Moderation",
  "Boards",
  "Roadmap",
  "Help center",
  "API docs",
  "Widget",
  "Surveys",
  "Tours & banners",
  "Outbound",
  "Subscribers",
  "Segments",
  "Win-back",
  "Analytics",
  "Operations",
  "Integrations",
  "Import & export",
  "Settings",
];

describe("dashboard navigation", () => {
  test("lists only sections that are backed by a working page", () => {
    const labels = getNavItems("acme", "app").map((item) => item.label);

    expect(labels).toEqual(VISIBLE);
    for (const label of HIDDEN) expect(labels).not.toContain(label);
  });

  test("keeps unbuilt sections addressable for direct URLs and breadcrumbs", () => {
    const all = getNavItems("acme", "app", { includeUnavailable: true });

    expect(all).toHaveLength(VISIBLE.length + HIDDEN.length);
    for (const label of HIDDEN) {
      const item = all.find((candidate) => candidate.label === label);
      expect(item?.available).toBe(false);
      expect(item?.href).toBe(`/app/acme/app/${item?.segment}`);
    }
  });

  test("every visible section has a distinct URL and an available page", () => {
    const items = getNavItems("acme", "app");
    const hrefs = items.map((item) => item.href);

    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(items.every((item) => item.available)).toBe(true);
  });
});
