/**
 * Structured intake answers.
 *
 * Intake is deliberately optional. Parsing is pure and forgiving: a blank or
 * malformed answer is dropped instead of failing the submission, and a guest
 * is never asked to identify themselves to answer. Callers merge the returned
 * traits onto the customer record; nothing here inserts a row.
 */

export type IntakeQuestionView = {
  id: string;
  key: string;
  label: string;
  kind: "text" | "select";
  options: string[];
};

export const INTAKE_ANSWER_MAX_LENGTH = 500;
export const INTAKE_QUESTION_LIMIT = 10;

/**
 * Keep only answers that match a configured, active question.
 *
 * An unknown key is ignored rather than stored: otherwise a public form could
 * write arbitrary trait names by posting extra JSON. A select answer must be
 * one of its options, and every value is trimmed and bounded.
 */
export function parseIntakeAnswers(
  questions: IntakeQuestionView[],
  raw: unknown,
): Record<string, string> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};

  const input = raw as Record<string, unknown>;
  const traits: Record<string, string> = {};

  for (const question of questions.slice(0, INTAKE_QUESTION_LIMIT)) {
    const value = input[question.key];
    if (typeof value !== "string") continue;

    const trimmed = value.trim();
    if (trimmed === "" || trimmed.length > INTAKE_ANSWER_MAX_LENGTH) continue;
    if (question.kind === "select" && !question.options.includes(trimmed)) continue;

    traits[question.key] = trimmed;
  }

  return traits;
}

/** Normalize a stored option list without trusting the database contents. */
export function normalizeIntakeOptions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((option): option is string => typeof option === "string")
        .map((option) => option.trim())
        .filter((option) => option !== "" && option.length <= 80),
    ),
  ].slice(0, 20);
}
