import { describe, expect, test } from "bun:test";

import type { SurveyQuestion } from "@/db/schema/engagement";
import { PLANS } from "@/features/entitlements/plans";
import { npsTrend, summarizeNps } from "@/features/engagement/nps";
import { toSurveyResponseCsv } from "@/features/engagement/responses-csv";
import {
  conditionSummary,
  validateSurveyQuestions,
  visibleSurveyQuestions,
} from "@/features/engagement/survey-logic";
import { extractKeywordThemes } from "@/features/engagement/themes";
import {
  describeRule,
  matchesTargeting,
  normalizeTargetingRules,
} from "@/features/engagement/rules";

const QUESTIONS: SurveyQuestion[] = [
  { id: "recommend", type: "rating", prompt: "How likely are you to recommend us?" },
  {
    id: "used_export",
    type: "choice",
    prompt: "Did you use the export?",
    options: ["Yes", "No"],
  },
  {
    id: "export_problem",
    type: "text",
    prompt: "What went wrong with the export?",
    condition: { questionId: "used_export", equals: "Yes" },
  },
  {
    id: "export_detail",
    type: "text",
    prompt: "Which part of the export failed?",
    condition: { questionId: "export_problem", equals: "CSV is empty" },
  },
];

describe("survey branching", () => {
  test("a follow-up shows only when its parent answer matches", () => {
    expect(visibleSurveyQuestions(QUESTIONS, { used_export: "No" }).map((q) => q.id)).toEqual([
      "recommend",
      "used_export",
    ]);
    expect(visibleSurveyQuestions(QUESTIONS, { used_export: "Yes" }).map((q) => q.id)).toEqual([
      "recommend",
      "used_export",
      "export_problem",
    ]);
  });

  test("a chain collapses when an earlier answer changes", () => {
    const answers = { used_export: "Yes", export_problem: "CSV is empty" };
    expect(visibleSurveyQuestions(QUESTIONS, answers).map((q) => q.id)).toContain(
      "export_detail",
    );
    // The stale answer for export_problem must not keep export_detail visible.
    expect(
      visibleSurveyQuestions(QUESTIONS, { ...answers, used_export: "No" }).map((q) => q.id),
    ).not.toContain("export_detail");
  });

  test("a condition may not point forward, vanish or offer a value the parent cannot give", () => {
    expect(
      validateSurveyQuestions(
        [
          { id: "a", type: "text", prompt: "A", condition: { questionId: "b", equals: "x" } },
          { id: "b", type: "choice", prompt: "B", options: ["x", "y"] },
        ],
        "custom",
      ).ok,
    ).toBe(false);

    const missing = validateSurveyQuestions(
      [
        { id: "a", type: "text", prompt: "A", condition: { questionId: "nope", equals: "x" } },
      ],
      "custom",
    );
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toContain("no earlier question");

    expect(
      validateSurveyQuestions(
        [
          { id: "a", type: "choice", prompt: "A", options: ["x", "y"] },
          { id: "b", type: "text", prompt: "B", condition: { questionId: "a", equals: "z" } },
        ],
        "custom",
      ).ok,
    ).toBe(false);

    expect(
      validateSurveyQuestions(QUESTIONS, "nps").ok,
    ).toBe(true);
    expect(
      validateSurveyQuestions(
        [
          { id: "a", type: "rating", prompt: "A" },
          { id: "b", type: "text", prompt: "B", condition: { questionId: "a", equals: "11" } },
        ],
        "nps",
      ).ok,
    ).toBe(false);
    expect(
      validateSurveyQuestions(
        [
          { id: "a", type: "rating", prompt: "A" },
          { id: "b", type: "text", prompt: "B", condition: { questionId: "a", equals: "5" } },
        ],
        "csat",
      ).ok,
    ).toBe(true);
  });

  test("duplicate question ids are refused", () => {
    const result = validateSurveyQuestions(
      [
        { id: "a", type: "text", prompt: "A" },
        { id: "a", type: "text", prompt: "B" },
      ],
      "custom",
    );
    expect(result.ok).toBe(false);
  });

  test("the admin summary names the parent prompt", () => {
    expect(conditionSummary(QUESTIONS[2]!, QUESTIONS)).toBe(
      "only if “Did you use the export?” = “Yes”",
    );
  });
});

