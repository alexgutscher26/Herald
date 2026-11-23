/**
 * Shared domain types for the dashboard UI.
 *
 * These are the serialisable shapes the database queries expose to client
 * components (ISO date strings, no class instances). Production tables live in
 * `src/db/schema/*`; these types mirror their columns without importing the
 * database layer into client components.
 */

import type { WorkspaceRole } from "@/lib/permissions";
import type { ReleaseTranslations } from "@/features/i18n/content";
import type {
  CustomerSegment,
  SegmentFacet,
  SegmentFilter,
} from "@/features/public/segments";

export type {
  CustomerSegment,
  SegmentFacet,
  SegmentFacetKind,
  SegmentFilter,
} from "@/features/public/segments";

export type ISODate = string;

export type SessionUser = {
  id: string;
  name: string;
  email: string;
};

/* -------------------------------------------------------------------------- */
/* Workspace & product                                                        */
/* -------------------------------------------------------------------------- */

export type Workspace = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  createdAt: ISODate;
};

/** The current user's membership in one workspace. */
export type WorkspaceMember = {
  workspaceId: string;
  email: string;
  role: WorkspaceRole;
};

export type Product = {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  description: string;
  /** Default accent used by local cover artwork; not a stored user setting. */
  accentColor: string;
  /** Product-level public switches; independent of each other. */
  publicFeedbackEnabled: boolean;
  publicRoadmapEnabled: boolean;
  publicChangelogEnabled: boolean;
  createdAt: ISODate;
};

/** A teammate who can be credited as a changelog author. */
export type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: WorkspaceRole;
};

/* -------------------------------------------------------------------------- */
/* Releases                                                                   */
/* -------------------------------------------------------------------------- */

export type ReleaseStatus = "draft" | "scheduled" | "published" | "archived";
export type ReleaseCategory = "feature" | "improvement" | "fix";
export type CoverPreset = "grid" | "orbit" | "waves" | "plain";

export type ReleaseCover =
  | { kind: "preset"; preset: CoverPreset }
  | {
      kind: "custom";
      /** Storage key of the uploaded image; the only persisted field. */
      key: string;
      /** Short-lived signed URL resolved at read time; never persisted. */
      url?: string | null | undefined;
    }
  | { kind: "none" };

export type ReleaseChannels = {
  publicChangelog: boolean;
  inAppWidget: boolean;
  subscriberEmail: boolean;
};

/** Optional uploaded Open Graph image; `url` is resolved at read time. */
export type ReleaseSocialImage = {
  key: string;
  url?: string | null | undefined;
};

export type ReleaseAuthor = {
  id: string;
  name: string;
};

export type Release = {
  id: string;
  productId: string;
  title: string;
  slug: string;
  summary: string;
  body: string;
  /** Operator-authored locale variants, keyed by content locale. */
  translations: ReleaseTranslations;
  category: ReleaseCategory;
  status: ReleaseStatus;
  cover: ReleaseCover;
  /** Uploaded social-share image, or null to keep the generated card. */
  ogImage: ReleaseSocialImage | null;
  channels: ReleaseChannels;
  publishedAt: ISODate | null;
  scheduledFor: ISODate | null;
  createdAt: ISODate;
  updatedAt: ISODate;
  /** Primary byline, kept for list rows and older callers. */
  authorName: string;
  /** Ordered credits; the first is `authorName`. */
  authors: ReleaseAuthor[];
  /** Product-scoped changelog tags, display form. */
  tags: string[];
  /** Normalized YouTube URL, or null when the entry has no video. */
  youtubeUrl: string | null;
  linkedFeedbackIds: string[];
  linkedCancellationReasonIds: string[];
};

/* -------------------------------------------------------------------------- */
/* Feedback                                                                   */
/* -------------------------------------------------------------------------- */

export type FeedbackStatus =
  | "new"
  | "under_review"
  | "planned"
  | "in_progress"
  | "shipped"
  | "closed";

export type FeedbackCategory = "feature_request" | "bug" | "improvement" | "question";

/** Attention views derived from stored reply and status timestamps. */
export type FeedbackAttentionFilter =
  | "all"
  | "no_reply_7d"
  | "planned_stale_30d";

export type FeedbackViewSort =
  | "newest"
  | "oldest"
  | "votes"
  | "priority"
  | "impact"
  | "value_effort"
  | "requester_weight"
  | "revenue";

/** A product custom field plus the direction its values should be ordered. */
export type FeedbackCustomFieldSort = {
  key: string;
  direction: "asc" | "desc";
};

