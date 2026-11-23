import "server-only";

import { cache } from "react";

import { and, asc, count, desc, eq, ilike, inArray, isNull, ne, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { listActiveCustomFields } from "@/db/queries/custom-fields";
import { listIntakeQuestions } from "@/features/conversations/support-settings";
import { publicSurfaceEnabled } from "@/features/entitlements/entitlements";
import { hasFeature, toPlanId } from "@/features/entitlements/plans";
import { getCustomerIdentityMasking } from "@/features/customer-auth/identity-settings";
import { createSignedStorageUrl } from "@/features/storage/urls";
import {
  apiDocVersions,
  apiDocs,
  boardTags,
  boards,
  customers,
  feedbackAttachments,
  feedbackComments,
  feedbackCustomerVotes,
  feedbackFollowers,
  feedbackInsights,
  feedbackPosts,
  feedbackReactions,
  feedbackTagLinks,
  feedbackVotes,
  helpArticles,
  helpCollections,
  moderationReviews,
  products,
  releaseFeedbackLinks,
  releases,
  workspaces,
} from "@/db/schema";

import { pageOffset, paginationMeta } from "@/lib/pagination";
import { summarizeRequestDemand } from "@/lib/request-demand";

import { escapeLikePattern, parsePublicBoardQuery, type PublicBoardQuery } from "./query";
import { resolvePublicBoard } from "./resolver";
import { submissionAssistantAvailable } from "./rewrite";
import {
  isPublicCommentVisible,
  isPubliclyVisible,
  toPublicComment,
  toPublicRequestSummary,
  toPublicStatus,
  type ModerationStatus,
  type PublicRequestSource,
} from "./serialize";
import { commentPrivacySql, postPrivacySql } from "./privacy";
import {
  DETAIL_SIMILAR_LIMIT,
  DETAIL_SIMILAR_MIN_SCORE,
  excerpt,
  rankSimilar,
  tokenize,
} from "./similarity";
import type {
  PublicBoard,
  PublicBoardPage,
  PublicBoardSummary,
  PublicLinkedRelease,
  PublicLinkedRequest,
  PublicReaction,
  PublicReactionKind,
  PublicRequestDetail,
  PublicRequestPage,
  PublicSubmitPage,
  PublicSuggestion,
  PublicTag,
} from "./types";

/**
 * Public read projections.
 *
 * Every query starts from the resolved board and filters by it, so a guessed
 * request id from another product simply does not match. Internal comments,
 * archived and merged requests, banned authors and rejected moderation
 * decisions never reach the serializer.
 *
 * Pagination and filtering happen in SQL rather than after the fact: a page
 * that dropped rows in JavaScript would return fewer than its page size while
 * claiming there were more, and the total would be wrong.
 */

export const REACTION_KINDS: readonly PublicReactionKind[] = ["like", "love", "celebrate"];

/** A visitor resolved from the customer session cookie, when one is valid. */
export type PublicViewer = {
  customerId: string;
  workspaceId: string;
  identified: boolean;
  /** Resolved from live company memberships when the session is created. */
  hasCompany: boolean;
};

/**
 * The newest moderation decision for a post, as a correlated subquery.
 *
 * Used in WHERE rather than fetched afterwards so approval state affects which
 * rows are counted and paginated, not only what the page renders.
 */
export function latestPostModerationSql() {
  return sql<string | null>`(
    SELECT mr.status::text
    FROM moderation_reviews mr
    WHERE mr.content_type = 'feedback_post'
      AND mr.content_id = ${feedbackPosts.id}
    ORDER BY mr.created_at DESC
    LIMIT 1
  )`;
}

function postVisibilitySql(requireApproval: "none" | "first_time" | "all") {
  const latest = latestPostModerationSql();
  // A rejected post is hidden everywhere. When approval is required, only an
  // explicitly approved post is visible; `first_time` is treated like `all`
  // until author history exists, which is the safe direction.
  if (requireApproval === "none") {
    return sql`${latest} IS DISTINCT FROM 'rejected'`;
  }
  return sql`${latest} = 'approved'`;
}

/**
 * Public vote total: team votes plus customer votes.
 *
 * The two tables are separate because a dashboard user and a public customer
 * are different principals; the public number is their sum, so a customer vote
 * is never silently ignored and never counted twice.
 */
export function voteCountSql() {
  return sql<number>`(
    ${feedbackPosts.importedVoteCount}
    + (
      SELECT count(*)::int FROM feedback_votes fv
      WHERE fv.feedback_post_id = ${feedbackPosts.id}
    )
    + (
      SELECT count(*)::int FROM feedback_customer_votes fcv
      WHERE fcv.feedback_post_id = ${feedbackPosts.id}
    )
  )`;
}

/**
 * Recent engagement, used by the Trending sort.
 *
 * Votes count three points and visible comments two, measured over the last
 * seven days. Older popularity still shows up under Top; Trending is about
 * velocity, so a long-lived but quiet request does not lead it forever.
 */
function trendingScoreSql() {
  return sql<number>`(
    (
      SELECT (count(*) * 3)::int FROM (
        SELECT fv.id FROM feedback_votes fv
        WHERE fv.feedback_post_id = ${feedbackPosts.id}
          AND fv.created_at >= now() - interval '7 days'
        UNION ALL
        SELECT fcv.id FROM feedback_customer_votes fcv
        WHERE fcv.feedback_post_id = ${feedbackPosts.id}
          AND fcv.created_at >= now() - interval '7 days'
      ) recent_votes
    )
    + (
      SELECT (count(*) * 2)::int FROM feedback_comments fc
      WHERE fc.feedback_post_id = ${feedbackPosts.id}
        AND fc.internal = false
        AND fc.privacy = 'public'
        AND fc.created_at >= now() - interval '7 days'
    )
  )`;
}

function tagFilterSql(boardId: string, tag: string) {
  return sql`EXISTS (
    SELECT 1
    FROM feedback_tag_links ftl
    INNER JOIN board_tags bt ON bt.id = ftl.tag_id
    WHERE ftl.feedback_post_id = ${feedbackPosts.id}
      AND bt.board_id = ${boardId}
      AND bt.name = ${tag}
  )`;
}

async function latestModeration(
  contentType: "feedback_post" | "feedback_comment",
  ids: string[],
): Promise<Map<string, ModerationStatus>> {
  if (ids.length === 0) return new Map();

  const rows = await db
    .select({
      contentId: moderationReviews.contentId,
      status: moderationReviews.status,
      createdAt: moderationReviews.createdAt,
    })
    .from(moderationReviews)
    .where(
      and(
        eq(moderationReviews.contentType, contentType),
        inArray(moderationReviews.contentId, ids),
      ),
    )
    .orderBy(asc(moderationReviews.createdAt));

  // Later rows overwrite earlier ones, so the map holds the newest decision.
  const latest = new Map<string, ModerationStatus>();
  for (const row of rows) latest.set(row.contentId, row.status);
  return latest;
}

async function tagsForPosts(postIds: string[]): Promise<Map<string, PublicTag[]>> {
  const tags = new Map<string, PublicTag[]>();
  if (postIds.length === 0) return tags;

  const rows = await db
    .select({
      postId: feedbackTagLinks.feedbackPostId,
      name: boardTags.name,
      color: boardTags.color,
    })
    .from(feedbackTagLinks)
    .innerJoin(boardTags, eq(feedbackTagLinks.tagId, boardTags.id))
    .where(inArray(feedbackTagLinks.feedbackPostId, postIds))
    .orderBy(asc(boardTags.position), asc(boardTags.name));

  for (const row of rows) {
    const list = tags.get(row.postId) ?? [];
    list.push({ name: row.name, color: row.color });
    tags.set(row.postId, list);
  }
  return tags;
}

async function voteCounts(postIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (postIds.length === 0) return counts;

  const [teamRows, customerRows, importedRows] = await Promise.all([
    db
      .select({
        postId: feedbackVotes.feedbackPostId,
        count: sql<number>`count(*)::int`,
      })
      .from(feedbackVotes)
      .where(inArray(feedbackVotes.feedbackPostId, postIds))
      .groupBy(feedbackVotes.feedbackPostId),
    db
      .select({
        postId: feedbackCustomerVotes.feedbackPostId,
        count: sql<number>`count(*)::int`,
      })
      .from(feedbackCustomerVotes)
      .where(inArray(feedbackCustomerVotes.feedbackPostId, postIds))
      .groupBy(feedbackCustomerVotes.feedbackPostId),
    db
      .select({
        postId: feedbackPosts.id,
        count: feedbackPosts.importedVoteCount,
      })
      .from(feedbackPosts)
      .where(inArray(feedbackPosts.id, postIds)),
  ]);

  for (const row of [...teamRows, ...customerRows, ...importedRows]) {
    counts.set(row.postId, (counts.get(row.postId) ?? 0) + row.count);
  }
  return counts;
}

/**
 * Count only comments that the board would actually show. A moderated board's
 * rejected and pending comments must not inflate the card count.
 */
async function visibleCommentCounts(
  postIds: string[],
  policy: "open" | "moderated" | "closed",
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (postIds.length === 0) return counts;

  const rows = await db
    .select({ id: feedbackComments.id, postId: feedbackComments.feedbackPostId })
    .from(feedbackComments)
    .leftJoin(customers, eq(feedbackComments.authorCustomerId, customers.id))
    .where(
      and(
        inArray(feedbackComments.feedbackPostId, postIds),
        eq(feedbackComments.internal, false),
        // Listing counts show the public conversation, never a private reply.
        eq(feedbackComments.privacy, "public"),
        // A banned author's comments disappear with their requests.
        isNull(customers.bannedAt),
      ),
    );

  const reviews = await latestModeration(
    "feedback_comment",
    rows.map((row) => row.id),
  );

  for (const row of rows) {
    if (isPublicCommentVisible(policy, reviews.get(row.id) ?? null)) {
      counts.set(row.postId, (counts.get(row.postId) ?? 0) + 1);
    }
  }
  return counts;
}

function toPublicBoard(tenant: {
  board: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    guestPosting: boolean;
    icon: string | null;
    color: string | null;
    settings: { moderation: { requireApproval: "none" | "first_time" | "all"; comments: "open" | "moderated" | "closed" } };
  };
}): PublicBoard {
  return {
    id: tenant.board.id,
    name: tenant.board.name,
    slug: tenant.board.slug,
    description: tenant.board.description,
    guestPosting: tenant.board.guestPosting,
    acceptsComments: tenant.board.settings.moderation.comments !== "closed",
    requiresApproval: tenant.board.settings.moderation.requireApproval !== "none",
    icon: tenant.board.icon,
    color: tenant.board.color,
  };
}

