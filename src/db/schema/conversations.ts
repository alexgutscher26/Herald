import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  smallint,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "@/db/schema/auth";
import { customers } from "@/db/schema/customers";
import { products, workspaces } from "@/db/schema/workspaces";

const tz = { withTimezone: true } as const;

export const conversationStatusEnum = pgEnum("conversation_status", [
  "queue",
  "open",
  "snoozed",
  "resolved",
  "spam",
  "archived",
]);

export const conversationMessageAuthorEnum = pgEnum(
  "conversation_message_author",
  ["customer", "team", "juno", "system"],
);

export const conversationMessageKindEnum = pgEnum("conversation_message_kind", [
  "message",
  "note",
]);

export const conversationParticipantRoleEnum = pgEnum(
  "conversation_participant_role",
  ["customer", "team"],
);

export const conversationNotificationKindEnum = pgEnum(
  "conversation_notification_kind",
  ["new_conversation", "reply", "sla_breach"],
);

/** Safe, non-secret context captured when a thread starts. */
export type ConversationSourceContext = {
  channel?: "widget" | "email" | "slack";
  referrer?: string;
  locale?: string;
  timezone?: string;
  userAgent?: string;
};

/**
 * One support thread.
 *
 * `queue` is the default for a new customer message; a team reply moves it to
 * `open`. `snoozed` always carries `snoozedUntil`, enforced by a check
 * constraint. `spam` and `archived` are deliberately separate states so the
 * main inbox and search can exclude them without losing the row.
 *
 * `unreadForTeam` and the last-message fields are denormalised on purpose: the
 * inbox lists thousands of rows and must not run a per-row subquery. The
 * service layer is the only writer and keeps them consistent with the messages
 * table in the same transaction.
 */
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    assigneeId: text("assignee_id").references(() => user.id, {
      onDelete: "set null",
    }),
    status: conversationStatusEnum("status").notNull().default("queue"),
    subject: text("subject").notNull(),
    /** Plus-address token used for reply-by-email; unique per thread. */
    replyToken: text("reply_token").unique(),
    /** Where the customer started the thread, when the widget reported it. */
    sourceUrl: text("source_url"),
    /** Referrer, locale, timezone and browser reported at thread start. */
    sourceContext: jsonb("source_context").$type<ConversationSourceContext>(),
    /** Set once when an automated away reply was sent; cleared by a human. */
    awayReplySentAt: timestamp("away_reply_sent_at", tz),
    /** Why the pre-inbox filter moved this thread to Spam; null when clean. */
    spamReason: text("spam_reason"),
    lastMessagePreview: text("last_message_preview").notNull().default(""),
    lastMessageAt: timestamp("last_message_at", tz).notNull().defaultNow(),
    lastCustomerMessageAt: timestamp("last_customer_message_at", tz),
    unreadForTeam: integer("unread_for_team").notNull().default(0),
    /** Unread team messages, cleared when the customer opens the thread. */
    unreadForCustomer: integer("unread_for_customer").notNull().default(0),
    snoozedUntil: timestamp("snoozed_until", tz),
    resolvedAt: timestamp("resolved_at", tz),
    /** Last time the business-hours SLA was reported; older than a new customer message is eligible again. */
    slaBreachedAt: timestamp("sla_breached_at", tz),
    /**
     * Set at most once, when the thread first enters `resolved` while the
     * product has CSAT enabled. The rating lives on the conversation rather
     * than as a message, so it never appears in the customer-visible thread.
     */
    csatRequestedAt: timestamp("csat_requested_at", tz),
    csatRating: smallint("csat_rating"),
    csatRatedAt: timestamp("csat_rated_at", tz),
    /** Set on the one allowed re-rating after a thread was reopened. */
    csatReratedAt: timestamp("csat_rerated_at", tz),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    // Target for the composite foreign keys that keep messages, participants,
    // attachments and reminders inside the same product.
    unique("conversations_id_product_unique").on(t.id, t.productId),
    index("conversations_product_status_idx").on(
      t.productId,
      t.status,
      t.lastMessageAt,
    ),
    index("conversations_product_assignee_idx").on(
      t.productId,
      t.assigneeId,
      t.status,
    ),
    index("conversations_customer_idx").on(t.customerId),
    check("conversations_unread_ck", sql`${t.unreadForTeam} >= 0`),
    check("conversations_customer_unread_ck", sql`${t.unreadForCustomer} >= 0`),
    check(
      "conversations_snooze_ck",
      sql`${t.status} <> 'snoozed' OR ${t.snoozedUntil} IS NOT NULL`,
    ),
    check(
      "conversations_csat_rating_ck",
      sql`${t.csatRating} IS NULL OR (${t.csatRating} >= 1 AND ${t.csatRating} <= 5)`,
    ),
    check(
      "conversations_csat_rated_ck",
      sql`${t.csatRating} IS NULL OR (${t.csatRequestedAt} IS NOT NULL AND ${t.csatRatedAt} IS NOT NULL)`,
    ),
  ],
);

