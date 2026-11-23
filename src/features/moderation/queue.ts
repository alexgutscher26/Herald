import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  boards,
  customers,
  feedbackComments,
  feedbackPosts,
  type ModerationChecks,
} from "@/db/schema";
import { publicRequestPath } from "@/features/public/paths";

import type {
  ModerationCounts,
  ModerationQueueItem,
  ModerationQueueStatus,
} from "./types";

export type { ModerationCounts, ModerationQueueItem, ModerationQueueStatus };

/**
 * Moderation queue reads.
 *
 * A content item can accumulate more than one review (auto-flag, human
 * decision, retry), so the queue only shows each item's newest review. That is
 * the same row the public visibility checks use, which keeps the queue's
 * "approved/rejected" state aligned with what visitors can see.
 */


type LatestReviewRow = {
  id: string;
  content_type: string;
  content_id: string;
  status: string;
  reasons: unknown;
  checks: unknown;
  created_at: Date | string;
  reviewed_at: Date | string | null;
};

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function checksValue(value: unknown): ModerationChecks {
  return typeof value === "object" && value !== null
    ? (value as ModerationChecks)
    : {};
}

function statusValue(value: string): "pending" | "approved" | "rejected" {
  return value === "approved" || value === "rejected" ? value : "pending";
}

export async function getModerationQueue(input: {
  productId: string;
  workspaceSlug: string;
  productSlug: string;
  status: ModerationQueueStatus;
  limit?: number;
}): Promise<ModerationQueueItem[]> {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);

  const latest = await db.execute(sql`
    SELECT id, content_type, content_id, status, reasons, checks, created_at, reviewed_at
    FROM (
      SELECT
        mr.id,
        mr.content_type,
        mr.content_id,
        mr.status,
        mr.reasons,
        mr.checks,
        mr.created_at,
        mr.reviewed_at,
        row_number() OVER (
          PARTITION BY mr.content_type, mr.content_id
          ORDER BY mr.created_at DESC, mr.id DESC
        ) AS rn
      FROM moderation_reviews mr
      WHERE mr.product_id = ${input.productId}
    ) latest
    WHERE latest.rn = 1
      AND (${input.status} = 'all' OR latest.status::text = ${input.status})
    ORDER BY latest.created_at DESC
    LIMIT ${limit}
  `);

  const reviews = latest.rows as unknown as LatestReviewRow[];
  if (reviews.length === 0) return [];

  const postIds = reviews
    .filter((review) => review.content_type === "feedback_post")
    .map((review) => review.content_id);
  const commentIds = reviews
    .filter((review) => review.content_type === "feedback_comment")
    .map((review) => review.content_id);

  const [postRows, commentRows] = await Promise.all([
    postIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            id: feedbackPosts.id,
            title: feedbackPosts.title,
            body: feedbackPosts.body,
            authorLabel: feedbackPosts.authorLabel,
            customerId: customers.id,
            customerName: customers.name,
            customerEmail: customers.email,
            customerBannedAt: customers.bannedAt,
            boardName: boards.name,
            boardSlug: boards.slug,
            settings: boards.settings,
          })
          .from(feedbackPosts)
          .leftJoin(boards, eq(feedbackPosts.boardId, boards.id))
          .leftJoin(customers, eq(feedbackPosts.authorCustomerId, customers.id))
          .where(
            and(
              inArray(feedbackPosts.id, postIds),
              eq(feedbackPosts.productId, input.productId),
            ),
          ),
    commentIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            id: feedbackComments.id,
            body: feedbackComments.body,
            authorName: feedbackComments.authorName,
            customerId: customers.id,
            customerName: customers.name,
            customerEmail: customers.email,
            customerBannedAt: customers.bannedAt,
            postId: feedbackPosts.id,
            postTitle: feedbackPosts.title,
            boardName: boards.name,
            boardSlug: boards.slug,
            settings: boards.settings,
          })
          .from(feedbackComments)
          .innerJoin(feedbackPosts, eq(feedbackComments.feedbackPostId, feedbackPosts.id))
          .leftJoin(boards, eq(feedbackPosts.boardId, boards.id))
          .leftJoin(customers, eq(feedbackComments.authorCustomerId, customers.id))
          .where(
            and(
              inArray(feedbackComments.id, commentIds),
              eq(feedbackComments.productId, input.productId),
            ),
          ),
  ]);

  const posts = new Map(postRows.map((post) => [post.id, post]));
  const comments = new Map(commentRows.map((comment) => [comment.id, comment]));

  const items: ModerationQueueItem[] = [];

  for (const review of reviews) {
    const common = {
      reviewId: review.id,
      status: statusValue(review.status),
      reasons: stringList(review.reasons),
      checks: checksValue(review.checks),
      createdAt: iso(review.created_at) ?? new Date(0).toISOString(),
      reviewedAt: iso(review.reviewed_at),
    };

    if (review.content_type === "feedback_post") {
      const post = posts.get(review.content_id);
      if (!post) continue;
      const settings = post.settings;
      const held = settings
        ? settings.moderation.requireApproval !== "none"
        : true;

      items.push({
        ...common,
        contentType: "feedback_post",
        contentId: post.id,
        title: post.title,
        body: post.body,
        authorName: post.customerName ?? post.authorLabel ?? "Anonymous",
        authorEmail: post.customerEmail,
        authorCustomerId: post.customerId,
        authorBanned: post.customerBannedAt !== null,
        boardName: post.boardName,
        boardSlug: post.boardSlug,
        postId: post.id,
        publicPath:
          post.boardSlug && post.boardName
            ? publicRequestPath(
                input.workspaceSlug,
                input.productSlug,
                post.boardSlug,
                post.id,
              )
            : null,
        held,
      });
    } else {
      const comment = comments.get(review.content_id);
      if (!comment) continue;
      const settings = comment.settings;
      const held = settings
        ? settings.moderation.comments === "moderated"
        : true;

      items.push({
        ...common,
        contentType: "feedback_comment",
        contentId: comment.id,
        title: `Comment on “${comment.postTitle}”`,
        body: comment.body,
        authorName: comment.customerName ?? comment.authorName,
        authorEmail: comment.customerEmail,
        authorCustomerId: comment.customerId,
        authorBanned: comment.customerBannedAt !== null,
        boardName: comment.boardName,
        boardSlug: comment.boardSlug,
        postId: comment.postId,
        publicPath:
          comment.boardSlug && comment.boardName
            ? publicRequestPath(
                input.workspaceSlug,
                input.productSlug,
                comment.boardSlug,
                comment.postId,
              )
            : null,
        held,
      });
    }
  }

  return items;
}

export async function getModerationCounts(
  productId: string,
): Promise<ModerationCounts> {
  const result = await db.execute(sql`
    SELECT latest.status::text AS status, count(*)::int AS count
    FROM (
      SELECT
        mr.content_type,
        mr.content_id,
        mr.status,
        row_number() OVER (
          PARTITION BY mr.content_type, mr.content_id
          ORDER BY mr.created_at DESC, mr.id DESC
        ) AS rn
      FROM moderation_reviews mr
      WHERE mr.product_id = ${productId}
    ) latest
    WHERE latest.rn = 1
    GROUP BY latest.status
  `);

  const counts: ModerationCounts = { pending: 0, approved: 0, rejected: 0 };
  for (const row of result.rows as unknown as { status: string; count: number }[]) {
    if (row.status === "pending" || row.status === "approved" || row.status === "rejected") {
      counts[row.status] = Number(row.count) || 0;
    }
  }
  return counts;
}