describe("NPS", () => {
  test("splits promoters, passives and detractors and excludes passives from the score", () => {
    const summary = summarizeNps([10, 9, 8, 7, 6, 0]);
    expect(summary).toEqual({
      total: 6,
      promoters: 2,
      passives: 2,
      detractors: 2,
      promoterPct: 33.3,
      passivePct: 33.3,
      detractorPct: 33.3,
      score: 0,
    });
  });

  test("a missing or invalid rating is not a response", () => {
    expect(summarizeNps([])).toBeNull();
    expect(summarizeNps([11, -1, Number.NaN])).toBeNull();
  });

  test("trend keeps empty weeks as null instead of compressing the timeline", () => {
    const now = new Date("2026-11-18T12:00:00Z");
    const trend = npsTrend(
      [
        { createdAt: new Date("2026-11-17T09:00:00Z"), score: 10 },
        { createdAt: new Date("2026-11-10T09:00:00Z"), score: 5 },
        { createdAt: new Date("2026-10-01T09:00:00Z"), score: 10 },
        { createdAt: new Date("2026-12-01T09:00:00Z"), score: 10 },
      ],
      3,
      now,
    );
    expect(trend.map((point) => [point.start, point.responses, point.score])).toEqual([
      ["2026-11-02", 0, null],
      ["2026-11-09", 1, -100],
      ["2026-11-16", 1, 100],
    ]);
  });
});

describe("keyword themes", () => {
  test("counts a term once per response and drops stopwords, numbers and one-offs", () => {
    const themes = extractKeywordThemes([
      "export broken and slow",
      "export broken again",
      "I like the dashboard",
      "12345 67",
    ]);
    expect(themes).toContainEqual({ term: "export", count: 2, kind: "word" });
    expect(themes).toContainEqual({ term: "broken", count: 2, kind: "word" });
    expect(themes).toContainEqual({ term: "export broken", count: 2, kind: "phrase" });
    expect(themes.some((theme) => /^\d+$/.test(theme.term))).toBe(false);
    expect(themes.some((theme) => theme.term === "the")).toBe(false);
    expect(themes.some((theme) => theme.term === "dashboard")).toBe(false);
  });

  test("ranks by prevalence, phrases first on a tie", () => {
    const themes = extractKeywordThemes([
      "pricing high",
      "pricing high",
      "support slow",
      "support slow",
    ]);
    expect(themes[0]).toEqual({ term: "pricing high", count: 2, kind: "phrase" });
    expect(themes[1]).toEqual({ term: "support slow", count: 2, kind: "phrase" });
  });
});

describe("response CSV", () => {
  test("has one column per question and neutralises spreadsheet formulas", () => {
    const csv = toSurveyResponseCsv({
      kind: "nps",
      questions: QUESTIONS,
      rows: [
        {
          id: "r1",
          createdAt: new Date("2026-11-18T10:00:00Z"),
          score: 9,
          optedIn: true,
          feedbackPostId: null,
          customerId: null,
          visitorKey: "visitor-123",
          answers: {
            recommend: "9",
            used_export: "Yes",
            export_problem: "=SUM(A1:A2)",
          },
        },
      ],
    });
    const lines = csv.trim().split("\n");
    expect(lines[0]).toContain("response_id,submitted_at,score,nps_bucket");
    expect(lines[0]).toContain("Did you use the export? [used_export]");
    expect(lines[1]).toContain("promoter");
    expect(lines[1]).toContain("'=SUM(A1:A2)");
    expect(lines[1]).toContain("true");
  });

  test("quotes prompts that contain commas", () => {
    const csv = toSurveyResponseCsv({
      kind: "custom",
      questions: [{ id: "q", type: "text", prompt: "Where, exactly?" }],
      rows: [],
    });
    expect(csv.split("\n")[0]).toContain('"Where, exactly? [q]"');
  });
});

describe("survey impression entitlement", () => {
  test("Free is capped and paid plans are unlimited", () => {
    expect(PLANS.free.limits.monthlySurveyImpressions).toBe(500);
    expect(PLANS.starter.limits.monthlySurveyImpressions).toBeNull();
    expect(PLANS.pro.limits.monthlySurveyImpressions).toBeNull();
    expect(PLANS.lifetime.limits.monthlySurveyImpressions).toBeNull();
  });
});

describe("targeting rules", () => {
  test("event rules survive normalization and wait for a fired event", () => {
    const rules = normalizeTargetingRules([
      { type: "event", value: "checkout_completed" },
    ]);
    expect(rules).toHaveLength(1);
    expect(matchesTargeting(rules, {})).toBe(false);
    expect(matchesTargeting(rules, { events: ["checkout_completed"] })).toBe(true);
    expect(describeRule(rules[0]!)).toBe("event checkout_completed");
  });

  test("a malformed event rule is dropped rather than guessed at", () => {
    expect(normalizeTargetingRules([{ type: "event", value: "" }])).toHaveLength(0);
  });
});

describe("widget event triggers", () => {
  test("the loader waits for a tracked event and exposes track()", async () => {
    const loader = await Bun.file("public/widget/v1.js").text();
    expect(loader).toContain('if (rule.type === "event")');
    expect(loader).toContain("if (!state.events[rule.value]) return false;");
    expect(loader).toContain("track: function (name)");
    expect(loader).toContain('getAttribute("data-herald-event")');
    // A survey prompt's CTA must stay on the Herald origin.
    expect(loader).toContain("item.impressionPath && cta.charAt(0) === \"/\"");
    expect(loader).toContain("type: \"track\"");
  });
});