function requestSource(input: {
  row: {
    id: string;
    title: string;
    body: string;
    status: string;
    category: string;
    authorLabel: string | null;
    customerName: string | null;
    customerBannedAt: Date | null;
    privacy: string;
    createdAt: Date;
    updatedAt: Date;
  };
  tags: PublicTag[];
  voteCount: number;
  commentCount: number;
  latestModeration: ModerationStatus | null;
}): PublicRequestSource {
  return {
    id: input.row.id,
    title: input.row.title,
    body: input.row.body,
    status: input.row.status,
    category: input.row.category,
    authorLabel: input.row.authorLabel,
    customerName: input.row.customerName,
    customerBannedAt: input.row.customerBannedAt,
    privacy: input.row.privacy,
    createdAt: input.row.createdAt,
    updatedAt: input.row.updatedAt,
    tags: input.tags,
    voteCount: input.voteCount,
    commentCount: input.commentCount,
    latestModeration: input.latestModeration,
  };
}

/** Public boards of the same product, for the board switcher. */
async function listPublicBoards(productId: string): Promise<PublicBoardSummary[]> {
  return db
    .select({
      name: boards.name,
      slug: boards.slug,
      description: boards.description,
    })
    .from(boards)
    .where(
      and(
        eq(boards.productId, productId),
        eq(boards.visibility, "public"),
        isNull(boards.archivedAt),
      ),
    )
    .orderBy(asc(boards.position), asc(boards.name));
}

/** Tags configured on this board, for the tag filter. */
async function listBoardTags(boardId: string): Promise<PublicTag[]> {
  return db
    .select({ name: boardTags.name, color: boardTags.color })
    .from(boardTags)
    .where(eq(boardTags.boardId, boardId))
    .orderBy(asc(boardTags.position), asc(boardTags.name));
}

