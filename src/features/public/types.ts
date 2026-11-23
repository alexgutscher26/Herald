import type { BoardSettings } from "@/db/schema/boards";
import type { IntakeQuestionView } from "@/features/conversations/intake";
import type { PlanId } from "@/features/entitlements/plans";
import type { FeedbackPrivacy } from "@/lib/feedback-privacy";
import type { ReleaseTranslations } from "@/features/i18n/content";

/**
 * Public DTOs.
 *
 * These types are the contract for anything a visitor can read. They
 * deliberately have no email, customer traits, moderation reasons, internal
 * notes or session data — adding one of those requires an explicit type change
 * and a review, rather than accidentally serialising a database row.
 */

export type PublicFeedbackStatus =
  | "open"
  | "under_review"
  | "planned"
  | "in_progress"
  | "shipped"
  | "closed";

export type PublicFeedbackCategory =
  | "feature_request"
  | "bug"
  | "improvement"
  | "question";

export type PublicTag = {
  name: string;
  color: string | null;
};

export type PublicRequestSummary = {
  id: string;
  title: string;
  body: string;
  status: PublicFeedbackStatus;
  category: PublicFeedbackCategory;
  /** Audience the author chose; public rows render without a badge. */
  privacy: FeedbackPrivacy;
  authorName: string;
  createdAt: string;
  updatedAt: string;
  voteCount: number;
  commentCount: number;
  tags: PublicTag[];
};

export type PublicReactionKind = "like" | "love" | "celebrate";

/** One reaction kind on a request, with the current viewer's own state. */
export type PublicReaction = {
  kind: PublicReactionKind;
  count: number;
  reacted: boolean;
};

export type PublicComment = {
  id: string;
  authorName: string;
  authorType: "customer" | "team";
  body: string;
  privacy: FeedbackPrivacy;
  createdAt: string;
  /** Visible because the viewer wrote it, not because it is public yet. */
  pending: boolean;
  isAuthor: boolean;
};

export type PublicAttachment = {
  id: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  /** Short-lived signed download URL, generated per render. */
  url: string;
  isImage: boolean;
};

/** Another request, linked by a merge or suggested as similar. */
export type PublicLinkedRequest = {
  id: string;
  title: string;
  status: PublicFeedbackStatus;
  voteCount: number;
  boardSlug: string;
};

/** A duplicate suggestion, which may live on another board of the product. */
export type PublicSuggestion = PublicLinkedRequest & {
  boardSlug: string;
  boardName: string;
  excerpt: string;
};

export type PublicLinkedRelease = {
  id: string;
  title: string;
  slug: string;
  publishedAt: string | null;
};

/**
 * Why a request is being shown.
 *
 * `awaiting_review` is only ever returned to its author: it is the receipt for
 * a submission that moderation has not approved, not a public state.
 */
export type PublicRequestVisibility = "public" | "awaiting_review";

export type PublicRequestViewer = {
  /** A session exists for this workspace (guest or identified). */
  hasSession: boolean;
  /** The session carries an email; only this can post where guests may not. */
  identified: boolean;
  isAuthor: boolean;
  hasVoted: boolean;
  follows: boolean;
  /** The viewer belongs to a company, so company-only is an available audience. */
  hasCompany: boolean;
};

export type PublicRequestDetail = PublicRequestSummary & {
  comments: PublicComment[];
  attachments: PublicAttachment[];
  reactions: PublicReaction[];
  viewer: PublicRequestViewer;
  visibility: PublicRequestVisibility;
  /** Requests merged into this one, with their vote counts. */
  mergedRequests: PublicLinkedRequest[];
  similarRequests: PublicLinkedRequest[];
  /** Published releases that cite this request. */
  linkedReleases: PublicLinkedRelease[];
  /**
   * How many distinct customers asked for this, and over how many source
   * records. Counts only: the quotes and authors never leave the dashboard.
   */
  demand: { customers: number; sources: number };
  /**
   * The team's planned quarter or date, already filtered by the workspace
   * policy. Null means either unset or not disclosed publicly.
   */
  plannedFor: string | null;
};

export type PublicBoard = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  guestPosting: boolean;
  /** False when the board's comment policy is closed. */
  acceptsComments: boolean;
  /** New requests are held for moderation before they appear publicly. */
  requiresApproval: boolean;
  /** Optional branding chosen in board management. */
  icon: string | null;
  color: string | null;
};

export type PublicTenant = {
  workspace: { id: string; name: string; slug: string };
  product: { id: string; name: string; slug: string };
  board: PublicBoard;
};

export type PublicBoardSummary = {
  name: string;
  slug: string;
  description: string | null;
};

export type PublicBoardPagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type PublicPagination = PublicBoardPagination;

/**
 * A public board, its page of requests, and the facets the page filters by.
 *
 * `boards` and `tags` are derived from the same resolved board, so they can
 * never point a visitor at another product's board or a private one.
 */
export type PublicBoardPage = PublicTenant & {
  requests: PublicRequestSummary[];
  boards: PublicBoardSummary[];
  tags: PublicTag[];
  pagination: PublicBoardPagination;
  /** The product has published its roadmap; the board offers a link to it. */
  roadmapEnabled: boolean;
  /** The product has published its changelog; the board offers a link to it. */
  changelogEnabled: boolean;
};

