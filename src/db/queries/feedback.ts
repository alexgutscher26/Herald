import "server-only";

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "@/db";
import { user } from "@/db/schema/auth";
import { boardTags } from "@/db/schema/boards";
import { customFields, feedbackCustomFieldValues } from "@/db/schema/custom-fields";
import {
  customerCompanies,
  customerCompanyMemberships,
  customers,
} from "@/db/schema/customers";
import {
  feedbackComments,
  feedbackPosts,
  feedbackVotes,
} from "@/db/schema/feedback";
import {
  feedbackContextLinks,
  feedbackCustomerVotes,
  feedbackFollowers,
  feedbackInsights,
  feedbackTagLinks,
} from "@/db/schema/feedback-extensions";
import { helpArticles } from "@/db/schema/help";
import { releases } from "@/db/schema/releases";
import { feedbackSavedViews } from "@/db/schema/feedback-views";
import { feedbackPrioritisation } from "@/db/schema/prioritisation";
import { releaseFeedbackLinks } from "@/db/schema/roadmap";
import { products } from "@/db/schema/workspaces";
import { normalizeViewFilters } from "@/features/feedback/saved-view-filters";
import { companyRevenue } from "@/features/feedback/prioritisation";
import type {
  CustomFieldDefinition,
  CustomFieldValue,
  CustomerRevenue,
  CustomerSegment,
  FeedbackCategory,
  FeedbackComment,
  FeedbackFollowerKey,
  FeedbackContextLink,
  FeedbackInsight,
  FeedbackPost,
  FeedbackPrioritisation,
  FeedbackSavedView,
  HelpArticleOption,
  FeedbackStatus,
  FeedbackTag,
  FeedbackTagLink,
  FeedbackVote,
} from "@/types";

/**
 * Feedback reads.
 *
 * All helpers take a `productId` already authorized by the caller. Vote and
 * comment joins are constrained through that product so a compromised post id
 * cannot pull rows from another tenant.
 */

const assigneeUser = alias(user, "feedback_assignee");

const UI_STATUSES: FeedbackStatus[] = [
  "new",
  "under_review",
  "planned",
  "in_progress",
  "shipped",
  "closed",
];

const UI_CATEGORIES: FeedbackCategory[] = [
  "feature_request",
  "bug",
  "improvement",
  "question",
];

export type DbFeedbackStatus =
  | "open"
  | "under_review"
  | "planned"
  | "in_progress"
  | "shipped"
  | "closed";

export function toUiFeedbackStatus(status: string): FeedbackStatus {
  if (status === "open") return "new";
  return UI_STATUSES.includes(status as FeedbackStatus)
    ? (status as FeedbackStatus)
    : "new";
}

export function toDbFeedbackStatus(status: FeedbackStatus): DbFeedbackStatus {
  return status === "new" ? "open" : status;
}

function asCategory(value: string): FeedbackCategory {
  return UI_CATEGORIES.includes(value as FeedbackCategory)
    ? (value as FeedbackCategory)
    : "question";
}

function iso(value: Date): string {
  return value.toISOString();
}

export type FeedbackSnapshot = {
  posts: FeedbackPost[];
  votes: FeedbackVote[];
  comments: FeedbackComment[];
  tags: FeedbackTag[];
  tagLinks: FeedbackTagLink[];
  customFields: CustomFieldDefinition[];
  customFieldValues: CustomFieldValue[];
  prioritisation: FeedbackPrioritisation[];
  followers: FeedbackFollowerKey[];
  customerRevenue: CustomerRevenue[];
  customerSegments: CustomerSegment[];
  insights: FeedbackInsight[];
  contextLinks: FeedbackContextLink[];
  helpArticles: HelpArticleOption[];
};

function mapCustomField(row: typeof customFields.$inferSelect): CustomFieldDefinition {
  return {
    id: row.id,
    productId: row.productId,
    key: row.key,
    label: row.label,
    description: row.description,
    type: row.type,
    options: Array.isArray(row.options) ? row.options : [],
    required: row.required,
    position: row.position,
    archivedAt: row.archivedAt ? iso(row.archivedAt) : null,
  };
}