export async function getPublicBoardPage(
  input: {
    workspaceSlug: string;
    productSlug: string;
    boardSlug: string;
    /** Visitor whose segments gate the board; omitted means anonymous. */
    viewerCustomerId?: string | null;
  },
  query: PublicBoardQuery = parsePublicBoardQuery({}),
): Promise<PublicBoardPage | null> {
  const tenant = await resolvePublicBoard(input);
  if (!tenant) return null;
  if (!publicSurfaceEnabled(tenant.workspace.plan)) return null;

  const advancedSearch = hasFeature(tenant.workspace.plan, "advancedSearch");
  const maskIdentity =
    hasFeature(tenant.workspace.plan, "identityMasking") &&
    (await getCustomerIdentityMasking(tenant.workspace.id));

  const searchPattern =
    query.search === "" ? null : `%${escapeLikePattern(query.search)}%`;

  const where = and(
    eq(feedbackPosts.boardId, tenant.board.id),
    eq(feedbackPosts.productId, tenant.product.id),
    isNull(feedbackPosts.archivedAt),
    isNull(feedbackPosts.hiddenAt),
    isNull(feedbackPosts.mergedIntoId),
    isNull(customers.bannedAt),
    postPrivacySql(input.viewerCustomerId ?? null),
    postVisibilitySql(tenant.board.settings.moderation.requireApproval),
    query.status === null ? undefined : eq(feedbackPosts.status, query.status),
    searchPattern === null
      ? undefined
      : advancedSearch
        ? or(
            ilike(feedbackPosts.title, searchPattern),
            ilike(feedbackPosts.body, searchPattern),
          )
        : ilike(feedbackPosts.title, searchPattern),
    query.tag === null ? undefined : tagFilterSql(tenant.board.id, query.tag),
  );

  const totalRows = await db
    .select({ value: count() })
    .from(feedbackPosts)
    .leftJoin(customers, eq(feedbackPosts.authorCustomerId, customers.id))
    .where(where);

  const total = totalRows[0]?.value ?? 0;
  const pagination = paginationMeta({
    page: query.page,
    pageSize: query.pageSize,
    total,
  });

  const orderBy =
    query.sort === "top"
      ? [desc(voteCountSql()), desc(feedbackPosts.createdAt)]
      : query.sort === "trending"
        ? [desc(trendingScoreSql()), desc(feedbackPosts.createdAt)]
        : [desc(feedbackPosts.createdAt)];

  const [rows, boardLinks, tags] = await Promise.all([
    db
      .select({
        id: feedbackPosts.id,
        title: feedbackPosts.title,
        body: feedbackPosts.body,
        status: feedbackPosts.status,
        category: feedbackPosts.category,
        privacy: feedbackPosts.privacy,
        authorLabel: feedbackPosts.authorLabel,
        createdAt: feedbackPosts.createdAt,
        updatedAt: feedbackPosts.updatedAt,
        customerName: customers.name,
        customerBannedAt: customers.bannedAt,
        voteCount: voteCountSql(),
      })
      .from(feedbackPosts)
      .leftJoin(customers, eq(feedbackPosts.authorCustomerId, customers.id))
      .where(where)
      .orderBy(...orderBy)
      .limit(pagination.pageSize)
      .offset(pageOffset(pagination.page, pagination.pageSize)),
    listPublicBoards(tenant.product.id),
    listBoardTags(tenant.board.id),
  ]);

  const ids = rows.map((row) => row.id);
  const [postTags, votes, comments, reviews] = await Promise.all([
    tagsForPosts(ids),
    voteCounts(ids),
    visibleCommentCounts(ids, tenant.board.settings.moderation.comments),
    latestModeration("feedback_post", ids),
  ]);

  const requests = rows
    .filter((row) => row.customerBannedAt === null)
    .map((row) =>
      requestSource({
        row: maskIdentity
          ? { ...row, customerName: row.customerName ? "A customer" : null }
          : row,
        tags: postTags.get(row.id) ?? [],
        // The correlated count and the grouped count must agree; the grouped
        // one is authoritative after the page is narrowed to a handful of ids.
        voteCount: votes.get(row.id) ?? row.voteCount,
        commentCount: comments.get(row.id) ?? 0,
        latestModeration: reviews.get(row.id) ?? null,
      }),
    )
    .filter((request) =>
      isPubliclyVisible(
        tenant.board.settings.moderation.requireApproval,
        request.latestModeration,
      ),
    )
    .map(toPublicRequestSummary);

  return {
    workspace: { id: tenant.workspace.id, name: tenant.workspace.name, slug: tenant.workspace.slug },
    product: { id: tenant.product.id, name: tenant.product.name, slug: tenant.product.slug },
    board: toPublicBoard(tenant),
    requests,
    boards: boardLinks,
    tags,
    pagination,
    roadmapEnabled: tenant.product.publicRoadmapEnabled,
    changelogEnabled: tenant.product.publicChangelogEnabled,
  };
}

/**
 * Request-scoped cache for the board projection.
 *
 * `generateMetadata` and the page body both need the same board. Without this,
 * one navigation runs every board query twice. `cache` is scoped to the React
 * request, so a moderation change still takes effect on the next request.
 */
const getCachedPublicBoardPage = cache(
  (
    workspaceSlug: string,
    productSlug: string,
    boardSlug: string,
    queryKey: string,
  ): Promise<PublicBoardPage | null> =>
    getPublicBoardPage(
      { workspaceSlug, productSlug, boardSlug },
      JSON.parse(queryKey) as PublicBoardQuery,
    ),
);

export function getPublicBoardPageForRequest(
  input: { workspaceSlug: string; productSlug: string; boardSlug: string },
  query: PublicBoardQuery,
  viewerCustomerId: string | null = null,
): Promise<PublicBoardPage | null> {
  // A segment-gated board depends on who is asking, so its page must never come
  // from the shared anonymous cache. Signed-out visitors still do, and their
  // cached answer is "not found" for any gated board.
  if (viewerCustomerId) {
    return getPublicBoardPage({ ...input, viewerCustomerId }, query);
  }
  return getCachedPublicBoardPage(
    input.workspaceSlug,
    input.productSlug,
    input.boardSlug,
    JSON.stringify(query),
  );
}

/**
 * Requests merged into this one.
 *
 * They can live on another board of the same product, so each row carries its
 * board slug and its own approval setting; a pending duplicate stays hidden.
 */