/** The inbox filters a saved view restores. */
export type FeedbackSavedViewFilters = {
  search: string;
  status: FeedbackStatus | "all";
  category: FeedbackCategory | "all";
  sort: FeedbackViewSort;
  /**
   * Sort by a custom field instead of `sort`; missing means `sort` wins.
   * Optional because views saved before this existed carry no such key.
   */
  customFieldSort?: FeedbackCustomFieldSort | null;
  /**
   * Field key → expected value; every entry must match. Optional because views
   * saved before custom fields existed carry no such key.
   */
  customFields?: Record<string, string>;
  /** Minimum computed priority score; null or missing means no score filter. */
  minScore?: number | null;
  /** One stored requester trait; null or missing means every requester. */
  segment?: SegmentFilter | null;
  /**
   * "all", "me", "unassigned" or a member id. Optional because views saved
   * before assignment existed carry no such key.
   */
  assignee?: string;
  /** Attention view; missing means every request. */
  stale?: FeedbackAttentionFilter;
};

/** A member's private saved inbox view inside one product. */
export type FeedbackSavedView = {
  id: string;
  productId: string;
  name: string;
  filters: FeedbackSavedViewFilters;
  createdAt: ISODate;
  updatedAt: ISODate;
};

import type { FeedbackPrivacy } from "@/lib/feedback-privacy";

/** Audience of a request or comment outside the dashboard. */
export type { FeedbackPrivacy };

export type FeedbackPost = {
  id: string;
  productId: string;
  boardId: string | null;
  title: string;
  description: string;
  category: FeedbackCategory;
  status: FeedbackStatus;
  privacy: FeedbackPrivacy;
  authorName: string;
  authorEmail: string;
  authorCustomerId: string | null;
  authorBanned: boolean;
  company: string | null;
  createdAt: ISODate;
  updatedAt: ISODate;
  releaseId: string | null;
  /** Set when this request was merged into another request. */
  mergedIntoId: string | null;
  /** Set by a moderator to hide the request from the public surface. */
  hiddenAt: ISODate | null;
  /** Workspace member responsible for the request; null means unassigned. */
  assigneeId: string | null;
  assigneeName: string | null;
  /** Quarter (`2027-Q1`) or date (`2027-03-31`); public only by policy. */
  plannedFor: string | null;
  /** Pre-rewrite wording, set only when the customer accepted an AI rewrite. */
  originalTitle: string | null;
  originalBody: string | null;
  /** The request this one was confirmed as a split from. */
  splitFromId: string | null;
};

export type FeedbackTag = {
  id: string;
  boardId: string;
  productId: string;
  name: string;
  color: string | null;
  position: number;
};

export type FeedbackTagLink = {
  postId: string;
  tagId: string;
};

export type FeedbackVote = {
  id: string;
  productId: string;
  postId: string;
  voterKey: string;
  voterName: string;
  /**
   * A customer vote counts towards requester weight; a team vote does not,
   * because teammates are not the people asking for the change.
   */
  voterType: "team" | "customer";
  createdAt: ISODate;
};

export type FeedbackComment = {
  id: string;
  productId: string;
  postId: string;
  authorName: string;
  authorType: "customer" | "team";
  /** Set for a public customer's comment; null for a team note. */
  authorCustomerId: string | null;
  body: string;
  /** Internal notes are never shown on public surfaces. */
  internal: boolean;
  privacy: FeedbackPrivacy;
  createdAt: ISODate;
};

/* -------------------------------------------------------------------------- */
/* Custom fields and prioritisation                                           */
/* -------------------------------------------------------------------------- */

export type CustomFieldType = "text" | "number" | "select" | "date";

/** A typed field every request in a product can carry. */
export type CustomFieldDefinition = {
  id: string;
  productId: string;
  /** Stable machine name used by filters and the API. */
  key: string;
  label: string;
  description: string | null;
  type: CustomFieldType;
  /** Allowed values for `select`; empty for other types. */
  options: string[];
  required: boolean;
  position: number;
  archivedAt: ISODate | null;
};

/** One stored value, already coerced to the field's type. */
export type CustomFieldValue = {
  postId: string;
  fieldId: string;
  value: string | number;
};

/** The team's stored inputs; any of the three can be unset. */
export type FeedbackPrioritisation = {
  postId: string;
  impact: number | null;
  businessValue: number | null;
  effort: number | null;
};

/**
 * Every number here is derived from stored rows by
 * `src/features/feedback/prioritisation.ts`; nothing is a placeholder.
 */
