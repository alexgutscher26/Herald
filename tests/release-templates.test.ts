import { describe, expect, test } from "bun:test";

import {
  buildReleaseTemplate,
  RELEASE_TEMPLATE_SUMMARIES,
} from "@/features/releases/templates";

const DATE = new Date("2026-11-21T12:00:00.000Z");

describe("release templates", () => {
  test("offers a recurring weekly digest with the week in the title", () => {
    const template = buildReleaseTemplate("weekly-digest", {
      productName: "Herald",
      date: DATE,
    });

    expect(template.title).toBe("Weekly digest · Nov 16–22, 2026");
    expect(template.summary).toContain("Herald");
    expect(template.body).toContain("## Shipped this week");
    expect(template.body).toContain("## Coming next");
    expect(template.tags).toEqual(["weekly-digest"]);
    expect(template.body.trim().length).toBeGreaterThan(20);
  });

  test("dates the monthly roundup from the applied date", () => {
    const template = buildReleaseTemplate("monthly-roundup", {
      productName: "Herald",
      date: DATE,
    });

    expect(template.title).toBe("Monthly roundup · November 2026");
    expect(template.category).toBe("improvement");
  });

  test("keeps every advertised template buildable and publishable", () => {
    for (const summary of RELEASE_TEMPLATE_SUMMARIES) {
      const template = buildReleaseTemplate(summary.id, {
        productName: "Herald",
        date: DATE,
      });
      expect(template.title.trim().length).toBeGreaterThanOrEqual(3);
      expect(template.summary.trim().length).toBeGreaterThanOrEqual(10);
      expect(template.body.trim().length).toBeGreaterThanOrEqual(20);
    }
  });
});