async function mergedRequestsFor(
  tenant: { product: { id: string } },
  postId: string,
): Promise<PublicLinkedRequest[]> {
  const rows = await db
    .select({
      id: feedbackPosts.id,
      title: feedbackPosts.title,
      status: feedbackPosts.status,
      boardSlug: boards.slug,
      settings: boards.settings,
      customerBannedAt: customers.bannedAt,
      voteCount: voteCountSql(),
    })
    .from(feedbackPosts)
    .innerJoin(boards, eq(feedbackPosts.boardId, boards.id))
    .leftJoin(customers, eq(feedbackPosts.authorCustomerId, customers.id))
    .where(
      and(
        eq(feedbackPosts.mergedIntoId, postId),
        eq(feedbackPosts.productId, tenant.product.id),
        eq(boards.visibility, "public"),
        eq(feedbackPosts.privacy, "public"),
        isNull(boards.archivedAt),
        isNull(feedbackPosts.archivedAt),
        isNull(feedbackPosts.hiddenAt),
        isNull(customers.bannedAt),
      ),
    )
    .orderBy(desc(feedbackPosts.createdAt))
    .limit(20);

  if (rows.length === 0) return [];

  const reviews = await latestModeration(
    "feedback_post",
    rows.map((row) => row.id),
  );

  return rows
    .filter((row) =>
      isPubliclyVisible(
        row.settings.moderation.requireApproval,
        reviews.get(row.id) ?? null,
      ),
    )
    .map((row) => ({
      id: row.id,
      title: row.title,
      status: toPublicStatus(row.status),
      voteCount: row.voteCount,
      boardSlug: row.boardSlug,
    }));
}

/** Published releases that cite this request. */
async function linkedReleasesFor(postId: string): Promise<PublicLinkedRelease[]> {
  const rows = await db
    .select({
      id: releases.id,
      title: releases.title,
      slug: releases.slug,
      publishedAt: releases.publishedAt,
    })
    .from(releaseFeedbackLinks)
    .innerJoin(releases, eq(releaseFeedbackLinks.releaseId, releases.id))
    .where(
      and(
        eq(releaseFeedbackLinks.feedbackPostId, postId),
        eq(releases.status, "published"),
        eq(releases.channelPublicChangelog, true),
      ),
    )
    .orderBy(desc(releases.publishedAt))
    .limit(5);

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    slug: row.slug,
    publishedAt: row.publishedAt?.toISOString() ?? null,
  }));
}

/**
 * Other visible requests on the same board that read like this one.
 *
 * Candidates are narrowed in SQL (visible, not merged or archived) and scored
 * by word overlap here. The bounded candidate set keeps this a page-sized
 * read rather than a table scan with per-row string work.
 */
async function similarRequestsFor(input: {
  tenant: {
    board: {
      id: string;
      slug: string;
      settings: { moderation: { requireApproval: "none" | "first_time" | "all" } };
    };
  };
  post: { id: string; title: string; body: string };
}): Promise<PublicLinkedRequest[]> {
  const candidates = await db
    .select({
      id: feedbackPosts.id,
      title: feedbackPosts.title,
      body: feedbackPosts.body,
      status: feedbackPosts.status,
      voteCount: voteCountSql(),
    })
    .from(feedbackPosts)
    .leftJoin(customers, eq(feedbackPosts.authorCustomerId, customers.id))
    .where(
      and(
        eq(feedbackPosts.boardId, input.tenant.board.id),
        isNull(feedbackPosts.archivedAt),
        isNull(feedbackPosts.hiddenAt),
        isNull(feedbackPosts.mergedIntoId),
        isNull(customers.bannedAt),
        eq(feedbackPosts.privacy, "public"),
        ne(feedbackPosts.id, input.post.id),
        postVisibilitySql(input.tenant.board.settings.moderation.requireApproval),
      ),
    )
    .orderBy(desc(feedbackPosts.createdAt))
    .limit(200);

  return rankSimilar(
    { title: input.post.title, body: input.post.body },
    candidates,
    {
      limit: DETAIL_SIMILAR_LIMIT,
      minScore: DETAIL_SIMILAR_MIN_SCORE,
      excludeIds: [input.post.id],
    },
  ).map((candidate) => ({
    id: candidate.id,
    title: candidate.title,
    status: toPublicStatus(candidate.status),
    voteCount: candidate.voteCount,
    boardSlug: input.tenant.board.slug,
  }));
}

/**
 * The canonical request a merged duplicate now points at.
 *
 * Merged requests are excluded from every public projection, but a shared or
 * indexed old link should not dead-end: when the duplicate is still in the
 * same board and its canonical request is publicly readable, the detail page
 * permanently redirects there. Hidden, archived and foreign requests are left
 * to the normal 404 so the redirect never discloses them.
 */
export async function getMergedRequestCanonicalId(input: {
  workspaceSlug: string;
  productSlug: string;
  boardSlug: string;
  requestId: string;
}): Promise<string | null> {
  const tenant = await resolvePublicBoard(input);
  if (!tenant) return null;
  if (!publicSurfaceEnabled(tenant.workspace.plan)) return null;

  const rows = await db
    .select({ mergedIntoId: feedbackPosts.mergedIntoId })
    .from(feedbackPosts)
    .where(
      and(
        eq(feedbackPosts.id, input.requestId),
        eq(feedbackPosts.boardId, tenant.board.id),
        eq(feedbackPosts.productId, tenant.product.id),
        eq(feedbackPosts.privacy, "public"),
        isNull(feedbackPosts.archivedAt),
        isNull(feedbackPosts.hiddenAt),
      ),
    )
    .limit(1);

  const mergedIntoId = rows[0]?.mergedIntoId ?? null;
  if (!mergedIntoId) return null;

  const canonical = await getPublicRequestPage(
    { ...input, requestId: mergedIntoId },
    null,
  );
  return canonical ? mergedIntoId : null;
}

