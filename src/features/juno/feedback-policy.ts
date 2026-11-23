/**
 * Pure feedback-card policy.
 *
 * Kept out of the `server-only` module so the widget-independent rules can be
 * unit-tested: what counts as a request, how the draft title is derived, and
 * the limits the server enforces.
 */

export const MAX_CREATES_PER_CONVERSATION = 3;
export const MAX_CREATES_PER_WORKSPACE_DAY = 25;
export const MAX_VOTES_PER_CONVERSATION = 10;
export const FEEDBACK_CARD_TTL_MINUTES = 30;

const FEEDBACK_INTENT = [
  /\b(feature request|suggestion|feedback)\b/i,
  /\b(can|could|would) you (please )?(add|support|build|implement|allow)\b/i,
  /\bwould be (really |very )?(great|nice|helpful|useful)\b/i,
  /\bi wish (there|it|you)\b/i,
  /\bplease add\b/i,
  /\bvote (for|on)\b/i,
  /\bfollow (this|that|the) (request|issue|feature)\b/i,
];

/** A cheap gate so ordinary support questions never get a card. */
export function isFeedbackIntent(text: string): boolean {
  return FEEDBACK_INTENT.some((pattern) => pattern.test(text));
}

export function deriveRequestTitle(question: string): string {
  const first = question.replace(/\s+/g, " ").trim();
  const sentence = first.split(/[.!?]/)[0]?.trim() ?? "";
  const title = sentence.slice(0, 140);
  return title.length >= 3 ? title : "Feature request";
}
