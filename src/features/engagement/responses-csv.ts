/**
 * Survey response CSV.
 *
 * One row per response, one column per configured question, so a spreadsheet
 * mirrors the survey rather than a key/value dump. Every cell is quoted when
 * needed and neutralises spreadsheet formulas: question prompts and free-text
 * answers are user-supplied.
 */

import type { SurveyQuestion } from "@/db/schema/engagement";

export type SurveyCsvRow = {
  id: string;
  createdAt: Date;
  score: number | null;
  optedIn: boolean;
  feedbackPostId: string | null;
  customerId: string | null;
  visitorKey: string;
  answers: Record<string, string>;
};

function csvCell(value: string | number | boolean | null): string {
  if (value === null) return "";
  const raw = String(value);
  const guarded = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  if (/[",\n\r]/.test(guarded)) return `"${guarded.replaceAll('"', '""')}"`;
  return guarded;
}

function npsBucket(score: number | null): string {
  if (score === null) return "";
  if (score >= 9) return "promoter";
  if (score >= 7) return "passive";
  return "detractor";
}

export function toSurveyResponseCsv(input: {
  kind: "nps" | "csat" | "custom";
  questions: readonly SurveyQuestion[];
  rows: readonly SurveyCsvRow[];
}): string {
  const header = [
    "response_id",
    "submitted_at",
    "score",
    "nps_bucket",
    "opted_in",
    "feedback_request_id",
    "customer_id",
    "visitor_key",
    ...input.questions.map((question) => `${question.prompt} [${question.id}]`),
  ];

  const lines = [header.map(csvCell).join(",")];
  for (const row of input.rows) {
    lines.push(
      [
        row.id,
        row.createdAt.toISOString(),
        row.score,
        input.kind === "nps" ? npsBucket(row.score) : "",
        row.optedIn ? "true" : "false",
        row.feedbackPostId,
        row.customerId,
        row.visitorKey,
        ...input.questions.map((question) => row.answers[question.id] ?? ""),
      ]
        .map(csvCell)
        .join(","),
    );
  }

  return `${lines.join("\n")}\n`;
}
