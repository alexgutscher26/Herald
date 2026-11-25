import "server-only";

import { and, desc, eq, isNull, ne } from "drizzle-orm";

import { db } from "@/db";
import { boardTags, boards } from "@/db/schema/boards";
import { feedbackPosts } from "@/db/schema/feedback";
import { duplicateReviews } from "@/db/schema/feedback-extensions";
import { junoSuggestions, junoSettings } from "@/db/schema/knowledge";
import { mergeFeedbackRequests } from "@/features/feedback/merge";
import { products } from "@/db/schema/workspaces";
import { generateAiText } from "@/features/ai/provider";
import { enqueueJob } from "@/features/jobs/queue";
import { getAiConfig } from "@/lib/env";
import { logEvent, serializeError } from "@/lib/logger";

import { getJunoModelAccess } from "./access";
import { normalizeTagSuggestion } from "./aux-policy";
import { checkBudget, recordAiUsage } from "./budget";
import { cosineSimilarity, embedDocuments } from "./embedding";
import { decideDuplicate, duplicateMatchScore } from "./duplicate-policy";
import { JUNO_PROMPT_VERSION } from "./evaluation";
import { lexicalScore } from "./text";

/**
 * Auxiliary AI: tag suggestions and duplicate hints.
 *
 * Each runs as its own durable job with its own prompt and its own budget
 * check. Suggestions are stored, never applied: a human still decides which
 * tag to keep and whether to merge. The changelog draft stays on its existing
 * release action and plan gate; this module deliberately does not duplicate it.
 */

export type AuxiliaryOutcome = {
  status: "suggested" | "skipped";
  reason?: string;
  tags?: string[];
  matches?: { id: string; title: string; score: number }[];
  autoMerged?: boolean;
  mergeId?: string;
};

export { normalizeTagSuggestion } from "./aux-policy";

export function buildTagPrompt(input: {
  title: string;
  body: string;
  tags: string[];
}): { system: string; prompt: string } {
  return {
    system:
      "You label feedback requests with existing tags. Reply with comma-separated tag names from the list only. Never invent a tag. If none fit, reply NONE.",
    prompt: [
      `Request title:\n${input.title}`,
      `Request body:\n${input.body}`,
      `Available tags: ${input.tags.join(", ")}`,
    ].join("\n\n"),
  };
}

export async function suggestTagsForPost(input: {
  productId: string;
  feedbackPostId: string;
  now?: Date;
  generate?: typeof generateAiText;
}): Promise<AuxiliaryOutcome> {
  const now = input.now ?? new Date();
  const generate = input.generate ?? generateAiText;

  const postRows = await db
    .select({
      id: feedbackPosts.id,
      title: feedbackPosts.title,
      body: feedbackPosts.body,
      boardId: feedbackPosts.boardId,
    })
    .from(feedbackPosts)
    .where(
      and(
        eq(feedbackPosts.id, input.feedbackPostId),
        eq(feedbackPosts.productId, input.productId),
      ),
    )
    .limit(1);
  const post = postRows[0];
  if (!post) return { status: "skipped", reason: "missing" };
  if (!post.boardId) return { status: "skipped", reason: "no_board" };

  const tagRows = await db
    .select({ name: boardTags.name })
    .from(boardTags)
    .where(
      and(eq(boardTags.boardId, post.boardId), eq(boardTags.productId, input.productId)),
    );
  const allowed = tagRows.map((row) => row.name);
  if (allowed.length === 0) return { status: "skipped", reason: "no_tags" };

  const settingsRows = await db
    .select({ enabled: junoSettings.enabled, model: junoSettings.model })
    .from(junoSettings)
    .where(eq(junoSettings.productId, input.productId))
    .limit(1);
  const settings = settingsRows[0];
  if (!settings?.enabled) return { status: "skipped", reason: "disabled" };
  const access = await getJunoModelAccess({
    productId: input.productId,
    selectedModel: settings.model,
  });
  if (!access.allowed) {
    return { status: "skipped", reason: access.reason };
  }

  const budget = await checkBudget({ productId: input.productId, costCents: 1, now });
  if (!budget.allowed) return { status: "skipped", reason: "budget" };

  const prompt = buildTagPrompt({
    title: post.title,
    body: post.body.slice(0, 4_000),
    tags: allowed,
  });
  const raw = await generate({
    system: prompt.system,
    prompt: prompt.prompt,
    temperature: 0.1,
    maxTokens: 80,
  });
  const tags = normalizeTagSuggestion(raw, allowed);
  const model = getAiConfig()?.AI_MODEL ?? null;

  await db.transaction(async (tx) => {
    await tx.insert(junoSuggestions).values({
      productId: input.productId,
      feedbackPostId: post.id,
      kind: "tags",
      payload: { tags },
      model,
      promptVersion: JUNO_PROMPT_VERSION,
      costCents: 1,
      createdAt: now,
    });
    await recordAiUsage(tx, {
      productId: input.productId,
      now,
      costCents: 1,
      dailyLimitCents: budget.limitCents,
    });
  });

  return tags.length === 0
    ? { status: "skipped", reason: "no_match" }
    : { status: "suggested", tags };
}

