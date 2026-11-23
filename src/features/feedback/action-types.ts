import type {
  FeedbackSavedViewFilters,
  FeedbackStatus,
} from "@/types";

export type FeedbackTargetInput = {
  workspaceSlug: string;
  productSlug: string;
  postId: string;
};

export type SetFeedbackStatusInput = FeedbackTargetInput & {
  status: FeedbackStatus;
};

export type LinkFeedbackInput = FeedbackTargetInput & {
  /** null removes the current link. */
  targetId: string | null;
};

export type AddFeedbackCommentInput = FeedbackTargetInput & {
  body: string;
  internal: boolean;
};

export type MergeFeedbackInput = FeedbackTargetInput & {
  targetId: string;
};

export type FeedbackVoteResult = {
  postId: string;
  voted: boolean;
  votes: number;
};

export type BulkFeedbackStatusInput = {
  workspaceSlug: string;
  productSlug: string;
  postIds: string[];
  status: FeedbackStatus;
};

export type BulkFeedbackHiddenInput = {
  workspaceSlug: string;
  productSlug: string;
  postIds: string[];
  hidden: boolean;
};

export type SetFeedbackAssigneeInput = FeedbackTargetInput & {
  /** null unassigns the request. */
  assigneeId: string | null;
};

export type BulkFeedbackAssigneeInput = {
  workspaceSlug: string;
  productSlug: string;
  postIds: string[];
  assigneeId: string | null;
};

export type BulkFeedbackTagInput = {
  workspaceSlug: string;
  productSlug: string;
  postIds: string[];
  tagId: string;
};

export type BulkFeedbackBoardInput = {
  workspaceSlug: string;
  productSlug: string;
  postIds: string[];
  boardId: string;
};

export type SaveFeedbackViewInput = {
  workspaceSlug: string;
  productSlug: string;
  name: string;
  filters: FeedbackSavedViewFilters;
};

export type DeleteFeedbackViewInput = {
  workspaceSlug: string;
  productSlug: string;
  viewId: string;
};
