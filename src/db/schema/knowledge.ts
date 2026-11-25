import { sql } from "drizzle-orm";
import {
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
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "@/db/schema/auth";
import { boards } from "@/db/schema/boards";
import { conversationMessages, conversations } from "@/db/schema/conversations";
import { customers } from "@/db/schema/customers";
import { feedbackPosts } from "@/db/schema/feedback";
import { products, workspaces } from "@/db/schema/workspaces";

const tz = { withTimezone: true } as const;

export const junoToneEnum = pgEnum("juno_tone", [
  "warm",
  "professional",
  "direct",
  "empathetic",
  "playful",
]);

export const junoReplyLengthEnum = pgEnum("juno_reply_length", [
  "short",
  "medium",
  "long",
]);

export const junoFormalityEnum = pgEnum("juno_formality", [
  "casual",
  "neutral",
  "formal",
]);

export const knowledgeSourceKindEnum = pgEnum("knowledge_source_kind", [
  "upload",
  "url",
  "help_collection",
  "api_docs",
]);

export const knowledgeSourceStatusEnum = pgEnum("knowledge_source_status", [
  "processing",
  "live",
  "paused",
  "error",
]);

/**
 * Who may read a source.
 *
 * `public` is customer-facing: widget, email and public help answers. `internal`
 * is never read by those surfaces; only an explicitly internal retrieval run
 * (the evaluation harness) may include it.
 */
export const knowledgeSourceVisibilityEnum = pgEnum(
  "knowledge_source_visibility",
  ["public", "internal"],
);

/** A thumbs-down task: someone should add a source that answers the question. */
export const junoKnowledgeTaskStatusEnum = pgEnum("juno_knowledge_task_status", [
  "open",
  "done",
]);

export type KnowledgeChangeSummary = {
  added: number;
  removed: number;
  changed: number;
};

export const knowledgeVersionStatusEnum = pgEnum(
  "knowledge_version_status",
  ["building", "live", "failed", "superseded"],
);

export const junoConversationStateEnum = pgEnum("juno_conversation_state", [
  "active",
  "paused",
  "handed_off",
  "resolved",
]);

export const junoAnswerStatusEnum = pgEnum("juno_answer_status", [
  "answered",
  "handoff",
  "skipped",
  "failed",
]);

export const junoAnswerFeedbackEnum = pgEnum("juno_answer_feedback", ["up", "down"]);

export const junoDuplicateModeEnum = pgEnum("juno_duplicate_mode", [
  "off",
  "assisted",
  "automatic",
]);

export const agentActionKindEnum = pgEnum("agent_action_kind", ["send_transcript"]);

export const agentActionStatusEnum = pgEnum("agent_action_status", [
  "queued",
  "skipped",
  "failed",
]);

export const junoFeedbackKindEnum = pgEnum("juno_feedback_kind", [
  "create",
  "vote",
  "follow",
]);

export const junoFeedbackStatusEnum = pgEnum("juno_feedback_status", [
  "pending",
  "confirmed",
  "declined",
  "expired",
  "failed",
]);

export const junoSuggestionKindEnum = pgEnum("juno_suggestion_kind", [
  "tags",
  "duplicates",
]);

export const junoSuggestionStatusEnum = pgEnum("juno_suggestion_status", [
  "ready",
  "dismissed",
]);

export type KnowledgeCitation = {
  sourceId: string;
  sourceName: string;
  title: string;
  url: string | null;
};

/** A retrieval hit kept for answer inspection, including its blended score. */
export type JunoRetrievedSource = KnowledgeCitation & {
  score: number;
  excerpt: string;
};

/**
 * One thing Mira is allowed to read.
 *
 * Sources are versioned packages: a recrawl or replacement builds a new
 * version while the current `activeVersionId` keeps serving, so retrieval never
 * sees a half-written index. A paused source keeps its rows and its version
 * history but is excluded from retrieval.
 */
export const knowledgeSources = pgTable(
  "knowledge_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: knowledgeSourceKindEnum("kind").notNull(),
    /** Crawl root; null for uploads and managed sources. */
    url: text("url"),
    /** Only URLs beneath this path are crawled. */
    pathPrefix: text("path_prefix"),
    /** Managed origin id (help collection, API document); null for uploads/crawls. */
    originId: uuid("origin_id"),
    status: knowledgeSourceStatusEnum("status").notNull().default("processing"),
    /** Customer-facing by default; `internal` is excluded from every public answer. */
    visibility: knowledgeSourceVisibilityEnum("visibility").notNull().default("public"),
    /** The version retrieval reads. Null until the first successful ingest. */
    activeVersionId: uuid("active_version_id"),
    pageCount: integer("page_count").notNull().default(0),
    lastError: text("last_error"),
    /** 0 disables scheduled recrawls; only crawled sources use this. */
    recrawlIntervalHours: integer("recrawl_interval_hours").notNull().default(0),
    /** Last completed crawl, successful or not. */
    lastCheckedAt: timestamp("last_checked_at", tz),
    /** Last successful crawl whose page set differed from the previous version. */
    lastChangedAt: timestamp("last_changed_at", tz),
    /** Page counts from the latest changed recrawl; cleared when the team dismisses it. */
    lastChangeSummary: jsonb("last_change_summary").$type<KnowledgeChangeSummary>(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("knowledge_sources_id_product_unique").on(t.id, t.productId),
    index("knowledge_sources_product_idx").on(t.productId, t.createdAt),
    check(
      "knowledge_sources_url_ck",
      sql`(${t.kind} = 'url' AND ${t.url} IS NOT NULL) OR (${t.kind} IN ('upload', 'help_collection', 'api_docs') AND ${t.url} IS NULL)`,
    ),
    check(
      "knowledge_sources_origin_ck",
      sql`(${t.kind} IN ('help_collection', 'api_docs') AND ${t.originId} IS NOT NULL) OR (${t.kind} IN ('upload', 'url') AND ${t.originId} IS NULL)`,
    ),
    check("knowledge_sources_name_ck", sql`length(${t.name}) between 1 and 80`),
    check(
      "knowledge_sources_recrawl_ck",
      sql`${t.recrawlIntervalHours} >= 0 AND ${t.recrawlIntervalHours} <= 720`,
    ),
  ],
);

export const knowledgeVersions = pgTable(
  "knowledge_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceId: uuid("source_id").notNull(),
    productId: uuid("product_id").notNull(),
    status: knowledgeVersionStatusEnum("status").notNull().default("building"),
    pageCount: integer("page_count").notNull().default(0),
    chunkCount: integer("chunk_count").notNull().default(0),
    error: text("error"),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    publishedAt: timestamp("published_at", tz),
  },
  (t) => [
    unique("knowledge_versions_id_product_unique").on(t.id, t.productId),
    foreignKey({
      columns: [t.sourceId, t.productId],
      foreignColumns: [knowledgeSources.id, knowledgeSources.productId],
      name: "knowledge_versions_source_fk",
    }).onDelete("cascade"),
    index("knowledge_versions_source_idx").on(t.sourceId, t.createdAt),
  ],
);