export type PublicSitemapEntry =
  | {
      kind: "board";
      workspaceSlug: string;
      productSlug: string;
      boardSlug: string;
      lastModified: Date;
    }
  | {
      kind: "roadmap";
      workspaceSlug: string;
      productSlug: string;
      lastModified: Date;
    }
  | {
      kind: "changelog";
      workspaceSlug: string;
      productSlug: string;
      lastModified: Date;
    }
  | {
      kind: "changelog_entry";
      workspaceSlug: string;
      productSlug: string;
      slug: string;
      lastModified: Date;
    }
  | {
      kind: "request";
      workspaceSlug: string;
      productSlug: string;
      boardSlug: string;
      requestId: string;
      lastModified: Date;
    }
  | {
      kind: "help";
      workspaceSlug: string;
      productSlug: string;
      lastModified: Date;
    }
  | {
      kind: "help_collection";
      workspaceSlug: string;
      productSlug: string;
      collectionSlug: string;
      lastModified: Date;
    }
  | {
      kind: "help_article";
      workspaceSlug: string;
      productSlug: string;
      collectionSlug: string;
      articleSlug: string;
      lastModified: Date;
    }
  | {
      kind: "api_docs";
      workspaceSlug: string;
      productSlug: string;
      lastModified: Date;
    }
  | {
      kind: "api_doc";
      workspaceSlug: string;
      productSlug: string;
      docSlug: string;
      lastModified: Date;
    };

/**
 * Every URL a crawler may index: public, non-archived boards whose workspace
 * still has the public surface, plus the requests visible on those boards.
 *
 * The predicates intentionally mirror the public projections rather than
 * trusting them afterwards: a sitemap that listed a hidden, merged or
 * unapproved request would leak its existence even though its page 404s.
 */
