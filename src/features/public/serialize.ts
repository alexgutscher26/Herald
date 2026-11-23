import type { BoardModerationSettings } from "@/db/schema/boards";
import {
  isFeedbackPrivacy,
  type FeedbackPrivacy,
} from "@/lib/feedback-privacy";

import type {
  PublicComment,
  PublicFeedbackCategory,
  PublicFeedbackStatus,
  PublicRequestSummary,
  PublicTag,
} from "./types";

/**
 * Pure serializers for public projections.
 *
 * Inputs are explicit row shapes rather than database rows: a public response
 * can only contain the fields listed here. Password hashes, emails, traits,
 * moderation reasons and internal notes have no place to go.
 */

export type ModerationStatus = "pending" | "approved" | "rejected";

export type PublicRequestSource = {
  id: string;
  title: string;
  body: string;
  status: string;
  category: string;
  privacy: string;
  authorLabel: string | null;
  customerName: string | null;
  customerBannedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  voteCount: number;
  commentCount: number;
  tags: PublicTag[];
  latestModeration: ModerationStatus | null;
};

export type PublicCommentSource = {
  id: string;
  authorName: string;
  authorType: string;
  body: string;
  privacy: string;
  createdAt: Date;
  latestModeration: ModerationStatus | null;
  /** Visible only because the viewer wrote it, not because it passed review. */
  pending?: boolean;
  isAuthor?: boolean;
};

const STATUSES: PublicFeedbackStatus[] = [
  "open",
  "under_review",
  "planned",
  "in_progress",
  "shipped",
  "closed",
];

const CATEGORIES: PublicFeedbackCategory[] = [
  "feature_request",
  "bug",
  "improvement",
  "question",
];

export function toPublicStatus(value: string): PublicFeedbackStatus {
  // Compatibility for a database that has not run the six-state migration yet.
  if (value === "declined") return "closed";
  return STATUSES.includes(value as PublicFeedbackStatus)
    ? (value as PublicFeedbackStatus)
    : "open";
}

export function toPublicCategory(value: string): PublicFeedbackCategory {
  return CATEGORIES.includes(value as PublicFeedbackCategory)
    ? (value as PublicFeedbackCategory)
    : "question";
}

/** Existing rows default to public; an unknown value never widens the audience. */
export function toPublicPrivacy(value: string): FeedbackPrivacy {
  return isFeedbackPrivacy(value) ? value : "public";
}

export function publicAuthorName(source: {
  authorLabel: string | null;
  customerName: string | null;
}): string {
  return source.customerName ?? source.authorLabel ?? "Anonymous";
}

/**
 * Whether a request is visible on a public board.
 *
 * A rejected review hides content even on an unmoderated board. When approval
 * is required, only an approved review makes the request visible. `first_time`
 * is treated conservatively like `all` until author history is available;
 * showing unmoderated content would be the unsafe default.
 */
export function isPubliclyVisible(
  requireApproval: BoardModerationSettings["requireApproval"],
  latestModeration: ModerationStatus | null,
): boolean {
  if (latestModeration === "rejected") return false;
  if (requireApproval === "none") return true;
  return latestModeration === "approved";
}

export function isPublicCommentVisible(
  commentsPolicy: BoardModerationSettings["comments"],
  latestModeration: ModerationStatus | null,
): boolean {
  if (latestModeration === "rejected") return false;
  if (commentsPolicy === "moderated") return latestModeration === "approved";
  return true;
}

export function toPublicRequestSummary(source: PublicRequestSource): PublicRequestSummary {
  return {
    id: source.id,
    title: source.title,
    body: source.body,
    status: toPublicStatus(source.status),
    category: toPublicCategory(source.category),
    privacy: toPublicPrivacy(source.privacy),
    authorName: publicAuthorName(source),
    createdAt: source.createdAt.toISOString(),
    updatedAt: source.updatedAt.toISOString(),
    voteCount: source.voteCount,
    commentCount: source.commentCount,
    tags: source.tags.map((tag) => ({ name: tag.name, color: tag.color })),
  };
}

export function toPublicComment(source: PublicCommentSource): PublicComment {
  return {
    id: source.id,
    authorName: source.authorName,
    authorType: source.authorType === "customer" ? "customer" : "team",
    body: source.body,
    privacy: toPublicPrivacy(source.privacy),
    createdAt: source.createdAt.toISOString(),
    pending: source.pending ?? false,
    isAuthor: source.isAuthor ?? false,
  };
}