export type PrioritySignals = {
  impact: number | null;
  businessValue: number | null;
  effort: number | null;
  /** `businessValue / effort`, null until both inputs exist. */
  valuePerEffort: number | null;
  /** Distinct customers who authored, voted on, commented on or follow it. */
  requesterCount: number;
  /**
   * Known annual revenue: an ARR/MRR trait, else the CRM annual-revenue cache.
   * Null when neither source knows a number.
   */
  knownArr: number | null;
  /** Open CRM deal value across the same companies; null when unknown. */
  knownOpenDealValue: number | null;
  /** One per requester plus one per whole revenue unit of known revenue. */
  requesterWeight: number;
  /**
   * `impact ÷ effort × demand`, where demand is `requesterWeight` (at least 1).
   * Null until impact and effort are both stored.
   */
  priorityScore: number | null;
};

/** One customer's known company revenue, in dollars. */
export type CustomerRevenue = {
  customerId: string;
  companyId: string;
  companyName: string;
  /** ARR/MRR trait, else CRM annual revenue; null when neither is known. */
  annualRevenue: number | null;
  /** Open CRM deal value; null when the CRM stored none. */
  openDealValue: number | null;
  /** Annual revenue when known, otherwise open deal value. */
  weightBasis: number | null;
};



/** One piece of evidence behind a request, as the dashboard renders it. */
export type FeedbackInsight = {
  id: string;
  productId: string;
  postId: string;
  quote: string;
  source: "support" | "chat" | "email" | "call" | "note" | "api" | "import";
  sourceRef: string | null;
  authorLabel: string | null;
  authorCustomerId: string | null;
  occurredAt: ISODate;
  createdAt: ISODate;
};

/** A help-center article or changelog entry attached as context. */
export type FeedbackContextLink = {
  id: string;
  postId: string;
  kind: "help_article" | "changelog";
  refId: string;
  label: string | null;
  createdAt: ISODate;
};

/** Minimal article choice for the context picker. */
export type HelpArticleOption = {
  id: string;
  title: string;
  status: string;
};

/** A customer following a request, used only to count distinct requesters. */
export type FeedbackFollowerKey = {
  postId: string;
  customerId: string;
};

/* -------------------------------------------------------------------------- */
/* Cancellation reasons                                                       */
/* -------------------------------------------------------------------------- */

export type CancellationReason = {
  id: string;
  productId: string;
  label: string;
  description: string;
  createdAt: ISODate;
};

/* -------------------------------------------------------------------------- */
/* Dashboard snapshot                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Serialisable snapshot a server layout passes to the client shell.
 *
 * Only records that have a Drizzle query are present. Sections without a
 * database implementation render an explicit "not implemented" page rather
 * than receiving placeholder rows.
 */
export type DashboardState = {
  currentUser: SessionUser;
  /** Request time used for relative timestamps. */
  liveNow: ISODate;
  /** Active subscriber totals, loaded as an aggregate instead of full rows. */
  activeSubscriberCounts: Record<string, number>;
  workspaces: Workspace[];
  workspaceMembers: WorkspaceMember[];
  /** Members of the current workspace, for changelog author credits. */
  teamMembers: TeamMember[];
  products: Product[];
  releases: Release[];
  feedbackPosts: FeedbackPost[];
  feedbackVotes: FeedbackVote[];
  feedbackComments: FeedbackComment[];
  feedbackTags: FeedbackTag[];
  feedbackTagLinks: FeedbackTagLink[];
  /** Typed per-product fields, including archived ones for display. */
  feedbackCustomFields: CustomFieldDefinition[];
  feedbackCustomFieldValues: CustomFieldValue[];
  /** Stored team inputs for impact, value and effort. */
  feedbackPrioritisation: FeedbackPrioritisation[];
  /** Followers, so requester weight counts the same person once. */
  feedbackFollowers: FeedbackFollowerKey[];
  /** Evidence attached to requests, both customer-quoted and contextual. */
  feedbackInsights: FeedbackInsight[];
  feedbackContextLinks: FeedbackContextLink[];
  /** Help-center articles available to attach as context on this product. */
  helpArticles: HelpArticleOption[];
  /** Known company revenue for customers attached to this product. */
  customerRevenue: CustomerRevenue[];
  /** Requester traits, so the inbox can filter requests by segment. */
  customerSegments: CustomerSegment[];
  /** Distinct stored trait values the inbox offers as segment filters. */
  segmentFacets: SegmentFacet[];
  /** Saved inbox views belonging to the current member only. */
  feedbackSavedViews: FeedbackSavedView[];
  cancellationReasons: CancellationReason[];
};