export const knowledgePages = pgTable(
  "knowledge_pages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    versionId: uuid("version_id").notNull(),
    sourceId: uuid("source_id").notNull(),
    productId: uuid("product_id").notNull(),
    url: text("url"),
    title: text("title").notNull(),
    content: text("content").notNull(),
    ordinal: integer("ordinal").notNull().default(0),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    // Target for the chunks composite foreign key.
    unique("knowledge_pages_id_product_unique").on(t.id, t.productId),
    foreignKey({
      columns: [t.versionId, t.productId],
      foreignColumns: [knowledgeVersions.id, knowledgeVersions.productId],
      name: "knowledge_pages_version_fk",
    }).onDelete("cascade"),
    index("knowledge_pages_version_idx").on(t.versionId, t.ordinal),
  ],
);

export const knowledgeChunks = pgTable(
  "knowledge_chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    pageId: uuid("page_id").notNull(),
    versionId: uuid("version_id").notNull(),
    sourceId: uuid("source_id").notNull(),
    productId: uuid("product_id").notNull(),
    ordinal: integer("ordinal").notNull().default(0),
    content: text("content").notNull(),
    /** Normalized vector; jsonb keeps this portable without pgvector. */
    embedding: jsonb("embedding").$type<number[]>().notNull(),
    /** Which embedding model produced the vector; retrieval reads one space. */
    embeddingModel: text("embedding_model").notNull(),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.pageId, t.productId],
      foreignColumns: [knowledgePages.id, knowledgePages.productId],
      name: "knowledge_chunks_page_fk",
    }).onDelete("cascade"),
    index("knowledge_chunks_version_idx").on(t.versionId),
    index("knowledge_chunks_product_idx").on(t.productId, t.createdAt),
  ],
);

/**
 * Per-product Mira behavior.
 *
 * `model` is a server-side allowlisted name or null for the deployment model;
 * it never comes from the browser unchecked. `confidenceFloor` is the minimum
 * retrieval score below which Mira hands off instead of answering.
 */
