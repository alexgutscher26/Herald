import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "@/db/schema/auth";
import { boardTags } from "@/db/schema/boards";
import { customers } from "@/db/schema/customers";
import { feedbackComments, feedbackPosts, feedbackStatusEnum } from "@/db/schema/feedback";
import { products, workspaces } from "@/db/schema/workspaces";

const tz = { withTimezone: true } as const;

export const feedbackFollowerSourceEnum = pgEnum("feedback_follower_source", [
  "board",
  "widget",
  "api",
  "import",
]);

export const feedbackReactionKindEnum = pgEnum("feedback_reaction_kind", [
  "like",
  "love",
  "celebrate",
]);

/** Kinds of bulk operation that keep enough state to be undone. */
export const feedbackBulkActionKindEnum = pgEnum("feedback_bulk_action_kind", [
  "status",
  "visibility",
  "assignee",
  "board",
  "tag",
]);

/**
 * The previous value of one request, captured before a bulk write.
 *
 * Only the fields the operation touched are stored, so an undo restores the
 * exact prior state rather than guessing a default. Tags are captured whole on
 * a board move because the move clears them.
 */
export type BulkUndoEntry = {
  postId: string;
  previousStatus?: string;
  previousHiddenAt?: string | null;
  previousHiddenBy?: string | null;
  previousAssigneeId?: string | null;
  previousBoardId?: string | null;
  previousTagIds?: string[];
  /** For a tag add: the tag that was attached and may need removing. */
  addedTagId?: string;
};

/**
 * One undoable bulk operation.
 *
 * The row is written in the same transaction as the change, so an undo can
 * never exist for a write that failed (or vice versa). `undone_at` makes undo
 * single-use; the row stays for audit, like a merge record.
 */
export const feedbackBulkActions = pgTable(
  "feedback_bulk_actions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    kind: feedbackBulkActionKindEnum("kind").notNull(),
    entries: jsonb("entries").$type<BulkUndoEntry[]>().notNull(),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    undoneAt: timestamp("undone_at", tz),
  },
  (t) => [
    index("feedback_bulk_actions_product_time_idx").on(t.productId, t.createdAt),
  ],
);

export const duplicateReviewStatusEnum = pgEnum("duplicate_review_status", [
  "pending",
  "merged",
  "dismissed",
]);

export const moderationContentTypeEnum = pgEnum("moderation_content_type", [
  "feedback_post",
  "feedback_comment",
]);

export const moderationReviewStatusEnum = pgEnum("moderation_review_status", [
  "pending",
  "approved",
  "rejected",
]);

export const feedbackInsightSourceEnum = pgEnum("feedback_insight_source", [
  "support",
  "chat",
  "email",
  "call",
  "note",
  "api",
  "import",
]);

/** Reference material attached to a request, not evidence of demand. */
export const feedbackContextKindEnum = pgEnum("feedback_context_kind", [
  "help_article",
  "changelog",
]);

/**
 * Outcome of the automated checks attached to a review.
 *
 * `unavailable` means the check could not run (for example no image-text
 * provider is configured); `error` means it ran and failed. Both are retryable
 * and neither is treated as a pass. Only finding labels are stored — never the
 * matched text.
 */
export type ModerationCheckStatus = "ok" | "flagged" | "unavailable" | "error";

export type ModerationChecks = {
  text?: ModerationCheckStatus;
  images?: {
    scanned: number;
    flagged: number;
    unavailable: number;
    errors: number;
  };
  checkedAt?: string;
};

/**
 * One piece of evidence behind a request.
 *
 * A support message, an email, a call quote or a team note, kept with its
 * source and the customer's own words. This is what makes "twenty-four people
 * asked" checkable instead of a number someone typed, and it is why a merge
 * must move evidence rather than close the duplicate and lose it.
 *
 * Insights are internal: no public projection reads this table. The composite
 * foreign key keeps an insight inside the product that owns its request.
 */
