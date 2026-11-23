/**
 * Pre-inbox spam screening for conversations.
 *
 * Runs before a thread enters Queue: widget starts, widget replies and inbound
 * email all pass the same rules, so an abusive message is visible in Spam
 * rather than in the working inbox. The rules are deliberately transparent and
 * conservative — a false positive costs one Spam-tab review, and the reason is
 * stored on the row so an operator can see why it was held.
 */

import type { ConversationSpamRules } from "@/db/schema/support";

export const DEFAULT_SPAM_RULES: ConversationSpamRules = {
  enabled: true,
  minimumScore: 2,
  linkThreshold: 4,
  keywords: [
    "viagra",
    "cialis",
    "casino",
    "crypto giveaway",
    "bitcoin doubler",
    "seo services",
    "buy backlinks",
    "work from home",
    "replica watches",
    "escort service",
    "adult dating",
    "guaranteed loan",
  ],
  shouting: true,
  repetition: true,
  moneyPromise: true,
};

function keywordPattern(keywords: string[]): RegExp | null {
  const escaped = keywords
    .map((keyword) => keyword.trim().toLowerCase())
    .filter((keyword) => keyword.length > 0)
    .slice(0, 50)
    .map((keyword) =>
      keyword
        .split("")
        .map((character) =>
          "\\^$.*+?()[]{}|".includes(character) ? `\\${character}` : character,
        )
        .join(""),
    );
  return escaped.length > 0 ? new RegExp(`\\b(${escaped.join("|")})\\b`, "i") : null;
}

const LINK_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"')]+/gi;

const MONEY_PROMISE = /\b(earn|make|profit)\s+\$?\d{2,}/i;

const REPETITION = /(.)\1{9,}/;

export type SpamVerdict = {
  spam: boolean;
  /** Stable rule codes, comma-joined, or null when the message is clean. */
  reason: string | null;
  score: number;
};

function countLinks(text: string): number {
  return text.match(LINK_PATTERN)?.length ?? 0;
}

export function classifyConversationSpam(input: {
  subject?: string | null;
  body: string;
}, overrides?: ConversationSpamRules | null): SpamVerdict {
  const rules = { ...DEFAULT_SPAM_RULES, ...(overrides ?? {}) };
  if (!rules.enabled) return { spam: false, reason: null, score: 0 };
  const body = input.body ?? "";
  const text = `${input.subject ?? ""}\n${body}`;
  const reasons: string[] = [];
  let score = 0;

  const links = countLinks(text);
  const linkThreshold = Math.min(Math.max(Math.trunc(rules.linkThreshold), 2), 20);
  if (links >= linkThreshold) {
    reasons.push("many_links");
    score += 2;
  } else if (links >= Math.ceil(linkThreshold / 2)) {
    reasons.push("several_links");
    score += 1;
  }

  const terms = keywordPattern(rules.keywords);
  if (terms?.test(text)) {
    reasons.push("spam_keywords");
    score += 2;
  }

  const letters = body.replace(/[^A-Za-z]/g, "");
  if (rules.shouting && letters.length >= 40) {
    const upper = letters.replace(/[^A-Z]/g, "").length;
    if (upper / letters.length > 0.7) {
      reasons.push("shouting");
      score += 1;
    }
  }

  if (rules.repetition && REPETITION.test(body)) {
    reasons.push("repetition");
    score += 1;
  }

  if (rules.moneyPromise && MONEY_PROMISE.test(text)) {
    reasons.push("money_promise");
    score += 1;
  }

  return {
    spam: score >= Math.min(Math.max(Math.trunc(rules.minimumScore), 1), 10),
    reason: reasons.length > 0 ? reasons.join(",") : null,
    score,
  };
}