export const junoSettings = pgTable(
  "juno_settings",
  {
    productId: uuid("product_id")
      .primaryKey()
      .references(() => products.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    /** Off, suggestions only, or confident automatic merges plus a review queue. */
    duplicateMode: junoDuplicateModeEnum("duplicate_mode")
      .notNull()
      .default("assisted"),
    /** Enables the public "improve my request" and split suggestions. */
    submissionAssistantEnabled: boolean("submission_assistant_enabled")
      .notNull()
      .default(false),
    tone: junoToneEnum("tone").notNull().default("warm"),
    replyLength: junoReplyLengthEnum("reply_length").notNull().default("medium"),
    formality: junoFormalityEnum("formality").notNull().default("neutral"),
    emoji: boolean("emoji").notNull().default(false),
    /** `auto` follows the customer; otherwise an ISO language tag. */
    language: text("language").notNull().default("auto"),
    model: text("model"),
    confidenceFloor: real("confidence_floor").notNull().default(0.35),
    dailyBudgetCents: integer("daily_budget_cents").notNull().default(100),
    autoResolveChatMinutes: integer("auto_resolve_chat_minutes")
      .notNull()
      .default(30),
    autoResolveEmailMinutes: integer("auto_resolve_email_minutes")
      .notNull()
      .default(4320),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    check(
      "juno_settings_floor_ck",
      sql`${t.confidenceFloor} >= 0 AND ${t.confidenceFloor} <= 1`,
    ),
    check("juno_settings_budget_ck", sql`${t.dailyBudgetCents} >= 0`),
    check(
      "juno_settings_timers_ck",
      sql`${t.autoResolveChatMinutes} >= 0 AND ${t.autoResolveEmailMinutes} >= 0`,
    ),
  ],
);

/** Mira's state on one thread; the row exists only once Mira is involved. */
export const junoConversations = pgTable(
  "juno_conversations",
  {
    conversationId: uuid("conversation_id")
      .primaryKey()
      .references(() => conversations.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull(),
    state: junoConversationStateEnum("state").notNull().default("active"),
    /** Why the last handoff happened, for the queue and the weekly review. */
    handoffReason: text("handoff_reason"),
    lastJunoMessageAt: timestamp("last_juno_message_at", tz),
    resolvedAt: timestamp("resolved_at", tz),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.conversationId, t.productId],
      foreignColumns: [conversations.id, conversations.productId],
      name: "juno_conversations_conversation_fk",
    }).onDelete("cascade"),
    index("juno_conversations_state_idx").on(t.productId, t.state),
  ],
);

/**
 * One generated answer, handoff or skip.
 *
 * This is the audit trail behind the activity meter and the daily budget:
 * handoffs keep their reason, answers keep their confidence and citations, and
 * a failed generation is recorded rather than silently disappearing.
 */
export const junoAnswers = pgTable(
  "juno_answers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id").notNull(),
    productId: uuid("product_id").notNull(),
    messageId: uuid("message_id"),
    status: junoAnswerStatusEnum("status").notNull(),
    question: text("question").notNull(),
    answer: text("answer"),
    /** Why this pickup handed off; null for an answer or a skip. */
    handoffReason: text("handoff_reason"),
    confidence: real("confidence"),
    citations: jsonb("citations").$type<KnowledgeCitation[]>(),
    /** Ranked passages and scores; null for rows written before inspection. */
    retrievedSources: jsonb("retrieved_sources").$type<JunoRetrievedSource[]>(),
    /** Team thumbs signal. It is stored here and can seed the evaluation set. */
    feedbackRating: junoAnswerFeedbackEnum("feedback_rating"),
    feedbackBy: text("feedback_by").references(() => user.id, {
      onDelete: "set null",
    }),
    feedbackAt: timestamp("feedback_at", tz),
    model: text("model"),
    /** Prompt contract that produced this row, for regression tracing. */
    promptVersion: text("prompt_version"),
    costCents: integer("cost_cents").notNull().default(0),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.conversationId, t.productId],
      foreignColumns: [conversations.id, conversations.productId],
      name: "juno_answers_conversation_fk",
    }).onDelete("cascade"),
    index("juno_answers_product_created_idx").on(t.productId, t.createdAt),
    index("juno_answers_product_confidence_idx").on(t.productId, t.confidence),
  ],
);

/**
 * A team task opened by a thumbs-down on an answer.
 *
 * The row is a to-do, not another copy of the answer: the question is already
 * redacted and the link points back at the conversation for context. One task
 * per answer makes repeated clicks inert.
 */