export const feedbackInsights = pgTable(
  "feedback_insights",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    feedbackPostId: uuid("feedback_post_id").notNull(),
    source: feedbackInsightSourceEnum("source").notNull().default("note"),
    /** Provider-neutral pointer: a conversation id, message id or call id. */
    sourceRef: text("source_ref"),
    /** The customer's own words, trimmed to a bounded length. */
    quote: text("quote").notNull(),
    authorCustomerId: uuid("author_customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    authorLabel: text("author_label"),
    occurredAt: timestamp("occurred_at", tz).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "feedback_insights_post_fk",
      columns: [t.feedbackPostId, t.productId],
      foreignColumns: [feedbackPosts.id, feedbackPosts.productId],
    }).onDelete("cascade"),
    index("feedback_insights_post_time_idx").on(t.feedbackPostId, t.occurredAt),
    index("feedback_insights_product_time_idx").on(t.productId, t.occurredAt),
    index("feedback_insights_customer_idx").on(t.authorCustomerId),
  ],
);

/**
 * A help-center article or changelog entry attached to a request as context.
 *
 * Context answers "what else should someone read before deciding?", while an
 * insight records what a customer said. They are separate tables because
 * context has no quote, author or demand weight: counting it as evidence would
 * inflate "N customers asked for this".
 *
 * `ref_id` is polymorphic (an article or a release), so it carries no foreign
 * key; the application checks that the target belongs to the same product
 * before inserting, and reads join on `kind` plus `product_id`.
 */
export const feedbackContextLinks = pgTable(
  "feedback_context_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    feedbackPostId: uuid("feedback_post_id").notNull(),
    kind: feedbackContextKindEnum("kind").notNull(),
    refId: uuid("ref_id").notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "feedback_context_links_post_fk",
      columns: [t.feedbackPostId, t.productId],
      foreignColumns: [feedbackPosts.id, feedbackPosts.productId],
    }).onDelete("cascade"),
    unique("feedback_context_links_unique").on(t.feedbackPostId, t.kind, t.refId),
    index("feedback_context_links_post_idx").on(t.feedbackPostId),
    index("feedback_context_links_ref_idx").on(t.kind, t.refId),
    index("feedback_context_links_product_idx").on(t.productId),
  ],
);

/**
 * Tags applied to a request.
 *
 * The composite foreign keys both include `product_id`, so a link can never
 * pair a post with a tag from another product (and therefore another board).
 */
export const feedbackTagLinks = pgTable(
  "feedback_tag_links",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    feedbackPostId: uuid("feedback_post_id").notNull(),
    tagId: uuid("tag_id").notNull(),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: "feedback_tag_links_pk",
      columns: [t.feedbackPostId, t.tagId],
    }),
    foreignKey({
      name: "feedback_tag_links_post_fk",
      columns: [t.feedbackPostId, t.productId],
      foreignColumns: [feedbackPosts.id, feedbackPosts.productId],
    }).onDelete("cascade"),
    foreignKey({
      name: "feedback_tag_links_tag_fk",
      columns: [t.tagId, t.productId],
      foreignColumns: [boardTags.id, boardTags.productId],
    }).onDelete("cascade"),
    index("feedback_tag_links_tag_idx").on(t.tagId),
    index("feedback_tag_links_product_idx").on(t.productId),
  ],
);

/**
 * Votes cast by public customers.
 *
 * Kept apart from `feedback_votes` because that table references dashboard
 * users (`user.id`) and a customer is a different principal. The unique
 * constraint is what makes a vote idempotent under concurrent requests; a
 * check-then-insert in application code would race.
 */
export const feedbackCustomerVotes = pgTable(
  "feedback_customer_votes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    feedbackPostId: uuid("feedback_post_id")
      .notNull()
      .references(() => feedbackPosts.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    /**
     * The operator who cast this vote on the customer's behalf, when applicable.
     *
     * The vote still belongs to the customer row, never to a second identity.
     * Keeping the operator here is what lets the dashboard explain and audit a
     * proxy vote, and prevents it from being deleted as if the customer had
     * cast it themselves.
     */
    castByUserId: text("cast_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("feedback_customer_votes_post_customer_unique").on(
      t.feedbackPostId,
      t.customerId,
    ),
    index("feedback_customer_votes_post_idx").on(t.feedbackPostId),
    index("feedback_customer_votes_customer_idx").on(t.customerId),
    index("feedback_customer_votes_cast_by_idx").on(t.castByUserId),
  ],
);