export async function listPublicSitemapEntries(): Promise<PublicSitemapEntry[]> {
  const [
    boardRows,
    roadmapRows,
    changelogProductRows,
    changelogEntryRows,
    helpCollectionRows,
    helpArticleRows,
    apiDocRows,
  ] = await Promise.all([
    db
      .select({
        boardId: boards.id,
        boardSlug: boards.slug,
        boardUpdatedAt: boards.updatedAt,
        productSlug: products.slug,
        workspaceSlug: workspaces.slug,
        plan: workspaces.plan,
      })
      .from(boards)
      .innerJoin(products, eq(boards.productId, products.id))
      .innerJoin(workspaces, eq(products.workspaceId, workspaces.id))
      .where(
        and(
          eq(products.publicFeedbackEnabled, true),
          eq(boards.visibility, "public"),
          isNull(boards.archivedAt),
          // A crawler is anonymous. A segment-gated board must not appear in
          // the sitemap even though a signed-in customer may see it.
          sql`NOT EXISTS (
            SELECT 1 FROM board_access_rules bar
            WHERE bar.board_id = ${boards.id}
          )`,
        ),
      )
      .orderBy(asc(workspaces.slug), asc(products.slug), asc(boards.position)),
    db
      .select({
        productSlug: products.slug,
        workspaceSlug: workspaces.slug,
        plan: workspaces.plan,
        updatedAt: products.updatedAt,
      })
      .from(products)
      .innerJoin(workspaces, eq(products.workspaceId, workspaces.id))
      .where(eq(products.publicRoadmapEnabled, true))
      .orderBy(asc(workspaces.slug), asc(products.slug)),
    db
      .select({
        productSlug: products.slug,
        workspaceSlug: workspaces.slug,
        plan: workspaces.plan,
        updatedAt: products.updatedAt,
      })
      .from(products)
      .innerJoin(workspaces, eq(products.workspaceId, workspaces.id))
      .where(eq(products.publicChangelogEnabled, true))
      .orderBy(asc(workspaces.slug), asc(products.slug)),
    db
      .select({
        slug: releases.slug,
        updatedAt: releases.updatedAt,
        productSlug: products.slug,
        workspaceSlug: workspaces.slug,
        plan: workspaces.plan,
      })
      .from(releases)
      .innerJoin(products, eq(releases.productId, products.id))
      .innerJoin(workspaces, eq(products.workspaceId, workspaces.id))
      .where(
        and(
          eq(products.publicChangelogEnabled, true),
          eq(releases.status, "published"),
          eq(releases.channelPublicChangelog, true),
        ),
      )
      .orderBy(desc(releases.publishedAt)),
    db
      .select({
        collectionSlug: helpCollections.slug,
        updatedAt: helpCollections.updatedAt,
        productSlug: products.slug,
        workspaceSlug: workspaces.slug,
        plan: workspaces.plan,
      })
      .from(helpCollections)
      .innerJoin(products, eq(helpCollections.productId, products.id))
      .innerJoin(workspaces, eq(products.workspaceId, workspaces.id))
      .where(
        and(
          eq(helpCollections.visibility, "public"),
          or(
            eq(products.publicFeedbackEnabled, true),
            eq(products.publicRoadmapEnabled, true),
            eq(products.publicChangelogEnabled, true),
          ),
        ),
      )
      .orderBy(asc(workspaces.slug), asc(products.slug), asc(helpCollections.name)),
    db
      .select({
        articleSlug: helpArticles.slug,
        collectionSlug: helpCollections.slug,
        updatedAt: helpArticles.updatedAt,
        productSlug: products.slug,
        workspaceSlug: workspaces.slug,
        plan: workspaces.plan,
      })
      .from(helpArticles)
      .innerJoin(helpCollections, eq(helpArticles.collectionId, helpCollections.id))
      .innerJoin(products, eq(helpArticles.productId, products.id))
      .innerJoin(workspaces, eq(products.workspaceId, workspaces.id))
      .where(
        and(
          eq(helpArticles.status, "published"),
          eq(helpArticles.visibility, "public"),
          eq(helpCollections.visibility, "public"),
          or(
            eq(products.publicFeedbackEnabled, true),
            eq(products.publicRoadmapEnabled, true),
            eq(products.publicChangelogEnabled, true),
          ),
        ),
      )
      .orderBy(asc(workspaces.slug), asc(products.slug), asc(helpArticles.title)),
    db
      .select({
        docSlug: apiDocs.slug,
        updatedAt: apiDocs.updatedAt,
        productSlug: products.slug,
        workspaceSlug: workspaces.slug,
        plan: workspaces.plan,
      })
      .from(apiDocs)
      .innerJoin(
        apiDocVersions,
        and(eq(apiDocVersions.apiDocId, apiDocs.id), eq(apiDocVersions.status, "live")),
      )
      .innerJoin(products, eq(apiDocs.productId, products.id))
      .innerJoin(workspaces, eq(products.workspaceId, workspaces.id))
      .where(
        or(
          eq(products.publicFeedbackEnabled, true),
          eq(products.publicRoadmapEnabled, true),
          eq(products.publicChangelogEnabled, true),
        ),
      )
      .orderBy(asc(workspaces.slug), asc(products.slug), asc(apiDocs.name)),
  ]);

  const visibleBoards = boardRows.filter((row) =>
    publicSurfaceEnabled(toPlanId(row.plan)),
  );
  const entries: PublicSitemapEntry[] = roadmapRows
    .filter((row) => publicSurfaceEnabled(toPlanId(row.plan)))
    .map((row) => ({
      kind: "roadmap",
      workspaceSlug: row.workspaceSlug,
      productSlug: row.productSlug,
      lastModified: row.updatedAt,
    }));

  entries.push(
    ...changelogProductRows
      .filter((row) => publicSurfaceEnabled(toPlanId(row.plan)))
      .map((row) => ({
        kind: "changelog" as const,
        workspaceSlug: row.workspaceSlug,
        productSlug: row.productSlug,
        lastModified: row.updatedAt,
      })),
    ...changelogEntryRows
      .filter((row) => publicSurfaceEnabled(toPlanId(row.plan)))
      .map((row) => ({
        kind: "changelog_entry" as const,
        workspaceSlug: row.workspaceSlug,
        productSlug: row.productSlug,
        slug: row.slug,
        lastModified: row.updatedAt,
      })),
    ...visibleBoards.map((row) => ({
      kind: "board" as const,
      workspaceSlug: row.workspaceSlug,
      productSlug: row.productSlug,
      boardSlug: row.boardSlug,
      lastModified: row.boardUpdatedAt,
    })),
  );

  const visibleHelpCollections = helpCollectionRows.filter((row) =>
    publicSurfaceEnabled(toPlanId(row.plan)),
  );
  const helpIndexes = new Map<string, { workspaceSlug: string; productSlug: string; lastModified: Date }>();
  for (const row of visibleHelpCollections) {
    const key = `${row.workspaceSlug}/${row.productSlug}`;
    const existing = helpIndexes.get(key);
    if (!existing || row.updatedAt > existing.lastModified) {
      helpIndexes.set(key, {
        workspaceSlug: row.workspaceSlug,
        productSlug: row.productSlug,
        lastModified: row.updatedAt,
      });
    }
    entries.push({
      kind: "help_collection",
      workspaceSlug: row.workspaceSlug,
      productSlug: row.productSlug,
      collectionSlug: row.collectionSlug,
      lastModified: row.updatedAt,
    });
  }
  entries.push(
    ...[...helpIndexes.values()].map((row) => ({ kind: "help" as const, ...row })),
    ...helpArticleRows
      .filter((row) => publicSurfaceEnabled(toPlanId(row.plan)))
      .map((row) => ({
        kind: "help_article" as const,
        workspaceSlug: row.workspaceSlug,
        productSlug: row.productSlug,
        collectionSlug: row.collectionSlug,
        articleSlug: row.articleSlug,
        lastModified: row.updatedAt,
      })),
  );

  const apiIndexes = new Map<string, { workspaceSlug: string; productSlug: string; lastModified: Date }>();
  for (const row of apiDocRows) {
    if (!publicSurfaceEnabled(toPlanId(row.plan))) continue;
    const key = `${row.workspaceSlug}/${row.productSlug}`;
    const existing = apiIndexes.get(key);
    if (!existing || row.updatedAt > existing.lastModified) {
      apiIndexes.set(key, {
        workspaceSlug: row.workspaceSlug,
        productSlug: row.productSlug,
        lastModified: row.updatedAt,
      });
    }
    entries.push({
      kind: "api_doc",
      workspaceSlug: row.workspaceSlug,
      productSlug: row.productSlug,
      docSlug: row.docSlug,
      lastModified: row.updatedAt,
    });
  }
  entries.push(
    ...[...apiIndexes.values()].map((row) => ({ kind: "api_docs" as const, ...row })),
  );

  if (visibleBoards.length === 0) return entries;

  const latest = latestPostModerationSql();
  const requireApproval = sql<string>`coalesce(${boards.settings} #>> '{moderation,requireApproval}', 'none')`;

  const requestRows = await db
    .select({
      id: feedbackPosts.id,
      updatedAt: feedbackPosts.updatedAt,
      boardSlug: boards.slug,
      productSlug: products.slug,
      workspaceSlug: workspaces.slug,
    })
    .from(feedbackPosts)
    .innerJoin(boards, eq(feedbackPosts.boardId, boards.id))
    .innerJoin(products, eq(boards.productId, products.id))
    .innerJoin(workspaces, eq(products.workspaceId, workspaces.id))
    .leftJoin(customers, eq(feedbackPosts.authorCustomerId, customers.id))
    .where(
      and(
        inArray(
          boards.id,
          visibleBoards.map((row) => row.boardId),
        ),
        eq(feedbackPosts.productId, boards.productId),
        isNull(feedbackPosts.archivedAt),
        isNull(feedbackPosts.hiddenAt),
        isNull(feedbackPosts.mergedIntoId),
        isNull(customers.bannedAt),
        eq(feedbackPosts.privacy, "public"),
        sql`case when ${requireApproval} = 'none' then ${latest} is distinct from 'rejected' else ${latest} = 'approved' end`,
      ),
    )
    .orderBy(desc(feedbackPosts.updatedAt))
    .limit(20_000);

  entries.push(
    ...requestRows.map((row) => ({
      kind: "request" as const,
      workspaceSlug: row.workspaceSlug,
      productSlug: row.productSlug,
      boardSlug: row.boardSlug,
      requestId: row.id,
      lastModified: row.updatedAt,
    })),
  );

  return entries;
}

