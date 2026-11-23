import type { ReleaseCover } from "@/types";

/**
 * Soft publish-readiness checks.
 *
 * These never block publication. They surface the details that make a release
 * entry useful in a changelog list, an email and a social card, and let the
 * author make the final call.
 */

export type ReleaseChecklistId = "title" | "summary" | "linked-request" | "og-image";

export type ReleaseChecklistItem = {
  id: ReleaseChecklistId;
  label: string;
  passed: boolean;
  detail: string;
};

export function releaseChecklist(input: {
  title: string;
  summary: string;
  linkedFeedbackCount: number;
  cover: ReleaseCover;
}): ReleaseChecklistItem[] {
  const titleLength = input.title.trim().length;
  const summaryLength = input.summary.trim().length;

  return [
    {
      id: "title",
      label: "Title length",
      passed: titleLength >= 10 && titleLength <= 70,
      detail:
        titleLength === 0
          ? "Add a title before publishing."
          : titleLength < 10
            ? "A short title can be hard to scan in a list or email subject."
            : titleLength > 70
              ? "Long titles are truncated in lists, email subjects and social cards."
              : "A concise, scannable title.",
    },
    {
      id: "summary",
      label: "Summary",
      passed: summaryLength >= 20 && summaryLength <= 160,
      detail:
        summaryLength === 0
          ? "Add a one-sentence summary."
          : summaryLength < 20
            ? "A little more context helps readers decide whether to open the entry."
            : summaryLength > 160
              ? "Search and social previews usually cut summaries after about 160 characters."
              : "Good length for lists and previews.",
    },
    {
      id: "linked-request",
      label: "Linked request",
      passed: input.linkedFeedbackCount > 0,
      detail:
        input.linkedFeedbackCount > 0
          ? "Readers can trace the release back to customer feedback."
          : "Link at least one shipped request so readers see what motivated the change.",
    },
    {
      id: "og-image",
      label: "OG / social image",
      passed: input.cover.kind !== "none",
      detail:
        input.cover.kind === "none"
          ? "Choose a preset or upload a cover so shared links have a social image."
          : "A cover is available for the public page and social preview.",
    },
  ];
}