/**
 * Customers following a request for status-change and reply notifications.
 *
 * `source` records where the follow happened so unsubscribe/notification
 * preferences can be explained to the customer.
 */
export const feedbackFollowers = pgTable(
  "feedback_followers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    feedbackPostId: uuid("feedback_post_id")
      .notNull()
      .references(() => feedbackPosts.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    source: feedbackFollowerSourceEnum("source").notNull().default("board"),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("feedback_followers_post_customer_unique").on(
      t.feedbackPostId,
      t.customerId,
    ),
    index("feedback_followers_post_idx").on(t.feedbackPostId),
    index("feedback_followers_customer_idx").on(t.customerId),
  ],
);

/**
 * Emoji reactions on a request or on one of its comments.
 *
 * Exactly one target is set, enforced by a check constraint. Postgres unique
 * indexes treat NULLs as distinct, so de-duplication needs two partial unique
 * indexes rather than one composite index.
 */
export const feedbackReactions = pgTable(
  "feedback_reactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    feedbackPostId: uuid("feedback_post_id").references(() => feedbackPosts.id, {
      onDelete: "cascade",
    }),
    feedbackCommentId: uuid("feedback_comment_id").references(() => feedbackComments.id, {
      onDelete: "cascade",
    }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    kind: feedbackReactionKindEnum("kind").notNull().default("like"),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    check(
      "feedback_reactions_one_target_ck",
      sql`(${t.feedbackPostId} IS NULL) <> (${t.feedbackCommentId} IS NULL)`,
    ),
    uniqueIndex("feedback_reactions_post_customer_kind_unique")
      .on(t.feedbackPostId, t.customerId, t.kind)
      .where(sql`${t.feedbackPostId} IS NOT NULL`),
    uniqueIndex("feedback_reactions_comment_customer_kind_unique")
      .on(t.feedbackCommentId, t.customerId, t.kind)
      .where(sql`${t.feedbackCommentId} IS NOT NULL`),
    index("feedback_reactions_post_idx").on(t.feedbackPostId),
    index("feedback_reactions_comment_idx").on(t.feedbackCommentId),
    index("feedback_reactions_customer_idx").on(t.customerId),
  ],
);

/**
 * Uploaded files attached to a request or comment.
 *
 * The object itself lives in the storage provider; this row is the metadata
 * and the ownership record. `storage_key` is unique so one object cannot be
 * claimed by two rows. Exactly one target is set, and both composite foreign
 * keys keep the attachment inside its product.
 */
export const feedbackAttachments = pgTable(
  "feedback_attachments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    feedbackPostId: uuid("feedback_post_id"),
    feedbackCommentId: uuid("feedback_comment_id"),
    uploadedByCustomerId: uuid("uploaded_by_customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    storageKey: text("storage_key").notNull().unique(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    width: integer("width"),
    height: integer("height"),
    /** SHA-256 of the uploaded bytes, verified after upload. */
    checksum: text("checksum").notNull(),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    check(
      "feedback_attachments_one_target_ck",
      sql`(${t.feedbackPostId} IS NULL) <> (${t.feedbackCommentId} IS NULL)`,
    ),
    check(
      "feedback_attachments_storage_key_ck",
      sql`${t.storageKey} not like 'data:%' and ${t.storageKey} not like 'blob:%'`,
    ),
    foreignKey({
      name: "feedback_attachments_post_fk",
      columns: [t.feedbackPostId, t.productId],
      foreignColumns: [feedbackPosts.id, feedbackPosts.productId],
    }).onDelete("cascade"),
    foreignKey({
      name: "feedback_attachments_comment_fk",
      columns: [t.feedbackCommentId, t.productId],
      foreignColumns: [feedbackComments.id, feedbackComments.productId],
    }).onDelete("cascade"),
    index("feedback_attachments_post_idx").on(t.feedbackPostId),
    index("feedback_attachments_comment_idx").on(t.feedbackCommentId),
    index("feedback_attachments_product_idx").on(t.productId),
  ],
);

