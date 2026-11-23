import { findSensitiveInfo, type SensitiveFinding } from "@/features/public/sensitive";

/**
 * Automated moderation analysis.
 *
 * These checks are advisory: they attach reasons to a review for a human to
 * decide. They are deliberately high-precision — a link in a bug report is not
 * spam, and quoted error text is not abuse — because a false positive costs a
 * customer's trust. The matched text is never returned or stored.
 */

export type AutomatedModerationReason =
  | "spam"
  | "abuse"
  | "sensitive_info"
  | "sensitive_info_image"
  | "scan_unavailable"
  | "scan_error";

export type TextAnalysis = {
  reasons: AutomatedModerationReason[];
  sensitiveFindings: SensitiveFinding[];
  spamSignals: string[];
  abuseSignals: string[];
};

const SHORTENERS = [
  "bit.ly",
  "t.co",
  "tinyurl.com",
  "goo.gl",
  "cutt.ly",
  "is.gd",
  "buff.ly",
  "ow.ly",
];

const SPAM_PHRASES = [
  "buy now",
  "limited time offer",
  "click here to win",
  "work from home",
  "crypto giveaway",
  "seo services",
  "increase your traffic",
  "risk-free investment",
  "act now",
  "100% free",
];

const ABUSE_PATTERN =
  /\b(?:fuck(?:er|ing)?|motherfucker|shit(?:ty)?|bitch(?:es)?|asshole|bastard|cunt|dickhead|kill yourself|kys)\b/i;

function countUrls(text: string): number {
  return text.match(/\bhttps?:\/\/[^\s<>"']+/gi)?.length ?? 0;
}

function hasShortener(text: string): boolean {
  return SHORTENERS.some((host) =>
    new RegExp(`(?:^|[/.])${host.replace(/\./g, "\\.")}(?:[/?#]|$)`, "i").test(text),
  );
}

function hasRepeatedLine(text: string): boolean {
  const counts = new Map<string, number>();
  for (const line of text.split(/\r?\n/)) {
    const normalized = line.trim().toLowerCase();
    if (normalized.length < 8) continue;
    const next = (counts.get(normalized) ?? 0) + 1;
    if (next >= 4) return true;
    counts.set(normalized, next);
  }
  return false;
}

function isMostlyUppercase(text: string): boolean {
  const letters = text.replace(/[^A-Za-z]/g, "");
  if (letters.length < 80) return false;
  const uppercase = letters.replace(/[^A-Z]/g, "").length;
  return uppercase / letters.length > 0.7;
}

export function analyzeText(input: {
  title?: string | null | undefined;
  body: string;
}): TextAnalysis {
  const text = `${input.title ?? ""}\n${input.body}`;
  const spamSignals: string[] = [];
  const abuseSignals: string[] = [];

  if (countUrls(text) > 3) spamSignals.push("many_links");
  if (hasShortener(text)) spamSignals.push("link_shortener");
  if (/(.)\1{11,}/.test(text)) spamSignals.push("repeated_characters");
  if (hasRepeatedLine(text)) spamSignals.push("repeated_lines");
  if (isMostlyUppercase(text)) spamSignals.push("all_caps");
  for (const phrase of SPAM_PHRASES) {
    if (text.toLowerCase().includes(phrase)) {
      spamSignals.push("known_phrase");
      break;
    }
  }

  if (ABUSE_PATTERN.test(text)) abuseSignals.push("abusive_language");

  const sensitiveFindings = findSensitiveInfo(text);

  const reasons: AutomatedModerationReason[] = [];
  if (sensitiveFindings.length > 0) reasons.push("sensitive_info");
  if (spamSignals.length > 0) reasons.push("spam");
  if (abuseSignals.length > 0) reasons.push("abuse");

  return { reasons, sensitiveFindings, spamSignals, abuseSignals };
}

/** Labels for the moderation queue; never includes the matched value. */
export const MODERATION_REASON_LABELS: Record<string, string> = {
  spam: "Possible spam",
  abuse: "Abusive language",
  sensitive_info: "Sensitive information in text",
  sensitive_info_image: "Sensitive information in an image",
  scan_unavailable: "Image scan unavailable",
  scan_error: "Image scan failed",
};

export const MODERATION_REASON_DETAILS: Record<string, string> = {
  spam: "Several links, repeated lines, promotional phrases or shouting.",
  abuse: "Language that targets or threatens a person.",
  sensitive_info: "A card number, private key, cloud key or credential pattern.",
  sensitive_info_image: "Text in an attached image matched a sensitive pattern.",
  scan_unavailable:
    "The image could not be scanned because no image-text provider is configured.",
  scan_error: "The image-text provider failed; retry the check.",
};

export function reasonLabel(reason: string): string {
  return MODERATION_REASON_LABELS[reason] ?? reason.replaceAll("_", " ");
}
