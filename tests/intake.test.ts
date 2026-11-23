import { describe, expect, test } from "bun:test";

import {
  normalizeIntakeOptions,
  parseIntakeAnswers,
  type IntakeQuestionView,
} from "@/features/conversations/intake";

const questions: IntakeQuestionView[] = [
  { id: "1", key: "plan", label: "Plan", kind: "select", options: ["Free", "Pro"] },
  { id: "2", key: "use_case", label: "Use case", kind: "text", options: [] },
];

describe("structured intake", () => {
  test("keeps configured answers and drops blank, unknown or invalid ones", () => {
    expect(
      parseIntakeAnswers(questions, {
        plan: "Pro",
        use_case: "  Reporting  ",
        severity: "high",
        another: 4,
      }),
    ).toEqual({ plan: "Pro", use_case: "Reporting" });

    expect(parseIntakeAnswers(questions, { plan: "Enterprise" })).toEqual({});
    expect(parseIntakeAnswers(questions, { plan: "   " })).toEqual({});
    expect(parseIntakeAnswers(questions, null)).toEqual({});
    expect(parseIntakeAnswers(questions, ["Pro"])).toEqual({});
  });

  test("bounds a free-text answer and normalizes stored options", () => {
    expect(
      parseIntakeAnswers(questions, { use_case: "x".repeat(501) }),
    ).toEqual({});

    expect(
      normalizeIntakeOptions([" Free ", "Pro", "Free", "", 3, "x".repeat(81)]),
    ).toEqual(["Free", "Pro"]);
    expect(normalizeIntakeOptions("Free")).toEqual([]);
  });
});