/**
 * Moderation queue entries.
 *
 * `contentId` points at a post or comment depending on `contentType`, so it is
 * intentionally polymorphic and cannot carry a foreign key. The application
 * must re-check that the target still belongs to `productId` when reviewing.
 */
export const moderationReviews = pgTable(
  "moderation_reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    contentType: moderationContentTypeEnum("content_type").notNull(),
    contentId: uuid("content_id").notNull(),
    status: moderationReviewStatusEnum("status").notNull().default("pending"),
    /** Machine-readable flags (spam, abuse, sensitive_info, …). */
    reasons: jsonb("reasons").$type<string[]>().notNull().default([]),
    /** Per-check outcome, so a failed image scan can be retried. */
    checks: jsonb("checks").$type<ModerationChecks>().notNull().default({}),
    reviewedBy: text("reviewed_by").references(() => user.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", tz),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    index("moderation_reviews_product_status_idx").on(t.productId, t.status, t.createdAt),
    index("moderation_reviews_content_idx").on(t.contentType, t.contentId),
  ],
);

/**
 * One row per merge, kept so the operation can be undone.
 *
 * The id arrays record exactly which rows moved. A row that already existed on
 * the target (the same person voting, following or reacting on both requests)
 * is a genuine duplicate and is deleted instead of moved, so unmerge restores
 * everything this merge moved and never duplicates engagement.
 */
export const feedbackMerges = pgTable(
  "feedback_merges",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    sourcePostId: uuid("source_post_id")
      .notNull()
      .references(() => feedbackPosts.id, { onDelete: "cascade" }),
    targetPostId: uuid("target_post_id")
      .notNull()
      .references(() => feedbackPosts.id, { onDelete: "cascade" }),
    /** The source's status before the merge closed it. */
    sourceStatus: feedbackStatusEnum("source_status").notNull(),
    movedCommentIds: uuid("moved_comment_ids").array().notNull().default(sql`'{}'::uuid[]`),
    movedAttachmentIds: uuid("moved_attachment_ids").array().notNull().default(sql`'{}'::uuid[]`),
    movedVoteIds: text("moved_vote_ids").array().notNull().default(sql`'{}'::text[]`),
    movedCustomerVoteIds: uuid("moved_customer_vote_ids").array().notNull().default(sql`'{}'::uuid[]`),
    movedReactionIds: uuid("moved_reaction_ids").array().notNull().default(sql`'{}'::uuid[]`),
    movedFollowerIds: uuid("moved_follower_ids").array().notNull().default(sql`'{}'::uuid[]`),
    movedTagIds: uuid("moved_tag_ids").array().notNull().default(sql`'{}'::uuid[]`),
    movedInsightIds: uuid("moved_insight_ids").array().notNull().default(sql`'{}'::uuid[]`),
    /**
     * Legacy history only. The roadmap item tables were retired in migration
     * `0012`; current merges leave this empty and unmerge no longer replays it.
     */
    movedRoadmapItemIds: uuid("moved_roadmap_item_ids").array().notNull().default(sql`'{}'::uuid[]`),
    /** Imported vote total moved onto the canonical request. */
    movedImportedVotes: integer("moved_imported_votes").notNull().default(0),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    /** True when the duplicate mode, not a person, performed the merge. */
    automatic: boolean("automatic").notNull().default(false),
    undoneAt: timestamp("undone_at", tz),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    index("feedback_merges_source_idx").on(t.sourcePostId, t.createdAt),
    index("feedback_merges_target_idx").on(t.targetPostId),
    index("feedback_merges_product_idx").on(t.productId),
  ],
);

/**
 * Blocks by customer id or by normalized email.
 *
 * An email block covers a person who has not signed in yet; a customer block
 * survives email changes. At least one identifier is required, and the partial
 * unique indexes prevent duplicate active blocks for the same identifier.
 * A block is workspace-wide, not board-specific.
 */