export async function getFeedbackSnapshot(productId: string): Promise<FeedbackSnapshot> {
  const rows = await db
    .select({
      post: feedbackPosts,
      authorName: user.name,
      assigneeName: assigneeUser.name,
      customerBannedAt: customers.bannedAt,
    })
    .from(feedbackPosts)
    .leftJoin(user, eq(feedbackPosts.authorId, user.id))
    .leftJoin(assigneeUser, eq(feedbackPosts.assigneeId, assigneeUser.id))
    .leftJoin(customers, eq(feedbackPosts.authorCustomerId, customers.id))
    .where(eq(feedbackPosts.productId, productId))
    .orderBy(desc(feedbackPosts.createdAt));

  const ids = rows.map((row) => row.post.id);
  const [tags, tagLinks, fieldRows, priorityRows, articleRows] = await Promise.all([
    db
      .select({
        id: boardTags.id,
        boardId: boardTags.boardId,
        productId: boardTags.productId,
        name: boardTags.name,
        color: boardTags.color,
        position: boardTags.position,
      })
      .from(boardTags)
      .where(eq(boardTags.productId, productId))
      .orderBy(asc(boardTags.position), asc(boardTags.name)),
    db
      .select({
        postId: feedbackTagLinks.feedbackPostId,
        tagId: feedbackTagLinks.tagId,
      })
      .from(feedbackTagLinks)
      .where(eq(feedbackTagLinks.productId, productId)),
    db
      .select()
      .from(customFields)
      .where(eq(customFields.productId, productId))
      .orderBy(asc(customFields.position), asc(customFields.label)),
    db
      .select()
      .from(feedbackPrioritisation)
      .where(eq(feedbackPrioritisation.productId, productId)),
    db
      .select({
        id: helpArticles.id,
        title: helpArticles.title,
        status: helpArticles.status,
      })
      .from(helpArticles)
      .where(eq(helpArticles.productId, productId))
      .orderBy(asc(helpArticles.title)),
  ]);

  const mappedFields = fieldRows.map(mapCustomField);

  if (ids.length === 0) {
    return {
      posts: [],
      votes: [],
      comments: [],
      tags,
      tagLinks,
      customFields: mappedFields,
      customFieldValues: [],
      prioritisation: [],
      followers: [],
      customerRevenue: [],
      customerSegments: [],
      insights: [],
      contextLinks: [],
      helpArticles: articleRows,
    };
  }

  const [
    releaseLinks,
    votes,
    customerVotes,
    comments,
    fieldValues,
    followers,
    insightRows,
    contextRows,
  ] = await Promise.all([
    db
      .select({
        feedbackPostId: releaseFeedbackLinks.feedbackPostId,
        releaseId: releaseFeedbackLinks.releaseId,
        createdAt: releaseFeedbackLinks.createdAt,
      })
      .from(releaseFeedbackLinks)
      .where(inArray(releaseFeedbackLinks.feedbackPostId, ids))
      .orderBy(asc(releaseFeedbackLinks.createdAt)),
    db
      .select({ vote: feedbackVotes, voterName: user.name })
      .from(feedbackVotes)
      .innerJoin(feedbackPosts, eq(feedbackVotes.feedbackPostId, feedbackPosts.id))
      .leftJoin(user, eq(feedbackVotes.voterId, user.id))
      .where(eq(feedbackPosts.productId, productId))
      .orderBy(asc(feedbackVotes.createdAt)),
    db
      .select({
        id: feedbackCustomerVotes.id,
        postId: feedbackCustomerVotes.feedbackPostId,
        customerId: feedbackCustomerVotes.customerId,
        customerName: customers.name,
        createdAt: feedbackCustomerVotes.createdAt,
      })
      .from(feedbackCustomerVotes)
      .innerJoin(feedbackPosts, eq(feedbackCustomerVotes.feedbackPostId, feedbackPosts.id))
      .leftJoin(customers, eq(feedbackCustomerVotes.customerId, customers.id))
      .where(eq(feedbackPosts.productId, productId))
      .orderBy(asc(feedbackCustomerVotes.createdAt)),
    db
      .select()
      .from(feedbackComments)
      .where(eq(feedbackComments.productId, productId))
      .orderBy(asc(feedbackComments.createdAt)),
    db
      .select()
      .from(feedbackCustomFieldValues)
      .where(eq(feedbackCustomFieldValues.productId, productId)),
    db
      .select({
        postId: feedbackFollowers.feedbackPostId,
        customerId: feedbackFollowers.customerId,
      })
      .from(feedbackFollowers)
      .innerJoin(feedbackPosts, eq(feedbackFollowers.feedbackPostId, feedbackPosts.id))
      .where(eq(feedbackPosts.productId, productId)),
    db
      .select({
        id: feedbackInsights.id,
        productId: feedbackInsights.productId,
        postId: feedbackInsights.feedbackPostId,
        quote: feedbackInsights.quote,
        source: feedbackInsights.source,
        sourceRef: feedbackInsights.sourceRef,
        authorLabel: feedbackInsights.authorLabel,
        authorCustomerId: feedbackInsights.authorCustomerId,
        occurredAt: feedbackInsights.occurredAt,
        createdAt: feedbackInsights.createdAt,
      })
      .from(feedbackInsights)
      .where(eq(feedbackInsights.productId, productId))
      .orderBy(desc(feedbackInsights.occurredAt)),
    db
      .select({
        id: feedbackContextLinks.id,
        postId: feedbackContextLinks.feedbackPostId,
        kind: feedbackContextLinks.kind,
        refId: feedbackContextLinks.refId,
        createdAt: feedbackContextLinks.createdAt,
        articleTitle: helpArticles.title,
        releaseTitle: releases.title,
      })
      .from(feedbackContextLinks)
      .leftJoin(
        helpArticles,
        and(
          eq(feedbackContextLinks.kind, "help_article"),
          eq(helpArticles.id, feedbackContextLinks.refId),
          eq(helpArticles.productId, productId),
        ),
      )
      .leftJoin(
        releases,
        and(
          eq(feedbackContextLinks.kind, "changelog"),
          eq(releases.id, feedbackContextLinks.refId),
          eq(releases.productId, productId),
        ),
      )
      .where(eq(feedbackContextLinks.productId, productId))
      .orderBy(asc(feedbackContextLinks.createdAt)),
  ]);

  // Revenue is only looked up for people already attached to this product's
  // requests, and only when a company trait actually stores a number.
  const requesterIds = new Set<string>();
  for (const row of rows) {
    if (row.post.authorCustomerId) requesterIds.add(row.post.authorCustomerId);
  }
  for (const vote of customerVotes) requesterIds.add(vote.customerId);
  for (const comment of comments) {
    if (comment.authorCustomerId) requesterIds.add(comment.authorCustomerId);
  }
  for (const follower of followers) requesterIds.add(follower.customerId);

  // Requester traits feed the inbox's segment filters. The workspace
  // subquery is a second lock: an id from a product's posts already belongs to
  // this tenant, and this makes that impossible to bypass.
  const customerRows =
    requesterIds.size === 0
      ? []
      : await db
          .select({
            id: customers.id,
            email: customers.email,
            traits: customers.traits,
          })
          .from(customers)
          .where(
            and(
              inArray(customers.id, [...requesterIds]),
              inArray(
                customers.workspaceId,
                db
                  .select({ id: products.workspaceId })
                  .from(products)
                  .where(eq(products.id, productId)),
              ),
            ),
          );

  const revenueRows =
    requesterIds.size === 0
      ? []
      : await db
          .select({
            customerId: customerCompanyMemberships.customerId,
            companyId: customerCompanies.id,
            companyName: customerCompanies.name,
            traits: customerCompanies.traits,
            crmAnnualRevenueCents: customerCompanies.crmAnnualRevenueCents,
            crmOpenDealValueCents: customerCompanies.crmOpenDealValueCents,
          })
          .from(customerCompanyMemberships)
          .innerJoin(
            customerCompanies,
            eq(customerCompanyMemberships.companyId, customerCompanies.id),
          )
          .innerJoin(
            products,
            eq(customerCompanies.workspaceId, products.workspaceId),
          )
          .where(
            and(
              eq(products.id, productId),
              inArray(customerCompanyMemberships.customerId, [...requesterIds]),
            ),
          );

  const customerRevenue: CustomerRevenue[] = [];
  const segmentByCustomer = new Map<string, CustomerSegment>();

  for (const row of customerRows) {
    const email = row.email?.trim().toLowerCase() ?? "";
    const domain = email.includes("@") ? (email.split("@")[1] ?? null) : null;
    segmentByCustomer.set(row.id, {
      customerId: row.id,
      emailDomain: domain,
      customerTraits: row.traits,
      companyTraits: [],
    });
  }

  for (const row of revenueRows) {
    const segment = segmentByCustomer.get(row.customerId);
    if (segment) segment.companyTraits.push(row.traits);

    const revenue = companyRevenue({
      traits: row.traits,
      crmAnnualRevenueCents: row.crmAnnualRevenueCents,
      crmOpenDealValueCents: row.crmOpenDealValueCents,
    });
    if (revenue.annualRevenue === null && revenue.openDealValue === null) {
      continue;
    }

    customerRevenue.push({
      customerId: row.customerId,
      companyId: row.companyId,
      companyName: row.companyName,
      ...revenue,
    });
  }

  const customerSegments = [...segmentByCustomer.values()];

  const releaseByPost = new Map<string, string>();
  for (const link of releaseLinks) {
    if (!releaseByPost.has(link.feedbackPostId)) {
      releaseByPost.set(link.feedbackPostId, link.releaseId);
    }
  }

  return {
    posts: rows.map(({ post, authorName, assigneeName, customerBannedAt }) => ({
      id: post.id,
      productId: post.productId,
      boardId: post.boardId ?? null,
      title: post.title,
      description: post.body,
      category: asCategory(post.category),
      status: toUiFeedbackStatus(post.status),
      privacy: post.privacy,
      authorName: post.authorLabel ?? authorName ?? post.authorEmail ?? "Anonymous",
      authorEmail: post.authorEmail ?? "",
      authorCustomerId: post.authorCustomerId ?? null,
      authorBanned: customerBannedAt !== null,
      company: post.authorCompany ?? null,
      createdAt: iso(post.createdAt),
      updatedAt: iso(post.updatedAt),
      releaseId: releaseByPost.get(post.id) ?? null,
      mergedIntoId: post.mergedIntoId ?? null,
      hiddenAt: post.hiddenAt ? iso(post.hiddenAt) : null,
      assigneeId: post.assigneeId ?? null,
      assigneeName: assigneeName ?? null,
      plannedFor: post.plannedFor ?? null,
      originalTitle: post.originalTitle ?? null,
      originalBody: post.originalBody ?? null,
      splitFromId: post.splitFromId ?? null,
    })),
    votes: [
      ...votes.map(({ vote, voterName }) => ({
        id: vote.id,
        productId,
        postId: vote.feedbackPostId,
        voterKey: vote.voterId,
        voterName: voterName ?? "Team member",
        voterType: "team" as const,
        createdAt: iso(vote.createdAt),
      })),
      ...customerVotes.map((vote) => ({
        id: vote.id,
        productId,
        postId: vote.postId,
        voterKey: vote.customerId,
        voterName: vote.customerName ?? "Customer",
        voterType: "customer" as const,
        createdAt: iso(vote.createdAt),
      })),
    ].sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    comments: comments.map((comment) => ({
      id: comment.id,
      productId: comment.productId,
      postId: comment.feedbackPostId,
      authorName: comment.authorName,
      authorType: comment.authorType,
      authorCustomerId: comment.authorCustomerId ?? null,
      body: comment.body,
      internal: comment.internal,
      privacy: comment.privacy,
      createdAt: iso(comment.createdAt),
    })),
    tags,
    tagLinks,
    customFields: mappedFields,
    customFieldValues: fieldValues.map((row) => ({
      postId: row.feedbackPostId,
      fieldId: row.fieldId,
      value:
        row.numberValue ?? row.dateValue ?? row.textValue ?? "",
    })),
    prioritisation: priorityRows.map((row) => ({
      postId: row.feedbackPostId,
      impact: row.impact,
      businessValue: row.businessValue,
      effort: row.effort,
    })),
    followers,
    customerRevenue,
    customerSegments,
    insights: insightRows.map((row) => ({
      id: row.id,
      productId: row.productId,
      postId: row.postId,
      quote: row.quote,
      source: row.source,
      sourceRef: row.sourceRef,
      authorLabel: row.authorLabel,
      authorCustomerId: row.authorCustomerId,
      occurredAt: iso(row.occurredAt),
      createdAt: iso(row.createdAt),
    })),
    contextLinks: contextRows.map((row) => ({
      id: row.id,
      postId: row.postId,
      kind: row.kind,
      refId: row.refId,
      label: row.articleTitle ?? row.releaseTitle ?? null,
      createdAt: iso(row.createdAt),
    })),
    helpArticles: articleRows,
  };
}

