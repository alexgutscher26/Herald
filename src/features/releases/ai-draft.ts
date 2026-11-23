import "server-only";

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  boards,
  customers,
  feedbackPosts,
  releaseFeedbackLinks,
  releases,
} from "@/db/schema";
import { tagsForReleases } from "@/db/queries/releases";
import { generateAiText } from "@/features/ai/provider";
import {
  latestPostModerationSql,
  voteCountSql,
} from "@/features/public/queries";
import { slugify } from "@/lib/slug";

import type { AiDraftCandidate } from "./action-types";
import {
  AiDraftFormatError,
  buildAiDraftPrompt,
  buildAiRewritePrompt,
  parseAiDraftResponse,
  type AiDraftContent,
  type AiDraftRequest,
} from "./ai-draft-prompt";
import { preserveInlineImageReferences } from "./inline-images";
import {
  createReleaseDraft,
  updateReleaseDraft,
  type DraftWriteContext,
  type DraftWriteResult,
} from "./draft-service";
import { normalizeReleaseTags } from "./tags";

/**
 * AI changelog drafts.
 *
 * Only shipped requests that already pass the public board, moderation, hidden,
 * merged, archived and banned-author predicates can seed a draft. That avoids
 * asking the model to turn a private or hidden request into public copy. The
 * generated release is always written as a draft; nothing here can publish,
 * schedule, notify or email.
 */

export const MAX_AI_DRAFT_REQUESTS = 12;

function visibilitySql() {
  const latest = latestPostModerationSql();
  const requireApproval = sql<string>`coalesce(${boards.settings} #>> '{moderation,requireApproval}', 'none')`;
  return sql`case when ${requireApproval} = 'none' then ${latest} is distinct from 'rejected' else ${latest} = 'approved' end`;
}

function eligibleWhere(productId: string) {
  return and(
    eq(feedbackPosts.productId, productId),
    eq(feedbackPosts.status, "shipped"),
    eq(boards.visibility, "public"),
    isNull(boards.archivedAt),
    isNull(feedbackPosts.archivedAt),
    isNull(feedbackPosts.hiddenAt),
    isNull(feedbackPosts.mergedIntoId),
    isNull(customers.bannedAt),
    visibilitySql(),
  );
}

