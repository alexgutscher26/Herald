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
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "@/db/schema/auth";
import { boards } from "@/db/schema/boards";
import { products, workspaces } from "@/db/schema/workspaces";

const tz = { withTimezone: true } as const;

/** One weekly availability window in the operator's own timezone. */
export type OperatorScheduleWindow = {
  /** 0 = Sunday … 6 = Saturday. */
  days: number[];
  /** `HH:MM`, 24-hour. */
  start: string;
  /** `HH:MM`; may be earlier than start to span midnight. */
  end: string;
};

/**
 * Per-product inbound email configuration.
 *
 * Only the token is stored; the address is derived from `EMAIL_INBOUND_DOMAIN`
 * so rotating a domain does not require rewriting rows. `enabled` pauses new
 * threads without deleting the address, and the display name is what customers
 * see in the From line of replies.
 */
export const productEmailSettings = pgTable(
  "product_email_settings",
  {
    productId: uuid("product_id")
      .primaryKey()
      .references(() => products.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    enabled: boolean("enabled").notNull().default(true),
    displayName: text("display_name").notNull().default("Support"),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    check("product_email_settings_token_ck", sql`length(${t.token}) >= 8`),
  ],
);

/**
 * An owner/admin who can receive conversations.
 *
 * The role check is enforced by the service, not the table: membership roles
 * already live in `workspace_members` and duplicating the enum here would let
 * the two drift. `schedule` null means always available; an empty array means
 * never. Presence is a heartbeat (`last_seen_at`) plus these preferences, not
 * a long-lived socket.
 */
export const workspaceOperators = pgTable(
  "workspace_operators",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    timezone: text("timezone").notNull().default("UTC"),
    schedule: jsonb("schedule").$type<OperatorScheduleWindow[] | null>(),
    availableWhileUsing: boolean("available_while_using").notNull().default(true),
    appearOffline: boolean("appear_offline").notNull().default(false),
    /** Per-user notification choices. */
    notifyEmail: boolean("notify_email").notNull().default(true),
    notifyInApp: boolean("notify_in_app").notNull().default(true),
    notifyNewConversations: boolean("notify_new_conversations")
      .notNull()
      .default(true),
    notifyReplies: boolean("notify_replies").notNull().default(true),
    /** Automated reply while every operator is away. */
    awayReplyEnabled: boolean("away_reply_enabled").notNull().default(false),
    awayReplyBody: text("away_reply_body")
      .notNull()
      .default(
        "Thanks for your message. Our team is away right now and will reply as soon as we are back.",
      ),
    lastSeenAt: timestamp("last_seen_at", tz),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: "workspace_operators_pk",
      columns: [t.workspaceId, t.userId],
    }),
    check("workspace_operators_timezone_ck", sql`length(${t.timezone}) > 0`),
  ],
);

/** Operator-tunable pre-inbox spam rules. Null uses the built-in defaults. */
export type ConversationSpamRules = {
  enabled: boolean;
  minimumScore: number;
  linkThreshold: number;
  keywords: string[];
  shouting: boolean;
  repetition: boolean;
  moneyPromise: boolean;
};

/**
 * Product-level support behaviour that is off unless a team turns it on.
 *
 * CSAT is deliberately opt-in per product: a rating prompt changes what a
 * customer sees at the end of a thread, so it is not enabled by a deployment
 * default. A missing row means every switch keeps its schema default.
 */
export const productSupportSettings = pgTable("product_support_settings", {
  productId: uuid("product_id")
    .primaryKey()
    .references(() => products.id, { onDelete: "cascade" }),
  csatEnabled: boolean("csat_enabled").notNull().default(false),
  /** Null means the code defaults; saving here overrides them per product. */
  spamRules: jsonb("spam_rules").$type<ConversationSpamRules>(),
  /** Opt-in first-response clock; off means no badge and no breach alerts. */
  slaEnabled: boolean("sla_enabled").notNull().default(false),
  /** Business minutes allowed before a customer message is a breach. */
  slaFirstResponseMinutes: integer("sla_first_response_minutes")
    .notNull()
    .default(240),
  /** Null means 24/7; an empty list would stop the clock and is not saved. */
  slaBusinessHours: jsonb("sla_business_hours").$type<
    OperatorScheduleWindow[] | null
  >(),
  slaTimezone: text("sla_timezone").notNull().default("UTC"),
  createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
});

/** Where an intake question is asked. Email has no form, so it stores nothing. */
export const intakeChannelEnum = pgEnum("intake_channel", [
  "widget",
  "board",
  "email",
]);

export const intakeQuestionKindEnum = pgEnum("intake_question_kind", [
  "text",
  "select",
]);

/**
 * One optional qualification question.
 *
 * `board_id` is null for a product-wide question. A board question is only
 * asked on that board, so a "severity" question cannot leak onto every other
 * board. Answers are written to `customers.traits` under `key`; a question is
 * never required, and an unanswered or invalid answer is dropped rather than
 * blocking a guest.
 */
export const intakeQuestions = pgTable(
  "intake_questions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    boardId: uuid("board_id"),
    channel: intakeChannelEnum("channel").notNull().default("widget"),
    /** Trait name the answer is stored under, e.g. `plan` or `severity`. */
    key: text("key").notNull(),
    label: text("label").notNull(),
    kind: intakeQuestionKindEnum("kind").notNull().default("text"),
    options: jsonb("options").$type<string[]>().notNull().default([]),
    position: integer("position").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "intake_questions_board_fk",
      columns: [t.boardId, t.productId],
      foreignColumns: [boards.id, boards.productId],
    }).onDelete("cascade"),
    index("intake_questions_product_channel_idx").on(
      t.productId,
      t.channel,
      t.position,
    ),
    check(
      "intake_questions_key_ck",
      sql`${t.key} ~ '^[a-z][a-z0-9_]{0,39}$'`,
    ),
    check(
      "intake_questions_options_ck",
      sql`jsonb_typeof(${t.options}) = 'array'`,
    ),
    check(
      "intake_questions_board_channel_ck",
      sql`${t.channel} = 'board' OR ${t.boardId} IS NULL`,
    ),
  ],
);

export type ProductEmailSettings = typeof productEmailSettings.$inferSelect;
export type WorkspaceOperator = typeof workspaceOperators.$inferSelect;
export type ProductSupportSettings = typeof productSupportSettings.$inferSelect;
export type IntakeQuestion = typeof intakeQuestions.$inferSelect;
export type NewIntakeQuestion = typeof intakeQuestions.$inferInsert;
export type IntakeChannel = (typeof intakeChannelEnum.enumValues)[number];