export async function findFeedbackForProduct(
  productId: string,
  postId: string,
): Promise<FeedbackPost | null> {
  const snapshot = await getFeedbackSnapshot(productId);
  return snapshot.posts.find((post) => post.id === postId) ?? null;
}

export async function listFeedbackOptions(productId: string): Promise<
  { id: string; title: string; status: FeedbackStatus; votes: number }[]
> {
  const snapshot = await getFeedbackSnapshot(productId);
  const voteCounts = new Map<string, number>();
  for (const vote of snapshot.votes) {
    voteCounts.set(vote.postId, (voteCounts.get(vote.postId) ?? 0) + 1);
  }
  return snapshot.posts
    .filter((post) => post.mergedIntoId === null)
    .map((post) => ({
      id: post.id,
      title: post.title,
      status: post.status,
      votes: voteCounts.get(post.id) ?? 0,
    }));
}

/** Verify a feedback row belongs to the product before using a client id. */
export async function findFeedbackProductId(postId: string): Promise<string | null> {
  const rows = await db
    .select({ productId: feedbackPosts.productId })
    .from(feedbackPosts)
    .where(eq(feedbackPosts.id, postId))
    .limit(1);
  return rows[0]?.productId ?? null;
}

/**
 * Saved inbox views for one member inside one product.
 *
 * The user id is part of the query, not a client value, so another member's
 * filters can never be listed or applied. Malformed `jsonb` is normalized to
 * safe defaults.
 */
export async function listFeedbackSavedViews(
  productId: string,
  userId: string,
): Promise<FeedbackSavedView[]> {
  const rows = await db
    .select()
    .from(feedbackSavedViews)
    .where(
      and(
        eq(feedbackSavedViews.productId, productId),
        eq(feedbackSavedViews.userId, userId),
      ),
    )
    .orderBy(asc(feedbackSavedViews.name));

  return rows.map((row) => ({
    id: row.id,
    productId: row.productId,
    name: row.name,
    filters: normalizeViewFilters(row.filters),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  }));
}

/** Verify a vote row belongs to the product before mutating it. */
export async function findFeedbackVoteProductId(voteId: string): Promise<string | null> {
  const rows = await db
    .select({ productId: feedbackPosts.productId })
    .from(feedbackVotes)
    .innerJoin(feedbackPosts, eq(feedbackVotes.feedbackPostId, feedbackPosts.id))
    .where(and(eq(feedbackVotes.id, voteId)))
    .limit(1);
  return rows[0]?.productId ?? null;
}
