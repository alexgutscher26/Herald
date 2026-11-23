/**
 * Pure rules for request insights.
 *
 * Kept out of the database module so the manual action, the conversation
 * handoff and the API all validate the same way, and so the rules can be
 * tested without opening a socket.
 */

export const INSIGHT_SOURCES = [
  "support",
  "chat",
  "email",
  "call",
  "note",
  "api",
  "import",
] as const;

export type InsightSource = (typeof INSIGHT_SOURCES)[number];

/** Longer than a paragraph and the row stops being evidence. */
export const MAX_INSIGHT_LENGTH = 2_000;

/** A one-minute grace covers clock skew between an app server and Postgres. */
const FUTURE_TOLERANCE_MS = 60_000;

export const INSIGHT_SOURCE_LABELS: Record<InsightSource, string> = {
  support: "Support",
  chat: "Chat",
  email: "Email",
  call: "Call",
  note: "Team note",
  api: "API",
  import: "Import",
};

export {
  summarizeRequestDemand,
  type DemandEvidence,
  type RequestDemand,
} from "@/lib/request-demand";

export type InsightDraft = {
  quote: string;
  source: InsightSource;
  sourceRef: string | null;
  authorLabel: string | null;
  occurredAt: Date;
};

export type InsightDraftResult =
  | { ok: true; value: InsightDraft }
  | { ok: false; error: string; field: "quote" | "source" | "occurredAt" };

export function normalizeInsightDraft(input: {
  quote: string;
  source: string;
  sourceRef?: string | null;
  authorLabel?: string | null;
  occurredAt?: Date | null;
  now?: Date;
}): InsightDraftResult {
  const quote = input.quote.replace(/\r\n/g, "\n").trim();
  if (quote.length < 3) {
    return {
      ok: false,
      error: "Quote what the customer said, even briefly.",
      field: "quote",
    };
  }
  if (quote.length > MAX_INSIGHT_LENGTH) {
    return {
      ok: false,
      error: `Keep the quote under ${MAX_INSIGHT_LENGTH.toLocaleString("en-US")} characters.`,
      field: "quote",
    };
  }

  const source = INSIGHT_SOURCES.find((candidate) => candidate === input.source);
  if (!source) {
    return { ok: false, error: "Choose where this came from.", field: "source" };
  }

  const occurredAt = input.occurredAt ?? input.now ?? new Date();
  if (Number.isNaN(occurredAt.getTime())) {
    return { ok: false, error: "That date is not valid.", field: "occurredAt" };
  }
  const ceiling = (input.now ?? new Date()).getTime() + FUTURE_TOLERANCE_MS;
  if (occurredAt.getTime() > ceiling) {
    return {
      ok: false,
      error: "An insight cannot be dated in the future.",
      field: "occurredAt",
    };
  }

  return {
    ok: true,
    value: {
      quote,
      source,
      sourceRef: input.sourceRef?.trim().slice(0, 200) || null,
      authorLabel: input.authorLabel?.trim().slice(0, 160) || null,
      occurredAt,
    },
  };
}