export async function listAiDraftCandidates(productId: string): Promise<AiDraftCandidate[]> {
  const rows = await db
    .select({
      id: feedbackPosts.id,
      title: feedbackPosts.title,
      updatedAt: feedbackPosts.updatedAt,
      voteCount: voteCountSql(),
    })
    .from(feedbackPosts)
    .innerJoin(boards, eq(feedbackPosts.boardId, boards.id))
    .leftJoin(customers, eq(feedbackPosts.authorCustomerId, customers.id))
    .where(eligibleWhere(productId))
    .orderBy(desc(feedbackPosts.updatedAt))
    .limit(50);

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    voteCount: row.voteCount,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

async function eligibleAiDraftRequests(
  productId: string,
  feedbackIds: string[],
): Promise<AiDraftRequest[]> {
  if (feedbackIds.length === 0) return [];

  const rows = await db
    .select({
      id: feedbackPosts.id,
      title: feedbackPosts.title,
      body: feedbackPosts.body,
      voteCount: voteCountSql(),
    })
    .from(feedbackPosts)
    .innerJoin(boards, eq(feedbackPosts.boardId, boards.id))
    .leftJoin(customers, eq(feedbackPosts.authorCustomerId, customers.id))
    .where(and(eligibleWhere(productId), inArray(feedbackPosts.id, feedbackIds)))
    .limit(MAX_AI_DRAFT_REQUESTS);

  const byId = new Map(rows.map((row) => [row.id, row]));
  return feedbackIds.flatMap((id) => {
    const row = byId.get(id);
    return row
      ? [{ id: row.id, title: row.title, body: row.body, voteCount: row.voteCount }]
      : [];
  });
}

export async function loadEligibleAiDraftRequests(
  productId: string,
  feedbackIds: string[],
): Promise<AiDraftRequest[]> {
  return eligibleAiDraftRequests(productId, feedbackIds.slice(0, MAX_AI_DRAFT_REQUESTS));
}

export async function loadAiDraftRequests(
  productId: string,
  feedbackIds: string[],
): Promise<AiDraftRequest[] | null> {
  if (feedbackIds.length === 0 || feedbackIds.length > MAX_AI_DRAFT_REQUESTS) return null;

  const requests = await eligibleAiDraftRequests(productId, feedbackIds);
  return requests.length === feedbackIds.length ? requests : null;
}

/**
 * Ask for a JSON draft, sampling once more when the reply is not parseable.
 *
 * The contract is strict on purpose, but a small model occasionally escapes a
 * newline wrongly or runs a string out mid-value. A second sample is much
 * cheaper for the author than a failed click, and the format error still wins
 * if both attempts are unusable.
 */
async function generateDraftContent(prompt: {
  system: string;
  prompt: string;
}): Promise<AiDraftContent> {
  const first = await generateAiText({
    ...prompt,
    responseFormat: "json",
    temperature: 0.2,
  });
  try {
    return parseAiDraftResponse(first);
  } catch (error) {
    if (!(error instanceof AiDraftFormatError)) throw error;
  }

  const second = await generateAiText({
    ...prompt,
    responseFormat: "json",
    temperature: 0.1,
  });
  return parseAiDraftResponse(second);
}

export async function generateAiDraftContent(input: {
  productName: string;
  productDescription: string;
  focus: string;
  requests: AiDraftRequest[];
}): Promise<AiDraftContent> {
  const parsed = await generateDraftContent(buildAiDraftPrompt(input));

  return {
    ...parsed,
    tags: normalizeReleaseTags(parsed.tags).map((tag) => tag.name),
  };
}

export async function generateAiRewriteContent(input: {
  productName: string;
  productDescription: string;
  focus: string;
  draft: AiDraftContent;
  requests: AiDraftRequest[];
}): Promise<AiDraftContent> {
  const parsed = await generateDraftContent(buildAiRewritePrompt(input));

  return {
    ...parsed,
    body: preserveInlineImageReferences(input.draft.body, parsed.body),
    tags: normalizeReleaseTags(parsed.tags).map((tag) => tag.name),
  };
}

/** A draft title can collide; append a counter rather than failing generation. */
async function uniqueDraftSlug(productId: string, title: string): Promise<string> {
  const base = (slugify(title) || "release").slice(0, 40);
  const normalized = base.length >= 3 ? base : `release-${base}`;

  const rows = await db
    .select({ slug: releases.slug })
    .from(releases)
    .where(eq(releases.productId, productId));
  const taken = new Set(rows.map((row) => row.slug));

  if (!taken.has(normalized)) return normalized;
  for (let counter = 2; counter < 1_000; counter += 1) {
    const candidate = `${normalized.slice(0, 43)}-${counter}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${normalized.slice(0, 39)}-${Date.now().toString(36)}`.slice(0, 48);
}

export async function createAiDraft(
  context: DraftWriteContext & {
    productName: string;
    productDescription: string;
  },
  input: { feedbackIds: string[]; focus: string },
): Promise<DraftWriteResult> {
  const requests = await loadAiDraftRequests(context.productId, input.feedbackIds);
  if (!requests) {
    return {
      ok: false,
      status: 400,
      error: "Choose shipped requests from this product.",
    };
  }

  const content = await generateAiDraftContent({
    productName: context.productName,
    productDescription: context.productDescription,
    focus: input.focus,
    requests,
  });
  const slug = await uniqueDraftSlug(context.productId, content.title);

  return createReleaseDraft(context, {
    title: content.title,
    slug,
    summary: content.summary,
    body: content.body,
    category: content.category,
    tags: content.tags,
    authorIds: [context.userId],
    linkedFeedbackIds: input.feedbackIds,
  });
}

export type AiDraftRewriteResult =
  | { ok: true; releaseId: string; content: AiDraftContent }
  | Extract<DraftWriteResult, { ok: false }>;

/**
 * Rewrite an existing draft in place.
 *
 * Only a draft can be rewritten: publishing, scheduling and archived entries
 * stay outside this authoring path. The slug, authors, channels, cover and
 * links are preserved; only title, summary, body, category and tags change.
 */
export async function rewriteAiDraft(
  context: DraftWriteContext & {
    productName: string;
    productDescription: string;
  },
  input: { releaseId: string; focus: string },
): Promise<AiDraftRewriteResult> {
  const rows = await db
    .select({
      id: releases.id,
      title: releases.title,
      summary: releases.summary,
      bodyMarkdown: releases.bodyMarkdown,
      category: releases.category,
      status: releases.status,
    })
    .from(releases)
    .where(
      and(
        eq(releases.id, input.releaseId),
        eq(releases.productId, context.productId),
      ),
    )
    .limit(1);
  const existing = rows[0];
  if (!existing) {
    return { ok: false, status: 404, error: "Release not found." };
  }
  if (existing.status !== "draft") {
    return {
      ok: false,
      status: 409,
      error: "Only a draft can be rewritten with AI. Save changes as a draft first.",
    };
  }

  const [tagMap, linkRows] = await Promise.all([
    tagsForReleases([existing.id]),
    db
      .select({ id: releaseFeedbackLinks.feedbackPostId })
      .from(releaseFeedbackLinks)
      .where(eq(releaseFeedbackLinks.releaseId, existing.id))
      .limit(MAX_AI_DRAFT_REQUESTS),
  ]);
  const linkedIds = linkRows.map((row) => row.id);
  const linkedRequests = await loadEligibleAiDraftRequests(context.productId, linkedIds);

  const content = await generateAiRewriteContent({
    productName: context.productName,
    productDescription: context.productDescription,
    focus: input.focus,
    draft: {
      title: existing.title,
      summary: existing.summary ?? "",
      body: existing.bodyMarkdown ?? "",
      category: existing.category as AiDraftContent["category"],
      tags: tagMap.get(existing.id) ?? [],
    },
    requests: linkedRequests,
  });

  const updated = await updateReleaseDraft(context, existing.id, {
    title: content.title,
    summary: content.summary,
    body: content.body,
    category: content.category,
    tags: content.tags,
  });
  if (!updated.ok) return updated;

  return { ok: true, releaseId: updated.releaseId, content };
}
