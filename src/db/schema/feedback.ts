import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { user } from "@/db/schema/auth";
import { boards } from "@/db/schema/boards";
import { customers } from "@/db/schema/customers";
import { feedbackImports } from "@/db/schema/imports";
import { products } from "@/db/schema/workspaces";

const tz = { withTimezone: true } as const;

export const feedbackStatusEnum = pgEnum("feedback_status", [
  "open",
  "under_review",
  "planned",
  "in_progress",
  "shipped",
  "closed",
]);

export const feedbackSourceEnum = pgEnum("feedback_source", [
  "in_app",
  "email",
  "support",
  "import",
  "slack",
  "other",
]);

export const feedbackCategoryEnum = pgEnum("feedback_category", [
  "feature_request",
  "bug",
  "improvement",
  "question",
]);

export const feedbackCommentAuthorTypeEnum = pgEnum("feedback_comment_author_type", [
  "customer",
  "team",
]);

/**
 * Who may read a request or comment once it leaves the dashboard.
 *
 * `public` is the only value that reaches anonymous visitors and the default
 * for every existing row. `author` limits a row to the customer who wrote it;
 * `company` widens that to customers who share a company membership with the
 * author. Company membership is checked live, so removing someone from a
 * company revokes their access without rewriting rows.
 */
export const feedbackPrivacyEnum = pgEnum("feedback_privacy", [
  "public",
  "author",
  "company",
]);

