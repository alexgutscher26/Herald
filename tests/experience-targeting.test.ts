import { describe, expect, test } from "bun:test";

import {
  experienceScheduleProblem,
  experienceScheduleState,
  filterExperienceStepAudience,
  frequencyLabel,
  frequencyReached,
  normalizeExperienceContent,
} from "@/features/engagement/experiences";

import type { ExperienceContent } from "@/db/schema/engagement";

const DAY_MS = 24 * 60 * 60 * 1000;

function tourContent(): ExperienceContent {
  return {
    en: {
      title: "Welcome",
      body: "Take the tour.",
      ctaPanel: "messages",
      steps: [
        {
          selector: "#save",
          title: "Save",
          body: "Save the record.",
          audience: [
            { type: "page_url", operator: "contains", value: "/settings" },
          ],
        },
        {
          selector: "#billing",
          title: "Billing",
          body: "Only for Pro customers.",
          audience: [
            { type: "attribute", key: "plan", operator: "equals", value: "pro" },
          ],
        },
      ],
    },
    es: {
      title: "Bienvenido",
      body: "Haz el recorrido.",
      steps: [
        {
          selector: "#guardar",
          title: "Guardar",
          body: "Guarda el registro.",
        },
      ],
    },
  };
}

describe("experience content", () => {
  test("validates every locale variant and keeps step audiences", () => {
    const result = normalizeExperienceContent(tourContent(), "tour", "en");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.locale).toBe("en");
    expect(result.content.es?.title).toBe("Bienvenido");
    expect(result.content.en?.ctaPanel).toBe("messages");
    expect(result.content.en?.steps?.[0]?.audience).toEqual([
      { type: "page_url", operator: "contains", value: "/settings" },
    ]);
  });

  test("refuses a half-translated variant instead of mixing fields", () => {
    const content = tourContent();
    const result = normalizeExperienceContent(
      { ...content, es: { title: "Bienvenido" } },
      "tour",
      "en",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("ES title and body");
  });

  test("only the loader's locales are accepted", () => {
    const result = normalizeExperienceContent(
      { ...tourContent(), fr: tourContent().en },
      "tour",
      "en",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Unsupported content locale: fr");
  });

  test("filters a step's attribute audience on the server", () => {
    const result = normalizeExperienceContent(tourContent(), "tour", "en");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const free = filterExperienceStepAudience(result.content, { plan: "free" });
    expect(free.en?.steps?.map((step) => step.selector)).toEqual(["#save"]);
    const pro = filterExperienceStepAudience(result.content, { plan: "pro" });
    expect(pro.en?.steps?.map((step) => step.selector)).toEqual([
      "#save",
      "#billing",
    ]);
    // The browser-local rule survives for the loader to evaluate.
    expect(pro.en?.steps?.[0]?.audience).toEqual([
      { type: "page_url", operator: "contains", value: "/settings" },
    ]);
  });
});

describe("experience schedule", () => {
  const start = new Date("2026-11-22T10:00:00Z");
  const end = new Date("2026-11-25T10:00:00Z");

  test("a window must end after it starts", () => {
    expect(experienceScheduleProblem(start, start)).toContain("after its start");
    expect(experienceScheduleProblem(end, start)).toContain("after its start");
    expect(experienceScheduleProblem(start, end)).toBeNull();
    expect(experienceScheduleProblem(null, null)).toBeNull();
  });

  test("describes scheduled, live, ended and unbounded windows", () => {
    const before = Date.parse("2026-11-21T00:00:00Z");
    const during = Date.parse("2026-11-23T00:00:00Z");
    const after = Date.parse("2026-11-26T00:00:00Z");
    expect(
      experienceScheduleState({ scheduleStart: start, scheduleEnd: end }, before),
    ).toBe("scheduled");
    expect(
      experienceScheduleState({ scheduleStart: start, scheduleEnd: end }, during),
    ).toBe("live");
    expect(
      experienceScheduleState({ scheduleStart: start, scheduleEnd: end }, after),
    ).toBe("ended");
    expect(
      experienceScheduleState({ scheduleStart: null, scheduleEnd: null }, during),
    ).toBe("always");
  });
});

describe("experience frequency", () => {
  const now = Date.parse("2026-11-21T12:00:00Z");

  test("counts views inside the rolling window and treats 0 as unlimited", () => {
    const views = [new Date(now - DAY_MS), new Date(now - 2 * DAY_MS)];
    expect(frequencyReached(views, 0, 7, now)).toBe(false);
    expect(frequencyReached(views, 2, 7, now)).toBe(true);
    expect(frequencyReached(views, 3, 7, now)).toBe(false);
    expect(frequencyReached(views, 2, 1, now)).toBe(false);
  });

  test("labels the cap for the admin list", () => {
    expect(frequencyLabel(0, 7)).toBe("Unlimited impressions");
    expect(frequencyLabel(3, 1)).toBe("3 per 1 day");
    expect(frequencyLabel(3, 14)).toBe("3 per 14 days");
  });
});

describe("experience loader contract", () => {
  test("targets steps, reports rendered views and carries the preview token", async () => {
    const loader = await Bun.file("public/widget/v1.js").text();
    expect(loader).toContain("if (!rulesMatch(step.audience)) return false;");
    expect(loader).toContain('getAttribute("data-preview")');
    expect(loader).toContain('params.push("preview=" + encodeURIComponent(previewToken))');
    expect(loader).toContain("item.impressionPath || item.viewPath");
    expect(loader).toContain('type: "track"');
  });
});