/**
 * One message or internal note.
 *
 * `note` rows are team-only and never affect the customer-visible thread,
 * unread counts or the inbox preview. Author identity is split between a team
 * user and a customer so a write can never claim the other kind.
 */
export const conversationMessages = pgTable(
  "conversation_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id").notNull(),
    productId: uuid("product_id").notNull(),
    authorType: conversationMessageAuthorEnum("author_type").notNull(),
    authorUserId: text("author_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    authorCustomerId: uuid("author_customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    kind: conversationMessageKindEnum("kind").notNull().default("message"),
    /** Where the message entered: dashboard, widget or inbound email. */
    channel: text("channel").notNull().default("team"),
    /** Provider message id for inbound email, so a retry is idempotent. */
    externalId: text("external_id"),
    body: text("body").notNull(),
    /** Knowledge sources behind a Mira answer; null for every other author. */
    citations: jsonb("citations").$type<
      { sourceName: string; title: string; url: string | null }[]
    >(),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("conversation_messages_id_product_unique").on(t.id, t.productId),
    foreignKey({
      columns: [t.conversationId, t.productId],
      foreignColumns: [conversations.id, conversations.productId],
      name: "conversation_messages_conversation_fk",
    }).onDelete("cascade"),
    index("conversation_messages_thread_idx").on(t.conversationId, t.createdAt),
    check(
      "conversation_messages_author_ck",
      sql`(${t.authorType} = 'team' AND ${t.authorUserId} IS NOT NULL)
        OR (${t.authorType} = 'customer' AND ${t.authorCustomerId} IS NOT NULL)
        -- Compared as text: a migration cannot reference a value it adds to
        -- the enum in the same transaction.
        OR (${t.authorType}::text = 'juno' AND ${t.authorUserId} IS NULL)
        OR ${t.authorType} = 'system'`,
    ),
    check(
      "conversation_messages_channel_ck",
      sql`${t.channel} in ('team', 'widget', 'email', 'slack')`,
    ),
    uniqueIndex("conversation_messages_external_unique")
      .on(t.externalId)
      .where(sql`${t.externalId} IS NOT NULL`),
  ],
);

/**
 * Per-participant read state.
 *
 * The team unread counter answers "how many customer messages are waiting";
 * `lastReadAt` answers "when did this person last look". Keeping the latter on
 * a participant row makes per-user reminders and read state possible without
 * a second copy of the thread.
 */
export const conversationParticipants = pgTable(
  "conversation_participants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id").notNull(),
    productId: uuid("product_id").notNull(),
    role: conversationParticipantRoleEnum("role").notNull(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "cascade",
    }),
    lastReadAt: timestamp("last_read_at", tz),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.conversationId, t.productId],
      foreignColumns: [conversations.id, conversations.productId],
      name: "conversation_participants_conversation_fk",
    }).onDelete("cascade"),
    uniqueIndex("conversation_participants_user_unique")
      .on(t.conversationId, t.userId)
      .where(sql`${t.userId} IS NOT NULL`),
    uniqueIndex("conversation_participants_customer_unique")
      .on(t.conversationId, t.customerId)
      .where(sql`${t.customerId} IS NOT NULL`),
    index("conversation_participants_user_idx").on(t.userId, t.lastReadAt),
  ],
);