/** The three public roadmap columns. Other feedback states are not published. */
export type PublicRoadmapStatus = "planned" | "in_progress" | "shipped";

export type PublicRoadmapCard = {
  id: string;
  title: string;
  status: PublicRoadmapStatus;
  voteCount: number;
  boardSlug: string;
  boardName: string;
};

export type PublicRoadmapColumn = {
  status: PublicRoadmapStatus;
  requests: PublicRoadmapCard[];
};

export type PublicRoadmapPage = {
  workspace: { name: string; slug: string };
  product: { name: string; slug: string; description: string | null };
  /** Public ordering only: recently updated or most voted. */
  sort: "recent" | "votes";
  roadmap: {
    name: string;
    slug: string | null;
    description: string | null;
    visibility: "public" | "unlisted";
  };
  /** Public views to offer in the switcher; unlisted views stay link-only. */
  roadmaps: { name: string; slug: string }[];
  columns: PublicRoadmapColumn[];
  /** Null when public feedback is off; the roadmap still renders without links. */
  firstBoard: { name: string; slug: string } | null;
  changelogEnabled: boolean;
};

export type PublicReleaseCategory = "feature" | "improvement" | "fix";

export type PublicChangelogAuthor = {
  id: string;
  name: string;
};

/**
 * Cover shape a public entry renders. Kept as a public DTO rather than
 * importing the dashboard's domain type: the public surface owns the exact
 * fields it will serialise.
 */
export type PublicReleaseCover =
  | { kind: "preset"; preset: "grid" | "orbit" | "waves" | "plain" }
  | { kind: "custom"; key: string; url: string | null }
  | { kind: "none" };

export type PublicChangelogSummary = {
  id: string;
  title: string;
  slug: string;
  summary: string;
  /** Every operator-authored locale; the fields above are the default. */
  translations: ReleaseTranslations;
  category: PublicReleaseCategory;
  publishedAt: string;
  cover: PublicReleaseCover;
  /** Uploaded Open Graph image; null uses the generated card. */
  ogImageUrl: string | null;
  tags: string[];
  authors: PublicChangelogAuthor[];
};

/** The tag or category a changelog index is filtered by. */
export type PublicChangelogFilter =
  | { kind: "tag"; tag: { name: string; slug: string } }
  | { kind: "category"; category: PublicReleaseCategory };

/** A linked request on a changelog entry, with viewer-specific pending state. */
export type PublicChangelogLinkedRequest = PublicLinkedRequest & {
  pending?: boolean;
};

export type PublicChangelogEntry = PublicChangelogSummary & {
  body: string;
  youtubeUrl: string | null;
  linkedRequests: PublicChangelogLinkedRequest[];
  /** Signed-in customers can react; guests see the counts read-only. */
  canReact: boolean;
  reactions: PublicReaction[];
  /** Nearby entries that share a tag or category, newest first. */
  related: PublicChangelogSummary[];
};

export type PublicChangelogPage = {
  workspace: { name: string; slug: string };
  product: { name: string; slug: string; description: string | null };
  entries: PublicChangelogSummary[];
  filter: PublicChangelogFilter | null;
  pagination: PublicPagination;
  /** First public board, for the feedback link; null when feedback is off. */
  boardSlug: string | null;
  roadmapEnabled: boolean;
};

export type PublicChangelogDetailPage = {
  workspace: { id: string; name: string; slug: string };
  product: { id: string; name: string; slug: string };
  entry: PublicChangelogEntry;
  boardSlug: string | null;
  roadmapEnabled: boolean;
};

export type PublicRequestPage = PublicTenant & {
  request: PublicRequestDetail;
};

/** A typed field the product asks for on every submission. */
export type PublicCustomField = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  type: "text" | "number" | "select" | "date";
  options: string[];
  required: boolean;
};

/** Everything the submit page needs: the board, the picker and the viewer. */
export type PublicSubmitPage = PublicTenant & {
  boards: PublicBoardSummary[];
  viewer: { hasSession: boolean; identified: boolean; hasCompany: boolean };
  /** The product opted in and the deployment has an AI provider. */
  aiRewriteEnabled: boolean;
  /** Active custom fields; archived ones are never requested again. */
  customFields: PublicCustomField[];
  /** Optional intake questions for this board; never required. */
  intakeQuestions: IntakeQuestionView[];
};

/** Internal resolver result. Board settings never leave the server. */
export type ResolvedPublicProduct = {
  workspace: {
    id: string;
    name: string;
    slug: string;
    plan: PlanId;
    /** Policy switch: only then may a request page show `plannedFor`. */
    publicPlannedFor: boolean;
  };
  product: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    publicFeedbackEnabled: boolean;
    publicRoadmapEnabled: boolean;
    publicChangelogEnabled: boolean;
    publicShippedCounterEnabled: boolean;
  };
};

export type ResolvedPublicBoard = ResolvedPublicProduct & {
  product: ResolvedPublicProduct["product"];
  board: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    guestPosting: boolean;
    icon: string | null;
    color: string | null;
    settings: BoardSettings;
  };
};
