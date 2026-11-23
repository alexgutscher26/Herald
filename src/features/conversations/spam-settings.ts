import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { conversationSpamFeedback } from "@/db/schema/conversations";
import {
  productSupportSettings,
  type ConversationSpamRules,
} from "@/db/schema/support";

import { DEFAULT_SPAM_RULES } from "./spam";

type Executor = Pick<typeof db, "select">;

/**
 * Load a product's spam configuration.
 *
 * A missing row, or a null column, intentionally falls back to the same code
 * defaults the classifier has always used. A malformed stored value is also
 * treated as absent rather than letting one bad save disable screening.
 */
export async function loadSpamRules(
  executor: Executor,
  productId: string,
): Promise<ConversationSpamRules> {
  const rows = await executor
    .select({ rules: productSupportSettings.spamRules })
    .from(productSupportSettings)
    .where(eq(productSupportSettings.productId, productId))
    .limit(1);

  return normalizeSpamRules(rows[0]?.rules);
}

export function normalizeSpamRules(
  value: ConversationSpamRules | null | undefined,
): ConversationSpamRules {
  if (!value || typeof value !== "object") return DEFAULT_SPAM_RULES;

  return {
    enabled: value.enabled !== false,
    minimumScore:
      Number.isFinite(value.minimumScore) && Number(value.minimumScore) >= 1
        ? Math.min(Math.trunc(Number(value.minimumScore)), 10)
        : DEFAULT_SPAM_RULES.minimumScore,
    linkThreshold:
      Number.isFinite(value.linkThreshold) && Number(value.linkThreshold) >= 2
        ? Math.min(Math.trunc(Number(value.linkThreshold)), 20)
        : DEFAULT_SPAM_RULES.linkThreshold,
    keywords: Array.isArray(value.keywords)
      ? [...new Set(value.keywords.map((word) => String(word).trim()).filter(Boolean))].slice(
          0,
          50,
        )
      : DEFAULT_SPAM_RULES.keywords,
    shouting: value.shouting !== false,
    repetition: value.repetition !== false,
    moneyPromise: value.moneyPromise !== false,
  };
}

export async function saveSpamRules(input: {
  productId: string;
  rules: ConversationSpamRules;
  now?: Date;
}): Promise<ConversationSpamRules> {
  const rules = normalizeSpamRules(input.rules);
  const now = input.now ?? new Date();

  await db
    .insert(productSupportSettings)
    .values({ productId: input.productId, spamRules: rules, updatedAt: now })
    .onConflictDoUpdate({
      target: productSupportSettings.productId,
      set: { spamRules: rules, updatedAt: now },
    });

  return rules;
}

export async function recordSpamFeedback(input: {
  productId: string;
  conversationId: string;
  reasons: string | null;
  userId: string | null;
  now?: Date;
}): Promise<void> {
  await db.insert(conversationSpamFeedback).values({
    productId: input.productId,
    conversationId: input.conversationId,
    verdict: "false_positive",
    reasons: input.reasons,
    createdBy: input.userId,
    ...(input.now ? { createdAt: input.now } : {}),
  });
}

export type SpamFeedbackRow = {
  id: string;
  conversationId: string;
  reasons: string | null;
  createdAt: string;
};

export async function listSpamFeedback(
  productId: string,
  limit = 20,
): Promise<SpamFeedbackRow[]> {
  const rows = await db
    .select({
      id: conversationSpamFeedback.id,
      conversationId: conversationSpamFeedback.conversationId,
      reasons: conversationSpamFeedback.reasons,
      createdAt: conversationSpamFeedback.createdAt,
    })
    .from(conversationSpamFeedback)
    .where(
      and(
        eq(conversationSpamFeedback.productId, productId),
        eq(conversationSpamFeedback.verdict, "false_positive"),
      ),
    )
    .orderBy(desc(conversationSpamFeedback.createdAt))
    .limit(Math.min(Math.max(limit, 1), 100));

  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
  }));
}