/**
 * Files attached to a thread.
 *
 * The bytes live in the storage provider; this table records ownership and
 * metadata. `messageId` is nullable so a file can be uploaded before the
 * message that references it is sent.
 */
export const conversationAttachments = pgTable(
  "conversation_attachments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id").notNull(),
    productId: uuid("product_id").notNull(),
    messageId: uuid("message_id"),
    kind: text("kind").notNull().default("file"),
    storageKey: text("storage_key").notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.conversationId, t.productId],
      foreignColumns: [conversations.id, conversations.productId],
      name: "conversation_attachments_conversation_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.messageId, t.productId],
      foreignColumns: [conversationMessages.id, conversationMessages.productId],
      name: "conversation_attachments_message_fk",
    }).onDelete("cascade"),
    index("conversation_attachments_thread_idx").on(t.conversationId, t.createdAt),
    check(
      "conversation_attachments_kind_ck",
      sql`${t.kind} in ('image', 'file')`,
    ),
    check("conversation_attachments_size_ck", sql`${t.sizeBytes} > 0`),
    check(
      "conversation_attachments_storage_key_ck",
      sql`${t.storageKey} not like 'data:%' and ${t.storageKey} not like 'blob:%'`,
    ),
  ],
);

/**
 * A personal reminder on a thread.
 *
 * One active reminder per user and conversation (the partial unique index);
 * completing it keeps the row for history and frees the slot.
 */
export const conversationReminders = pgTable(
  "conversation_reminders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id").notNull(),
    productId: uuid("product_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    remindAt: timestamp("remind_at", tz).notNull(),
    completedAt: timestamp("completed_at", tz),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.conversationId, t.productId],
      foreignColumns: [conversations.id, conversations.productId],
      name: "conversation_reminders_conversation_fk",
    }).onDelete("cascade"),
    uniqueIndex("conversation_reminders_active_unique")
      .on(t.conversationId, t.userId)
      .where(sql`${t.completedAt} IS NULL`),
    index("conversation_reminders_user_due_idx").on(t.userId, t.remindAt),
  ],
);

/**
 * Audit row for a thread merge.
 *
 * A merge moves the duplicate's messages and tags onto the target and archives
 * the duplicate. The row keeps the trail after the source leaves the inbox.
 */
export const conversationMerges = pgTable(
  "conversation_merges",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    sourceConversationId: uuid("source_conversation_id").notNull(),
    targetConversationId: uuid("target_conversation_id").notNull(),
    movedMessages: integer("moved_messages").notNull().default(0),
    movedTags: integer("moved_tags").notNull().default(0),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    index("conversation_merges_product_idx").on(t.productId, t.createdAt),
    index("conversation_merges_source_idx").on(t.sourceConversationId),
  ],
);

/** An operator's disagreement with a pre-inbox spam verdict. */
export const conversationSpamFeedback = pgTable(
  "conversation_spam_feedback",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").notNull(),
    verdict: text("verdict").notNull().default("false_positive"),
    reasons: text("reasons"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    index("conversation_spam_feedback_product_idx").on(t.productId, t.createdAt),
    index("conversation_spam_feedback_conversation_idx").on(t.conversationId),
  ],
);

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type ConversationMessage = typeof conversationMessages.$inferSelect;
export type ConversationParticipant = typeof conversationParticipants.$inferSelect;
export type ConversationAttachment = typeof conversationAttachments.$inferSelect;
export type ConversationReminder = typeof conversationReminders.$inferSelect;
export type ConversationTag = typeof conversationTags.$inferSelect;
export type ConversationMacro = typeof conversationMacros.$inferSelect;
/**
 * Team-facing notification for a customer message.
 *
 * Per-user rows (not a shared counter) so each operator can read or ignore
 * their own alert. The unique dedupe key makes a provider or route retry inert.
 */