export const junoKnowledgeTasks = pgTable(
  "juno_knowledge_tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    answerId: uuid("answer_id")
      .notNull()
      .references(() => junoAnswers.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").notNull(),
    /** Already-redacted customer question, never raw message text. */
    question: text("question").notNull(),
    status: junoKnowledgeTaskStatusEnum("status").notNull().default("open"),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    completedBy: text("completed_by").references(() => user.id, {
      onDelete: "set null",
    }),
    completedAt: timestamp("completed_at", tz),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("juno_knowledge_tasks_answer_unique").on(t.answerId),
    index("juno_knowledge_tasks_product_status_idx").on(
      t.productId,
      t.status,
      t.createdAt,
    ),
    check(
      "juno_knowledge_tasks_question_ck",
      sql`length(${t.question}) between 1 and 4000`,
    ),
  ],
);

/**
 * The reviewed, per-product allowlist of actions Mira may perform.
 *
 * A row exists only for an action the team explicitly reviewed. Enabling one
 * without recording who reviewed it is refused by the database, so a switch
 * cannot be turned on by an old or unauthenticated code path.
 */
export const agentActionSettings = pgTable(
  "agent_action_settings",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    action: agentActionKindEnum("action").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    reviewedBy: text("reviewed_by").references(() => user.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", tz),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "agent_action_settings_pk", columns: [t.productId, t.action] }),
    check(
      "agent_action_settings_review_ck",
      sql`${t.enabled} = false OR ${t.reviewedBy} IS NOT NULL`,
    ),
  ],
);

/** One durable audit row for every action the agent attempts. */
export const agentActionRuns = pgTable(
  "agent_action_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").notNull(),
    action: agentActionKindEnum("action").notNull(),
    status: agentActionStatusEnum("status").notNull().default("queued"),
    messageId: uuid("message_id"),
    /** The outbound delivery, when the action queued one. */
    deliveryId: uuid("delivery_id"),
    detail: text("detail"),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.conversationId, t.productId],
      foreignColumns: [conversations.id, conversations.productId],
      name: "agent_action_runs_conversation_fk",
    }).onDelete("cascade"),
    index("agent_action_runs_product_created_idx").on(t.productId, t.createdAt),
    index("agent_action_runs_conversation_idx").on(t.conversationId, t.createdAt),
  ],
);

/** Daily counters; the budget check reads one row by (product, day). */
export const junoUsage = pgTable(
  "juno_usage",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** UTC `YYYY-MM-DD`. */
    day: text("day").notNull(),
    requests: integer("requests").notNull().default(0),
    costCents: integer("cost_cents").notNull().default(0),
    /** When this day first crossed 80% of the configured budget. */
    alertedAt: timestamp("alerted_at", tz),
  },
  (t) => [
    primaryKey({ name: "juno_usage_pk", columns: [t.productId, t.day] }),
    check("juno_usage_requests_ck", sql`${t.requests} >= 0`),
    check("juno_usage_cost_ck", sql`${t.costCents} >= 0`),
  ],
);

/**
 * Redaction audit: counts only, one row per customer message.
 *
 * The message id is the idempotency key, so a retried job cannot double-count.
 * No raw text, placeholder fragments or matched values are stored here; the
 * report can only say how many of each kind were removed.
 */
export const junoRedactionEvents = pgTable(
  "juno_redaction_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    messageId: uuid("message_id")
      .notNull()
      .references(() => conversationMessages.id, { onDelete: "cascade" }),
    emailCount: integer("email_count").notNull().default(0),
    phoneCount: integer("phone_count").notNull().default(0),
    cardCount: integer("card_count").notNull().default(0),
    ibanCount: integer("iban_count").notNull().default(0),
    ssnCount: integer("ssn_count").notNull().default(0),
    secretCount: integer("secret_count").notNull().default(0),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("juno_redaction_events_message_unique").on(t.messageId),
    index("juno_redaction_events_product_created_idx").on(
      t.productId,
      t.createdAt,
    ),
    check(
      "juno_redaction_events_counts_ck",
      sql`${t.emailCount} >= 0 AND ${t.phoneCount} >= 0 AND ${t.cardCount} >= 0
        AND ${t.ibanCount} >= 0 AND ${t.ssnCount} >= 0 AND ${t.secretCount} >= 0`,
    ),
  ],
);

/**
 * A feedback card Mira offered in a widget conversation.
 *
 * Nothing is written to a board until the customer confirms: `pending` is a
 * draft, `confirmed` means the vote/follow/create actually happened. The row
 * is the server-side record of both the offer and the confirmation, so the
 * UI can re-render the card after a reload and the limits can be counted.
 */