export const blockedCustomers = pgTable(
  "blocked_customers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "cascade",
    }),
    emailNormalized: text("email_normalized"),
    reason: text("reason"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    check(
      "blocked_customers_identity_ck",
      sql`${t.customerId} IS NOT NULL OR ${t.emailNormalized} IS NOT NULL`,
    ),
    uniqueIndex("blocked_customers_workspace_customer_unique")
      .on(t.workspaceId, t.customerId)
      .where(sql`${t.customerId} IS NOT NULL`),
    uniqueIndex("blocked_customers_workspace_email_unique")
      .on(t.workspaceId, t.emailNormalized)
      .where(sql`${t.emailNormalized} IS NOT NULL`),
    index("blocked_customers_workspace_created_idx").on(t.workspaceId, t.createdAt),
  ],
);

/**
 * A duplicate suggestion that needs, or received, a human decision.
 *
 * Confident automatic merges also get a row with `status = merged`, so the
 * provenance is in the same queue the team reviews. The link to
 * `feedback_merges` is what makes the existing unmerge path authoritative.
 */
export const duplicateReviews = pgTable(
  "duplicate_reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    sourcePostId: uuid("source_post_id")
      .notNull()
      .references(() => feedbackPosts.id, { onDelete: "cascade" }),
    targetPostId: uuid("target_post_id")
      .notNull()
      .references(() => feedbackPosts.id, { onDelete: "cascade" }),
    /** Blended lexical score that produced the decision. */
    score: real("score").notNull(),
    /** ``assisted`` or ``automatic``; text keeps the queue forward-compatible. */
    mode: text("mode").notNull(),
    status: duplicateReviewStatusEnum("status").notNull().default("pending"),
    mergeId: uuid("merge_id").references(() => feedbackMerges.id, {
      onDelete: "set null",
    }),
    resolvedBy: text("resolved_by").references(() => user.id, {
      onDelete: "set null",
    }),
    resolvedAt: timestamp("resolved_at", tz),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("duplicate_reviews_pending_unique")
      .on(t.sourcePostId, t.targetPostId)
      .where(sql`${t.status} = 'pending'`),
    index("duplicate_reviews_product_status_idx").on(
      t.productId,
      t.status,
      t.createdAt,
    ),
    index("duplicate_reviews_source_idx").on(t.sourcePostId),
    check(
      "duplicate_reviews_mode_ck",
      sql`${t.mode} in ('assisted', 'automatic')`,
    ),
    check(
      "duplicate_reviews_score_ck",
      sql`${t.score} >= 0 AND ${t.score} <= 1`,
    ),
  ],
);

export type DuplicateReview = typeof duplicateReviews.$inferSelect;
export type NewDuplicateReview = typeof duplicateReviews.$inferInsert;

export type FeedbackInsight = typeof feedbackInsights.$inferSelect;
export type NewFeedbackInsight = typeof feedbackInsights.$inferInsert;
export type FeedbackContextLink = typeof feedbackContextLinks.$inferSelect;
export type NewFeedbackContextLink = typeof feedbackContextLinks.$inferInsert;
export type FeedbackMerge = typeof feedbackMerges.$inferSelect;
export type NewFeedbackMerge = typeof feedbackMerges.$inferInsert;
export type FeedbackBulkAction = typeof feedbackBulkActions.$inferSelect;
export type NewFeedbackBulkAction = typeof feedbackBulkActions.$inferInsert;
export type FeedbackTagLink = typeof feedbackTagLinks.$inferSelect;
export type FeedbackCustomerVote = typeof feedbackCustomerVotes.$inferSelect;
export type NewFeedbackCustomerVote = typeof feedbackCustomerVotes.$inferInsert;
export type NewFeedbackTagLink = typeof feedbackTagLinks.$inferInsert;
export type FeedbackFollower = typeof feedbackFollowers.$inferSelect;
export type NewFeedbackFollower = typeof feedbackFollowers.$inferInsert;
export type FeedbackReaction = typeof feedbackReactions.$inferSelect;
export type NewFeedbackReaction = typeof feedbackReactions.$inferInsert;
export type FeedbackAttachment = typeof feedbackAttachments.$inferSelect;
export type NewFeedbackAttachment = typeof feedbackAttachments.$inferInsert;
export type ModerationReview = typeof moderationReviews.$inferSelect;
export type NewModerationReview = typeof moderationReviews.$inferInsert;
export type BlockedCustomer = typeof blockedCustomers.$inferSelect;
export type NewBlockedCustomer = typeof blockedCustomers.$inferInsert;