export async function getPublicRequestPage(
  input: {
    workspaceSlug: string;
    productSlug: string;
    boardSlug: string;
    requestId: string;
  },
  viewer: PublicViewer | null = null,
): Promise<PublicRequestPage | null> {
  const tenant = await resolvePublicBoard({
    ...input,
    viewerCustomerId: viewer?.customerId ?? null,
  });
  if (!tenant) return null;
  if (!publicSurfaceEnabled(tenant.workspace.plan)) return null;

  const maskIdentity =
    hasFeature(tenant.workspace.plan, "identityMasking") &&
    (await getCustomerIdentityMasking(tenant.workspace.id));

  const effectiveViewer =
    viewer && viewer.workspaceId === tenant.workspace.id ? viewer : null;

  const rows = await db
    .select({
      id: feedbackPosts.id,
      title: feedbackPosts.title,
      body: feedbackPosts.body,
      status: feedbackPosts.status,
      category: feedbackPosts.category,
      privacy: feedbackPosts.privacy,
      authorLabel: feedbackPosts.authorLabel,
      authorCustomerId: feedbackPosts.authorCustomerId,
      createdAt: feedbackPosts.createdAt,
      updatedAt: feedbackPosts.updatedAt,
      plannedFor: feedbackPosts.plannedFor,
      customerName: customers.name,
      customerBannedAt: customers.bannedAt,
    })
    .from(feedbackPosts)
    .leftJoin(customers, eq(feedbackPosts.authorCustomerId, customers.id))
    .where(
      and(
        eq(feedbackPosts.id, input.requestId),
        eq(feedbackPosts.boardId, tenant.board.id),
        eq(feedbackPosts.productId, tenant.product.id),
        isNull(feedbackPosts.archivedAt),
        isNull(feedbackPosts.hiddenAt),
        isNull(feedbackPosts.mergedIntoId),
        postPrivacySql(effectiveViewer?.customerId ?? null),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row || row.customerBannedAt !== null) return null;

  const [postReviews, commentRows, tagMap, votes] = await Promise.all([
    latestModeration("feedback_post", [row.id]),
    db
      .select({
        id: feedbackComments.id,
        authorName: feedbackComments.authorName,
        authorType: feedbackComments.authorType,
        authorCustomerId: feedbackComments.authorCustomerId,
        body: feedbackComments.body,
        privacy: feedbackComments.privacy,
        createdAt: feedbackComments.createdAt,
      })
      .from(feedbackComments)
      .leftJoin(customers, eq(feedbackComments.authorCustomerId, customers.id))
      .where(
        and(
          eq(feedbackComments.feedbackPostId, row.id),
          eq(feedbackComments.productId, tenant.product.id),
          eq(feedbackComments.internal, false),
          commentPrivacySql(effectiveViewer?.customerId ?? null),
          isNull(customers.bannedAt),
        ),
      )
      .orderBy(asc(feedbackComments.createdAt)),
    tagsForPosts([row.id]),
    voteCounts([row.id]),
  ]);

  const latestPostModeration = postReviews.get(row.id) ?? null;
  const isVisible = isPubliclyVisible(
    tenant.board.settings.moderation.requireApproval,
    latestPostModeration,
  );
  const isAuthor =
    effectiveViewer !== null && row.authorCustomerId === effectiveViewer.customerId;

  // A pending request is shown to its author as a receipt; a rejected one is
  // not shown to anyone. Everyone else gets the same 404 as a missing id.
  if (!isVisible && !(isAuthor && latestPostModeration === "pending")) return null;

  const commentReviews = await latestModeration(
    "feedback_comment",
    commentRows.map((comment) => comment.id),
  );

  const comments = commentRows
    .map((comment) => {
      const commentIsAuthor =
        effectiveViewer !== null && comment.authorCustomerId === effectiveViewer.customerId;
      const visible = isPublicCommentVisible(
        tenant.board.settings.moderation.comments,
        commentReviews.get(comment.id) ?? null,
      );

      return {
        ...comment,
        visible,
        commentIsAuthor,
        latestModeration: commentReviews.get(comment.id) ?? null,
      };
    })
    .filter((comment) => comment.visible || comment.commentIsAuthor)
    .map((comment) =>
      toPublicComment({
        ...comment,
        authorName:
          maskIdentity && comment.authorType === "customer"
            ? "A customer"
            : comment.authorName,
        pending: !comment.visible,
        isAuthor: comment.commentIsAuthor,
      }),
    );

  const [attachmentRows, reactionRows, viewerReactions, viewerVote, viewerFollow] =
    await Promise.all([
      db
        .select({
          id: feedbackAttachments.id,
          fileName: feedbackAttachments.fileName,
          mimeType: feedbackAttachments.mimeType,
          byteSize: feedbackAttachments.byteSize,
          storageKey: feedbackAttachments.storageKey,
        })
        .from(feedbackAttachments)
        .where(eq(feedbackAttachments.feedbackPostId, row.id))
        .orderBy(asc(feedbackAttachments.createdAt)),
      db
        .select({
          kind: feedbackReactions.kind,
          count: sql<number>`count(*)::int`,
        })
        .from(feedbackReactions)
        .where(eq(feedbackReactions.feedbackPostId, row.id))
        .groupBy(feedbackReactions.kind),
      effectiveViewer === null
        ? Promise.resolve([] as { kind: PublicReactionKind }[])
        : db
            .select({ kind: feedbackReactions.kind })
            .from(feedbackReactions)
            .where(
              and(
                eq(feedbackReactions.feedbackPostId, row.id),
                eq(feedbackReactions.customerId, effectiveViewer.customerId),
              ),
            ),
      effectiveViewer === null
        ? Promise.resolve([] as { id: string }[])
        : db
            .select({ id: feedbackCustomerVotes.id })
            .from(feedbackCustomerVotes)
            .where(
              and(
                eq(feedbackCustomerVotes.feedbackPostId, row.id),
                eq(feedbackCustomerVotes.customerId, effectiveViewer.customerId),
              ),
            )
            .limit(1),
      effectiveViewer === null
        ? Promise.resolve([] as { id: string }[])
        : db
            .select({ id: feedbackFollowers.id })
            .from(feedbackFollowers)
            .where(
              and(
                eq(feedbackFollowers.feedbackPostId, row.id),
                eq(feedbackFollowers.customerId, effectiveViewer.customerId),
              ),
            )
            .limit(1),
    ]);

  const reactions: PublicReaction[] = REACTION_KINDS.map((kind) => ({
    kind,
    count: reactionRows.find((reaction) => reaction.kind === kind)?.count ?? 0,
    reacted: viewerReactions.some((reaction) => reaction.kind === kind),
  }));

  const attachments = attachmentRows.flatMap((attachment) => {
    try {
      return [
        {
          id: attachment.id,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          byteSize: attachment.byteSize,
          url: createSignedStorageUrl(attachment.storageKey),
          isImage: attachment.mimeType.startsWith("image/"),
        },
      ];
    } catch {
      // A row with an unusable key is omitted rather than failing the page.
      return [];
    }
  });

  const [mergedRequests, similarRequests, linkedReleases, demandEvidence] =
    await Promise.all([
      mergedRequestsFor(tenant, row.id),
      similarRequestsFor({ tenant, post: row }),
      linkedReleasesFor(row.id),
      // Counts only: the quotes, authors and source references behind them
      // stay in the dashboard.
      db
        .select({
          id: feedbackInsights.id,
          authorCustomerId: feedbackInsights.authorCustomerId,
          authorLabel: feedbackInsights.authorLabel,
          sourceRef: feedbackInsights.sourceRef,
        })
        .from(feedbackInsights)
        .where(
          and(
            eq(feedbackInsights.feedbackPostId, row.id),
            eq(feedbackInsights.productId, tenant.product.id),
          ),
        ),
    ]);

  const summary = toPublicRequestSummary(
    requestSource({
      row: maskIdentity
        ? { ...row, customerName: row.customerName ? "A customer" : null }
        : row,
      tags: tagMap.get(row.id) ?? [],
      voteCount: votes.get(row.id) ?? 0,
      commentCount: comments.filter((comment) => !comment.pending).length,
      latestModeration: latestPostModeration,
    }),
  );

  const request: PublicRequestDetail = {
    ...summary,
    comments,
    attachments,
    reactions,
    viewer: {
      hasSession: effectiveViewer !== null,
      identified: effectiveViewer?.identified ?? false,
      isAuthor,
      hasVoted: viewerVote.length > 0,
      follows: viewerFollow.length > 0,
      hasCompany: effectiveViewer?.hasCompany ?? false,
    },
    visibility: isVisible ? "public" : "awaiting_review",
    mergedRequests,
    similarRequests,
    linkedReleases,
    demand: summarizeRequestDemand(demandEvidence),
    // The policy is the workspace's, not the request's: filling in a target
    // date never publishes it on its own.
    plannedFor: tenant.workspace.publicPlannedFor ? (row.plannedFor ?? null) : null,
  };

  return {
    workspace: { id: tenant.workspace.id, name: tenant.workspace.name, slug: tenant.workspace.slug },
    product: { id: tenant.product.id, name: tenant.product.name, slug: tenant.product.slug },
    board: toPublicBoard(tenant),
    request,
  };
}

export async function getPublicSubmitPage(
  input: { workspaceSlug: string; productSlug: string; boardSlug: string },
  viewer: PublicViewer | null = null,
): Promise<PublicSubmitPage | null> {
  const tenant = await resolvePublicBoard(input);
  if (!tenant) return null;
  if (!publicSurfaceEnabled(tenant.workspace.plan)) return null;

  const effectiveViewer =
    viewer && viewer.workspaceId === tenant.workspace.id ? viewer : null;

  return {
    workspace: { id: tenant.workspace.id, name: tenant.workspace.name, slug: tenant.workspace.slug },
    product: { id: tenant.product.id, name: tenant.product.name, slug: tenant.product.slug },
    board: toPublicBoard(tenant),
    boards: await listPublicBoards(tenant.product.id),
    viewer: {
      hasSession: effectiveViewer !== null,
      identified: effectiveViewer?.identified ?? false,
      hasCompany: effectiveViewer?.hasCompany ?? false,
    },
    customFields: (await listActiveCustomFields(tenant.product.id)).map((field) => ({
      id: field.id,
      key: field.key,
      label: field.label,
      description: field.description,
      type: field.type,
      options: field.options,
      required: field.required,
    })),
    intakeQuestions: await listIntakeQuestions({
      productId: tenant.product.id,
      channel: "board",
      boardId: tenant.board.id,
    }),
    aiRewriteEnabled: await submissionAssistantAvailable(tenant.product.id),
  };
}

/**
 * Duplicate suggestions while someone types a title.
 *
 * Searches every public board of the product, because the duplicate may
 * already live on a different board, and respects each board's own approval
 * rule. A rejected, merged or archived request is never suggested.
 */
export async function suggestPublicRequests(
  input: { workspaceSlug: string; productSlug: string; boardSlug: string },
  query: string,
): Promise<PublicSuggestion[] | null> {
  const tenant = await resolvePublicBoard(input);
  if (!tenant) return null;
  if (!publicSurfaceEnabled(tenant.workspace.plan)) return null;

  const tokens = tokenize(query).slice(0, 6);
  if (tokens.length === 0) return [];

  const latest = latestPostModerationSql();
  const searchConditions = tokens.flatMap((token) => {
    const pattern = `%${escapeLikePattern(token)}%`;
    return [
      ilike(feedbackPosts.title, pattern),
      ilike(feedbackPosts.body, pattern),
    ];
  });

  const rows = await db
    .select({
      id: feedbackPosts.id,
      title: feedbackPosts.title,
      body: feedbackPosts.body,
      status: feedbackPosts.status,
      boardSlug: boards.slug,
      boardName: boards.name,
      settings: boards.settings,
      voteCount: voteCountSql(),
    })
    .from(feedbackPosts)
    .innerJoin(boards, eq(feedbackPosts.boardId, boards.id))
    .leftJoin(customers, eq(feedbackPosts.authorCustomerId, customers.id))
    .where(
      and(
        eq(feedbackPosts.productId, tenant.product.id),
        eq(boards.visibility, "public"),
        isNull(boards.archivedAt),
        isNull(feedbackPosts.archivedAt),
        isNull(feedbackPosts.hiddenAt),
        isNull(feedbackPosts.mergedIntoId),
        isNull(customers.bannedAt),
        eq(feedbackPosts.privacy, "public"),
        sql`${latest} IS DISTINCT FROM 'rejected'`,
        sql`(
          (${boards.settings} #>> '{moderation,requireApproval}') = 'none'
          OR ${latest} = 'approved'
        )`,
        or(...searchConditions),
      ),
    )
    .orderBy(desc(voteCountSql()), desc(feedbackPosts.createdAt))
    .limit(200);

  return rankSimilar({ title: query, body: "" }, rows, { limit: 5 }).map((row) => ({
    id: row.id,
    title: row.title,
    status: toPublicStatus(row.status),
    voteCount: row.voteCount,
    boardSlug: row.boardSlug,
    boardName: row.boardName,
    excerpt: excerpt(row.body),
  }));
}