export const junoFeedbackActions = pgTable(
  "juno_feedback_actions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id").notNull(),
    productId: uuid("product_id").notNull(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    kind: junoFeedbackKindEnum("kind").notNull(),
    status: junoFeedbackStatusEnum("status").notNull().default("pending"),
    /** What the customer asked, used for the card copy and the new request. */
    query: text("query").notNull(),
    title: text("title"),
    body: text("body"),
    boardId: uuid("board_id").references(() => boards.id, { onDelete: "set null" }),
    feedbackPostId: uuid("feedback_post_id").references(() => feedbackPosts.id, {
      onDelete: "set null",
    }),
    error: text("error"),
    expiresAt: timestamp("expires_at", tz).notNull(),
    confirmedAt: timestamp("confirmed_at", tz),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.conversationId, t.productId],
      foreignColumns: [conversations.id, conversations.productId],
      name: "juno_feedback_actions_conversation_fk",
    }).onDelete("cascade"),
    index("juno_feedback_actions_thread_idx").on(t.conversationId, t.status),
    index("juno_feedback_actions_product_idx").on(t.productId, t.createdAt),
    check(
      "juno_feedback_actions_query_ck",
      sql`length(${t.query}) between 1 and 4000`,
    ),
    check(
      "juno_feedback_actions_title_ck",
      sql`${t.title} IS NULL OR length(${t.title}) between 3 and 140`,
    ),
  ],
);

/**
 * An auxiliary suggestion for one request.
 *
 * Suggestions are stored rather than applied: a human decides which tag to
 * keep and which duplicate to merge. `payload` is validated by the read path
 * before it is shown, so a malformed model answer never becomes UI state.
 */
export const junoSuggestions = pgTable(
  "juno_suggestions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    feedbackPostId: uuid("feedback_post_id")
      .notNull()
      .references(() => feedbackPosts.id, { onDelete: "cascade" }),
    kind: junoSuggestionKindEnum("kind").notNull(),
    status: junoSuggestionStatusEnum("status").notNull().default("ready"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    model: text("model"),
    promptVersion: text("prompt_version").notNull(),
    costCents: integer("cost_cents").notNull().default(0),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    index("juno_suggestions_product_kind_idx").on(t.productId, t.kind, t.createdAt),
    index("juno_suggestions_post_idx").on(t.feedbackPostId),
  ],
);

/** One golden question in a product's evaluation set. */
export const junoEvalCases = pgTable(
  "juno_eval_cases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    /** Lowercase phrases the answer must contain; empty for a handoff case. */
    expectedKeywords: jsonb("expected_keywords").$type<string[]>().notNull().default([]),
    expectHandoff: boolean("expect_handoff").notNull().default(false),
    enabled: boolean("enabled").notNull().default(true),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    check("juno_eval_cases_question_ck", sql`length(${t.question}) between 3 and 500`),
    index("juno_eval_cases_product_idx").on(t.productId, t.enabled),
  ],
);

/** One case's result from one evaluation pass. */
export const junoEvalRuns = pgTable(
  "juno_eval_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    caseId: uuid("case_id")
      .notNull()
      .references(() => junoEvalCases.id, { onDelete: "cascade" }),
    model: text("model"),
    promptVersion: text("prompt_version").notNull(),
    passed: boolean("passed").notNull(),
    score: real("score").notNull().default(0),
    answer: text("answer"),
    reason: text("reason"),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    index("juno_eval_runs_product_created_idx").on(t.productId, t.createdAt),
    index("juno_eval_runs_case_created_idx").on(t.caseId, t.createdAt),
  ],
);

export type JunoFeedbackAction = typeof junoFeedbackActions.$inferSelect;
export type JunoSuggestion = typeof junoSuggestions.$inferSelect;
export type JunoEvalCase = typeof junoEvalCases.$inferSelect;
export type JunoEvalRun = typeof junoEvalRuns.$inferSelect;

export type KnowledgeSource = typeof knowledgeSources.$inferSelect;
export type KnowledgeVersion = typeof knowledgeVersions.$inferSelect;
export type KnowledgePage = typeof knowledgePages.$inferSelect;
export type KnowledgeChunk = typeof knowledgeChunks.$inferSelect;
export type JunoSettings = typeof junoSettings.$inferSelect;
export type JunoConversation = typeof junoConversations.$inferSelect;
export type JunoAnswer = typeof junoAnswers.$inferSelect;
export type AgentActionSetting = typeof agentActionSettings.$inferSelect;
export type AgentActionRun = typeof agentActionRuns.$inferSelect;
export type JunoDuplicateMode = (typeof junoDuplicateModeEnum.enumValues)[number];