export const feedbackPosts = pgTable(
  "feedback_posts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /**
     * Nullable until the board backfill assigns every existing post to its
     * product's default board. New posts should always set it.
     */
    boardId: uuid("board_id").references(() => boards.id, { onDelete: "set null" }),
    /** Authenticated workspace member who filed it, when known. */
    authorId: text("author_id").references(() => user.id, { onDelete: "set null" }),
    /** Public customer who filed it; team attribution stays in `author_id`. */
    authorCustomerId: uuid("author_customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    /** Free-text author for imported/support-sourced feedback. Never used for auth. */
    authorLabel: text("author_label"),
    authorEmail: text("author_email"),
    authorCompany: text("author_company"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    /**
     * Votes that arrived with an import.
     *
     * Other tools export a vote count, not the voters. The original total is
     * kept on the post and added to the real team/customer votes, so the public
     * number matches what the team migrated instead of silently dropping it.
     */
    importedVoteCount: integer("imported_vote_count").notNull().default(0),
    /** Set when the row was produced by a CSV import, for provenance. */
    importId: uuid("import_id").references(() => feedbackImports.id, {
      onDelete: "set null",
    }),
    importRowNumber: integer("import_row_number"),
    category: feedbackCategoryEnum("category").notNull().default("question"),
    status: feedbackStatusEnum("status").notNull().default("open"),
    source: feedbackSourceEnum("source").notNull().default("other"),
    privacy: feedbackPrivacyEnum("privacy").notNull().default("public"),
    /** Pre-rewrite wording, kept when the customer accepted an AI rewrite. */
    originalTitle: text("original_title"),
    originalBody: text("original_body"),
    /** Set when this request was confirmed as a split from another request. */
    splitFromId: uuid("split_from_id").references(
      (): AnyPgColumn => feedbackPosts.id,
      { onDelete: "set null" },
    ),
    /** Set when this request is merged into another request of the same product. */
    mergedIntoId: uuid("merged_into_id").references(
      (): AnyPgColumn => feedbackPosts.id,
      { onDelete: "set null" },
    ),
    archivedAt: timestamp("archived_at", tz),
    /**
     * When the team intends to ship this, as a quarter (`2027-Q1`) or a date
     * (`2027-03-31`). Stored regardless of policy; the workspace decides
     * whether public request pages may show it.
     */
    plannedFor: text("planned_for"),
    /** Set by a moderator to hide one request without deleting or rejecting it. */
    hiddenAt: timestamp("hidden_at", tz),
    hiddenBy: text("hidden_by").references(() => user.id, { onDelete: "set null" }),
    /**
     * Workspace member responsible for this request; null means unassigned.
     *
     * Assignment does not change status or visibility. It exists so the inbox
     * can answer "what is mine" and so a request has an owner before it ships.
     */
    assigneeId: text("assignee_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    // FK target so join tables (and comments) can assert "same product".
    unique("feedback_posts_id_product_unique").on(t.id, t.productId),
    index("feedback_posts_product_status_idx").on(t.productId, t.status),
    index("feedback_posts_product_created_idx").on(t.productId, t.createdAt),
    index("feedback_posts_board_status_idx").on(t.boardId, t.status),
    index("feedback_posts_board_created_idx").on(t.boardId, t.createdAt),
    index("feedback_posts_author_idx").on(t.authorId),
    index("feedback_posts_author_customer_idx").on(t.authorCustomerId),
    index("feedback_posts_product_assignee_idx").on(t.productId, t.assigneeId),
    index("feedback_posts_merged_into_idx").on(t.mergedIntoId),
    index("feedback_posts_split_from_idx").on(t.splitFromId),
    index("feedback_posts_board_hidden_idx").on(t.boardId, t.hiddenAt),
    check(
      "feedback_posts_original_pair_ck",
      sql`(${t.originalTitle} IS NULL) = (${t.originalBody} IS NULL)`,
    ),
    check(
      "feedback_posts_planned_for_ck",
      sql`${t.plannedFor} IS NULL OR ${t.plannedFor} ~ '^[0-9]{4}-(Q[1-4]|[0-9]{2}-[0-9]{2})$'`,
    ),
    // Makes an import retry idempotent: a worker that inserted the post but
    // crashed before marking the row cannot insert it a second time.
    uniqueIndex("feedback_posts_import_row_unique")
      .on(t.importId, t.importRowNumber)
      .where(sql`${t.importId} IS NOT NULL`),
  ],
);

/**
 * Status transitions for the funnel and time-to-ship metric.
 *
 * The trigger in migration 0032 writes this table for every status change,
 * including changes made by the API, imports, merges and release publishing.
 * Keeping history beside the post means no caller can silently bypass it.
 */
export const feedbackStatusHistory = pgTable(
  "feedback_status_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    feedbackPostId: uuid("feedback_post_id")
      .notNull()
      .references(() => feedbackPosts.id, { onDelete: "cascade" }),
    fromStatus: feedbackStatusEnum("from_status"),
    toStatus: feedbackStatusEnum("to_status").notNull(),
    changedAt: timestamp("changed_at", tz).notNull().defaultNow(),
  },
  (t) => [
    index("feedback_status_history_post_time_idx").on(
      t.feedbackPostId,
      t.changedAt,
    ),
    index("feedback_status_history_product_time_idx").on(
      t.productId,
      t.changedAt,
    ),
  ],
);

/**
 * One row per (post, authenticated voter). The composite unique constraint is
 * what actually prevents duplicate votes — application checks alone would race.
 */
export const feedbackVotes = pgTable(
  "feedback_votes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    feedbackPostId: uuid("feedback_post_id")
      .notNull()
      .references(() => feedbackPosts.id, { onDelete: "cascade" }),
    voterId: text("voter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("feedback_votes_post_voter_unique").on(t.feedbackPostId, t.voterId),
    index("feedback_votes_post_idx").on(t.feedbackPostId),
    index("feedback_votes_voter_idx").on(t.voterId),
  ],
);

/**
 * Comments and internal notes.
 *
 * `internal` is part of the row rather than a separate table so a public
 * surface can exclude internal notes with a single predicate, and so the
 * customer/team author split is preserved for audit.
 */
export const feedbackComments = pgTable(
  "feedback_comments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    feedbackPostId: uuid("feedback_post_id").notNull(),
    authorId: text("author_id").references(() => user.id, { onDelete: "set null" }),
    /** Public customer who wrote it; lets the author see their own pending comment. */
    authorCustomerId: uuid("author_customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    authorName: text("author_name").notNull(),
    authorType: feedbackCommentAuthorTypeEnum("author_type").notNull().default("team"),
    body: text("body").notNull(),
    internal: boolean("internal").notNull().default(false),
    privacy: feedbackPrivacyEnum("privacy").notNull().default("public"),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    // FK target for attachments, which must stay inside the same product.
    unique("feedback_comments_id_product_unique").on(t.id, t.productId),
    // Composite FK keeps the comment inside the same product as its post.
    foreignKey({
      name: "feedback_comments_post_product_fk",
      columns: [t.feedbackPostId, t.productId],
      foreignColumns: [feedbackPosts.id, feedbackPosts.productId],
    }).onDelete("cascade"),
    index("feedback_comments_post_created_idx").on(t.feedbackPostId, t.createdAt),
    index("feedback_comments_product_idx").on(t.productId),
  ],
);

export type FeedbackPost = typeof feedbackPosts.$inferSelect;
export type NewFeedbackPost = typeof feedbackPosts.$inferInsert;
export type FeedbackVote = typeof feedbackVotes.$inferSelect;
export type NewFeedbackVote = typeof feedbackVotes.$inferInsert;
export type FeedbackComment = typeof feedbackComments.$inferSelect;
export type NewFeedbackComment = typeof feedbackComments.$inferInsert;
export type FeedbackStatusHistory = typeof feedbackStatusHistory.$inferSelect;
export type NewFeedbackStatusHistory = typeof feedbackStatusHistory.$inferInsert;