export const conversationNotifications = pgTable(
  "conversation_notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").notNull(),
    messageId: uuid("message_id"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: conversationNotificationKindEnum("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    dedupeKey: text("dedupe_key").notNull().unique(),
    readAt: timestamp("read_at", tz),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.conversationId, t.productId],
      foreignColumns: [conversations.id, conversations.productId],
      name: "conversation_notifications_conversation_fk",
    }).onDelete("cascade"),
    index("conversation_notifications_user_read_idx").on(t.userId, t.readAt),
    index("conversation_notifications_product_created_idx").on(
      t.productId,
      t.createdAt,
    ),
  ],
);

/**
 * Product-scoped conversation tags.
 *
 * Tags are intentionally simple: a stable display name and a unique name per
 * product. A macro can add one; the thread header shows the result. There is no
 * tag taxonomy or hierarchy to maintain.
 */
export const conversationTags = pgTable(
  "conversation_tags",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("conversation_tags_product_name_unique").on(t.productId, t.name),
    // Target for the composite foreign key from tag links.
    unique("conversation_tags_id_product_unique").on(t.id, t.productId),
    index("conversation_tags_product_idx").on(t.productId),
  ],
);

/** One tag on one conversation, kept inside the same product as both sides. */
export const conversationTagLinks = pgTable(
  "conversation_tag_links",
  {
    conversationId: uuid("conversation_id").notNull(),
    productId: uuid("product_id").notNull(),
    tagId: uuid("tag_id").notNull(),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "conversation_tag_links_pk", columns: [t.conversationId, t.tagId] }),
    foreignKey({
      columns: [t.conversationId, t.productId],
      foreignColumns: [conversations.id, conversations.productId],
      name: "conversation_tag_links_conversation_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.tagId, t.productId],
      foreignColumns: [conversationTags.id, conversationTags.productId],
      name: "conversation_tag_links_tag_fk",
    }).onDelete("cascade"),
    index("conversation_tag_links_tag_idx").on(t.tagId, t.conversationId),
  ],
);

/**
 * A reusable multi-step action.
 *
 * Empty reply means the macro only changes metadata. Null status/assignee/tag
 * means "leave it alone"; there is deliberately no destructive unassign step.
 */
export const conversationMacros = pgTable(
  "conversation_macros",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    replyBody: text("reply_body").notNull().default(""),
    tagName: text("tag_name"),
    status: conversationStatusEnum("status"),
    assigneeId: text("assignee_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("conversation_macros_product_name_unique").on(t.productId, t.name),
    index("conversation_macros_product_idx").on(t.productId),
    check("conversation_macros_reply_ck", sql`length(${t.replyBody}) <= 10000`),
    check("conversation_macros_tag_ck", sql`${t.tagName} IS NULL OR length(${t.tagName}) <= 32`),
  ],
);

/** One in-progress composer value per operator and thread. */
export const conversationDrafts = pgTable(
  "conversation_drafts",
  {
    conversationId: uuid("conversation_id").notNull(),
    productId: uuid("product_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    body: text("body").notNull().default(""),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: "conversation_drafts_pk",
      columns: [t.conversationId, t.userId],
    }),
    foreignKey({
      columns: [t.conversationId, t.productId],
      foreignColumns: [conversations.id, conversations.productId],
      name: "conversation_drafts_conversation_fk",
    }).onDelete("cascade"),
    check("conversation_drafts_body_ck", sql`length(${t.body}) <= 10000`),
  ],
);

export type ConversationStatus = (typeof conversationStatusEnum.enumValues)[number];
export type ConversationNotification = typeof conversationNotifications.$inferSelect;
export type ConversationDraft = typeof conversationDrafts.$inferSelect;
export type ConversationMessageKind =
  (typeof conversationMessageKindEnum.enumValues)[number];
export type ConversationMessageAuthor =
  (typeof conversationMessageAuthorEnum.enumValues)[number];