export async function suggestDuplicatesForPost(input: {
  productId: string;
  feedbackPostId: string;
  now?: Date;
}): Promise<AuxiliaryOutcome> {
  const now = input.now ?? new Date();

  const postRows = await db
    .select({
      id: feedbackPosts.id,
      title: feedbackPosts.title,
      body: feedbackPosts.body,
    })
    .from(feedbackPosts)
    .where(
      and(
        eq(feedbackPosts.id, input.feedbackPostId),
        eq(feedbackPosts.productId, input.productId),
      ),
    )
    .limit(1);
  const post = postRows[0];
  if (!post) return { status: "skipped", reason: "missing" };

  const settingsRows = await db
    .select({
      enabled: junoSettings.enabled,
      duplicateMode: junoSettings.duplicateMode,
    })
    .from(junoSettings)
    .where(eq(junoSettings.productId, input.productId))
    .limit(1);
  const settings = settingsRows[0];
  if (!settings?.enabled || settings.duplicateMode === "off") {
    return { status: "skipped", reason: "disabled" };
  }
  const access = await getJunoModelAccess({
    productId: input.productId,
    selectedModel: null,
  });
  if (!access.allowed) {
    return { status: "skipped", reason: access.reason };
  }

  // Duplicate matching is deterministic and costs nothing, but a zero budget
  // is still a kill switch for all auxiliary AI work.
  const budget = await checkBudget({ productId: input.productId, costCents: 0, now });
  if (!budget.allowed) return { status: "skipped", reason: "budget" };

  const others = await db
    .select({
      id: feedbackPosts.id,
      title: feedbackPosts.title,
      body: feedbackPosts.body,
    })
    .from(feedbackPosts)
    .innerJoin(boards, eq(feedbackPosts.boardId, boards.id))
    .innerJoin(products, eq(feedbackPosts.productId, products.id))
    .where(
      and(
        eq(feedbackPosts.productId, input.productId),
        ne(feedbackPosts.id, post.id),
        eq(products.publicFeedbackEnabled, true),
        eq(boards.visibility, "public"),
        isNull(boards.archivedAt),
        isNull(feedbackPosts.hiddenAt),
        isNull(feedbackPosts.mergedIntoId),
      ),
    )
    .limit(300);

  // A paraphrase can describe the same request without sharing many words. The
  // embedding score is blended in beside the lexical one; provider embeddings
  // make the match semantic, while the local hash fallback stays lexical. The
  // higher of the two drives the existing suggestion/auto-merge policy, so a
  // provider failure degrades to the previous behavior instead of blocking
  // duplicate detection.
  const semantic = new Map<string, number>();
  if (others.length > 0) {
    try {
      const texts = [
        `${post.title}\n${post.body}`.slice(0, 2_000),
        ...others.map((row) => `${row.title}\n${row.body}`.slice(0, 2_000)),
      ];
      const { vectors } = await embedDocuments(texts);
      const base = vectors[0];
      if (base) {
        for (let index = 0; index < others.length; index += 1) {
          const candidate = others[index];
          const vector = vectors[index + 1];
          if (!candidate || !vector) continue;
          semantic.set(
            candidate.id,
            Math.max(0, cosineSimilarity(base, vector)),
          );
        }
      }
    } catch (error) {
      logEvent("warn", "juno.duplicate_embedding_failed", {
        error: serializeError(error),
      });
    }
  }

  const matches = others
    .map((row) => {
      const lexical = lexicalScore(
        `${post.title} ${post.body}`,
        `${row.title} ${row.body}`,
      );
      return {
        id: row.id,
        title: row.title,
        score: duplicateMatchScore(lexical, semantic.get(row.id) ?? 0),
      };
    })
    .filter((row) => row.score >= 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((row) => ({ ...row, score: Number(row.score.toFixed(3)) }));

  await db.transaction(async (tx) => {
    await tx.insert(junoSuggestions).values({
      productId: input.productId,
      feedbackPostId: post.id,
      kind: "duplicates",
      payload: { matches },
      model: null,
      promptVersion: JUNO_PROMPT_VERSION,
      costCents: 0,
      createdAt: now,
    });
    await recordAiUsage(tx, {
      productId: input.productId,
      now,
      costCents: 0,
      dailyLimitCents: budget.limitCents,
    });
  });

  const decision = decideDuplicate({
    mode: settings.duplicateMode,
    matches,
  });

  if (decision.action === "merge") {
    const merged = await mergeFeedbackRequests({
      productId: input.productId,
      sourceId: post.id,
      targetId: decision.match.id,
      userId: null,
      automatic: true,
    });

    if (merged.ok) {
      await db
        .insert(duplicateReviews)
        .values({
          productId: input.productId,
          sourcePostId: post.id,
          targetPostId: decision.match.id,
          score: decision.match.score,
          mode: "automatic",
          status: "merged",
          mergeId: merged.mergeId,
          resolvedAt: now,
          createdAt: now,
        })
        .onConflictDoNothing();

      return {
        status: "suggested",
        matches,
        autoMerged: true,
        mergeId: merged.mergeId,
      };
    }
  }

  if (decision.action !== "none") {
    await db
      .insert(duplicateReviews)
      .values({
        productId: input.productId,
        sourcePostId: post.id,
        targetPostId: decision.match.id,
        score: decision.match.score,
        mode: decision.mode,
        status: "pending",
        createdAt: now,
      })
      .onConflictDoNothing();
  }

  return matches.length === 0
    ? { status: "skipped", reason: "no_match" }
    : { status: "suggested", matches };
}

/** Enqueue both suggestions after a request is created; failures stay silent. */
export async function queuePostSuggestions(input: {
  productId: string;
  feedbackPostId: string;
}): Promise<void> {
  try {
    const settings = await db
      .select({
        enabled: junoSettings.enabled,
        duplicateMode: junoSettings.duplicateMode,
      })
      .from(junoSettings)
      .where(eq(junoSettings.productId, input.productId))
      .limit(1);
    // The helper is useful only when the workspace has opted into AI; a
    // product with Mira off does not get background model calls. Duplicate
    // matching can be switched off independently of tags.
    if (!settings[0]?.enabled) return;

    const jobs = [
      enqueueJob({
        type: "juno_tag_feedback" as const,
        payload: { productId: input.productId, feedbackPostId: input.feedbackPostId },
        dedupeKey: `juno-tags:${input.feedbackPostId}`,
      }),
    ];
    if (settings[0].duplicateMode !== "off") {
      jobs.push(
        enqueueJob({
          type: "juno_duplicate_suggestions" as const,
          payload: { productId: input.productId, feedbackPostId: input.feedbackPostId },
          dedupeKey: `juno-duplicates:${input.feedbackPostId}`,
        }),
      );
    }
    await Promise.all(jobs);
  } catch (error) {
    logEvent("warn", "juno.aux_queue_failed", { error: serializeError(error) });
  }
}

export async function listRecentSuggestions(
  productId: string,
  limit = 8,
): Promise<
  {
    id: string;
    kind: "tags" | "duplicates";
    postId: string;
    postTitle: string;
    payload: Record<string, unknown>;
    createdAt: string;
  }[]
> {
  const rows = await db
    .select({
      id: junoSuggestions.id,
      kind: junoSuggestions.kind,
      postId: junoSuggestions.feedbackPostId,
      postTitle: feedbackPosts.title,
      payload: junoSuggestions.payload,
      createdAt: junoSuggestions.createdAt,
    })
    .from(junoSuggestions)
    .innerJoin(feedbackPosts, eq(junoSuggestions.feedbackPostId, feedbackPosts.id))
    .where(eq(junoSuggestions.productId, productId))
    .orderBy(desc(junoSuggestions.createdAt))
    .limit(Math.min(Math.max(limit, 1), 25));

  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
  }));
}
