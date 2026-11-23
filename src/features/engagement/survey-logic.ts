/**
 * Survey branching rules.
 *
 * These helpers are pure and shared by the server (validation, storage, results)
 * and the public form (what to render). A question is visible only when every
 * question it depends on is itself visible and holds the expected answer, so a
 * chain "yes → why → how" collapses completely when the first answer changes.
 * Conditions may only point at an earlier question; that is what keeps the
 * graph acyclic and the stored configuration explicable.
 */

import type { SurveyQuestion } from "@/db/schema/engagement";

export type SurveyKind = "nps" | "csat" | "custom";

export function visibleSurveyQuestions(
  questions: readonly SurveyQuestion[],
  answers: Record<string, string>,
): SurveyQuestion[] {
  const byId = new Map(questions.map((question) => [question.id, question]));
  const visible = new Set<string>();
  const resolving = new Set<string>();

  function isVisible(question: SurveyQuestion): boolean {
    if (visible.has(question.id)) return true;
    if (!question.condition) {
      visible.add(question.id);
      return true;
    }
    if (resolving.has(question.id)) return false;
    const parent = byId.get(question.condition.questionId);
    if (!parent || parent.id === question.id) return false;

    resolving.add(question.id);
    const parentVisible = isVisible(parent);
    resolving.delete(question.id);
    if (!parentVisible) return false;
    if (answers[parent.id] !== question.condition.equals) return false;

    visible.add(question.id);
    return true;
  }

  return questions.filter(isVisible);
}

function ratingRange(kind: SurveyKind): { min: number; max: number } {
  return kind === "nps" ? { min: 0, max: 10 } : { min: 1, max: 5 };
}

/**
 * Reject a save that would produce a dead or cyclic branch.
 *
 * A missing reference would hide the question forever, a forward reference
 * would make the form depend on an answer collected later, and a choice value
 * that no longer exists would do the same. Better to refuse the save than to
 * store a survey that silently never asks half its questions.
 */
export function validateSurveyQuestions(
  questions: readonly SurveyQuestion[],
  kind: SurveyKind,
): { ok: true } | { ok: false; error: string } {
  const seen = new Set<string>();
  for (const question of questions) {
    if (seen.has(question.id)) {
      return {
        ok: false,
        error: `Two questions share the id “${question.id}”. Give each question a unique id.`,
      };
    }
    seen.add(question.id);
  }

  const indexById = new Map(questions.map((question, index) => [question.id, index]));
  const range = ratingRange(kind);

  for (const [index, question] of questions.entries()) {
    const condition = question.condition;
    if (!condition) continue;
    const parentIndex = indexById.get(condition.questionId);
    if (parentIndex === undefined) {
      return {
        ok: false,
        error: `“${question.prompt}” is shown when “${condition.questionId}” is answered, but no earlier question has that id.`,
      };
    }
    if (parentIndex >= index) {
      return {
        ok: false,
        error: `“${question.prompt}” depends on a question that comes after it. A follow-up can only use an earlier answer.`,
      };
    }
    const parent = questions[parentIndex]!;
    if (parent.type === "choice" && (parent.options ?? []).length > 0) {
      if (!(parent.options ?? []).includes(condition.equals)) {
        return {
          ok: false,
          error: `“${question.prompt}” waits for an answer that “${parent.prompt}” does not offer.`,
        };
      }
    }
    if (parent.type === "rating") {
      const value = Number.parseInt(condition.equals, 10);
      if (
        !Number.isInteger(value) ||
        String(value) !== condition.equals.trim() ||
        value < range.min ||
        value > range.max
      ) {
        return {
          ok: false,
          error: `“${question.prompt}” waits for a rating outside ${range.min}–${range.max}.`,
        };
      }
    }
  }

  return { ok: true };
}

/** Human-readable branch sentence for the admin detail page. */
export function conditionSummary(
  question: SurveyQuestion,
  questions: readonly SurveyQuestion[],
): string | null {
  if (!question.condition) return null;
  const parent = questions.find((entry) => entry.id === question.condition?.questionId);
  const prompt = parent?.prompt ?? question.condition.questionId;
  return `only if “${prompt}” = “${question.condition.equals}”`;
}
