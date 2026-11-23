import type { ModerationChecks } from "@/db/schema";

/** Review states a moderator sees. `all` is a filter, never a stored state. */
export type ModerationQueueStatus = "pending" | "approved" | "rejected" | "all";

export type ModerationQueueItem = {
  reviewId: string;
  contentType: "feedback_post" | "feedback_comment";
  contentId: string;
  status: "pending" | "approved" | "rejected";
  reasons: string[];
  checks: ModerationChecks;
  createdAt: string;
  reviewedAt: string | null;
  title: string;
  body: string;
  authorName: string;
  authorEmail: string | null;
  /** Null for imported or anonymous content that has no customer row. */
  authorCustomerId: string | null;
  authorBanned: boolean;
  boardName: string | null;
  boardSlug: string | null;
  postId: string | null;
  publicPath: string | null;
  /** The content is held because its board requires approval. */
  held: boolean;
};

export type ModerationCounts = {
  pending: number;
  approved: number;
  rejected: number;
};

export type ModerationAction =
  | "approve"
  | "publish"
  | "keep"
  | "keep_hidden"
  | "delete";
