/**
 * Engagement primitives: surveys, in-product experiences and targeted outbound
 * messages. All three share the same audience-rule shape so operators learn one
 * targeting model instead of three unrelated ones.
 */

import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { customers } from "@/db/schema/customers";
import { feedbackPosts } from "@/db/schema/feedback";
import { segments } from "@/db/schema/segments";
import { products, workspaces } from "@/db/schema/workspaces";
import type { TargetingRule } from "@/features/engagement/rules";
import type { OutboundTranslations } from "@/features/i18n/content";

const tz = { withTimezone: true } as const;

export const surveyKindEnum = pgEnum("survey_kind", ["nps", "csat", "custom"]);
export const surveyStatusEnum = pgEnum("survey_status", ["draft", "active", "paused"]);
export const surveyQuestionTypeEnum = pgEnum("survey_question_type", [
  "rating",
  "text",
  "choice",
]);

export type SurveyQuestion = {
  id: string;
  type: "rating" | "text" | "choice";
  prompt: string;
  required?: boolean | undefined;
  options?: string[] | undefined;
  /** Show this question only when another answer equals `equals`. */
  condition?: { questionId: string; equals: string } | undefined;
};

export const surveys = pgTable(
  "surveys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    kind: surveyKindEnum("kind").notNull().default("nps"),
    status: surveyStatusEnum("status").notNull().default("draft"),
    questions: jsonb("questions").$type<SurveyQuestion[]>().notNull().default([]),
    audience: jsonb("audience").$type<TargetingRule[]>().notNull().default([]),
    /** Do not ask the same visitor again for this many days after a response. */
    suppressDays: integer("suppress_days").notNull().default(30),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("surveys_product_slug_unique").on(t.productId, t.slug),
    index("surveys_product_status_idx").on(t.productId, t.status),
  ],
);

export const surveyResponses = pgTable(
  "survey_responses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    surveyId: uuid("survey_id")
      .notNull()
      .references(() => surveys.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    visitorKey: text("visitor_key").notNull(),
    score: integer("score"),
    answers: jsonb("answers").$type<Record<string, string>>().notNull().default({}),
    /** Explicit consent, never inferred from a free-text answer. */
    optedIn: boolean("opted_in").notNull().default(false),
    feedbackPostId: uuid("feedback_post_id").references(() => feedbackPosts.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    index("survey_responses_survey_created_idx").on(t.surveyId, t.createdAt),
    index("survey_responses_visitor_idx").on(t.surveyId, t.visitorKey),
  ],
);

/**
 * One proactive delivery of a survey, at most once per visitor per day.
 *
 * The unique key is the whole point: a page reload is not a second impression,
 * so the plan's monthly allowance cannot be exhausted by one visitor refreshing
 * a storefront. Impressions are counted workspace-wide because the catalogue's
 * allowance is per workspace, not per survey.
 */
export const surveyImpressions = pgTable(
  "survey_impressions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    surveyId: uuid("survey_id")
      .notNull()
      .references(() => surveys.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    visitorKey: text("visitor_key").notNull(),
    /** UTC calendar day, so the same visitor is prompted at most once a day. */
    shownOn: date("shown_on").notNull(),
    source: text("source").notNull().default("widget"),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("survey_impressions_visitor_day_unique").on(
      t.surveyId,
      t.visitorKey,
      t.shownOn,
    ),
    index("survey_impressions_workspace_created_idx").on(
      t.workspaceId,
      t.createdAt,
    ),
  ],
);

export const experienceKindEnum = pgEnum("experience_kind", ["tour", "banner"]);
export const experienceStatusEnum = pgEnum("experience_status", [
  "draft",
  "active",
  "paused",
]);

export type ExperienceCopy = {
  title: string;
  body: string;
  ctaLabel?: string | undefined;
  ctaUrl?: string | undefined;
  /** Open a widget panel instead of navigating; `ctaUrl` is the alternative. */
  ctaPanel?: string | undefined;
  steps?: {
    selector: string;
    title: string;
    body: string;
    pageUrl?: string;
    /** Browser-local rules; attribute rules would need traits the loader lacks. */
    audience?: TargetingRule[];
  }[];
};

export type ExperienceContent = Record<string, ExperienceCopy>;

export const widgetExperiences = pgTable(
  "widget_experiences",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    kind: experienceKindEnum("kind").notNull(),
    name: text("name").notNull(),
    status: experienceStatusEnum("status").notNull().default("draft"),
    audience: jsonb("audience").$type<TargetingRule[]>().notNull().default([]),
    content: jsonb("content").$type<ExperienceContent>().notNull().default({}),
    defaultLocale: text("default_locale").notNull().default("en"),
    dismissDays: integer("dismiss_days").notNull().default(30),
    /** Delivery window in UTC. Null means no bound on that side. */
    scheduleStart: timestamp("schedule_start", tz),
    scheduleEnd: timestamp("schedule_end", tz),
    /** 0 means unlimited. Otherwise at most this many counted views per window. */
    frequencyCap: integer("frequency_cap").notNull().default(0),
    frequencyWindowDays: integer("frequency_window_days").notNull().default(7),
    /** SHA-256 of the one active preview link; the token itself is never stored. */
    previewTokenHash: text("preview_token_hash"),
    previewExpiresAt: timestamp("preview_expires_at", tz),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    index("widget_experiences_product_status_idx").on(t.productId, t.status),
    index("widget_experiences_preview_idx").on(t.previewTokenHash),
  ],
);

/**
 * One counted render per experience, visitor and UTC day.
 *
 * The loader reports a view through the iframe only after a banner or tour is
 * actually on screen, so a page/event rule that filtered it out never consumes
 * the frequency budget. A customer id makes the budget follow the person across
 * browsers and devices; the visitor key covers anonymous traffic.
 */
export const widgetExperienceViews = pgTable(
  "widget_experience_views",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    experienceId: uuid("experience_id")
      .notNull()
      .references(() => widgetExperiences.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    visitorKey: text("visitor_key").notNull(),
    shownOn: date("shown_on").notNull(),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("widget_experience_views_visitor_day_unique").on(
      t.experienceId,
      t.visitorKey,
      t.shownOn,
    ),
    index("widget_experience_views_experience_created_idx").on(
      t.experienceId,
      t.createdAt,
    ),
    index("widget_experience_views_workspace_idx").on(t.workspaceId),
  ],
);

export const widgetExperienceDismissals = pgTable(
  "widget_experience_dismissals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    experienceId: uuid("experience_id")
      .notNull()
      .references(() => widgetExperiences.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "cascade",
    }),
    /** Anonymous loader identity; generated and retained by the host page. */
    visitorKey: text("visitor_key").notNull(),
    dismissedAt: timestamp("dismissed_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("widget_experience_dismissals_visitor_unique").on(
      t.experienceId,
      t.visitorKey,
    ),
    index("widget_experience_dismissals_workspace_idx").on(t.workspaceId),
  ],
);

/**
 * A tour that reached its final step.
 *
 * One row per experience and recipient, so a recipient who presses Done twice
 * is still one completion in reports. Dismissal and completion are separate
 * signals: closing a tour early is not a completion.
 */
export const widgetExperienceCompletions = pgTable(
  "widget_experience_completions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    experienceId: uuid("experience_id")
      .notNull()
      .references(() => widgetExperiences.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    visitorKey: text("visitor_key").notNull(),
    completedAt: timestamp("completed_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("widget_experience_completions_visitor_unique").on(
      t.experienceId,
      t.visitorKey,
    ),
    index("widget_experience_completions_product_idx").on(
      t.productId,
      t.completedAt,
    ),
  ],
);

export const outboundChannelEnum = pgEnum("outbound_channel", ["email", "in_app"]);
export const outboundStatusEnum = pgEnum("outbound_status", [
  "draft",
  "scheduled",
  "active",
  "paused",
  "completed",
]);
export const outboundRecurrenceEnum = pgEnum("outbound_recurrence", [
  "one_shot",
  "daily",
  "weekly",
]);
export const outboundEventTypeEnum = pgEnum("outbound_event_type", [
  "queued",
  "sent",
  "opened",
  "clicked",
  "converted",
  "dismissed",
]);

export const outboundMessages = pgTable(
  "outbound_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    channel: outboundChannelEnum("channel").notNull().default("in_app"),
    status: outboundStatusEnum("status").notNull().default("draft"),
    audience: jsonb("audience").$type<TargetingRule[]>().notNull().default([]),
    /** Optional saved segment evaluated in addition to `audience`. */
    segmentId: uuid("segment_id").references(() => segments.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    body: text("body").notNull(),
    translations: jsonb("translations")
      .$type<OutboundTranslations>()
      .notNull()
      .default({}),
    ctaLabel: text("cta_label"),
    ctaUrl: text("cta_url"),
    scheduleStart: timestamp("schedule_start", tz),
    scheduleEnd: timestamp("schedule_end", tz),
    /** Local delivery window, formatted HH:MM. */
    windowStart: text("window_start").notNull().default("00:00"),
    windowEnd: text("window_end").notNull().default("23:59"),
    timezone: text("timezone").notNull().default("UTC"),
    recurrence: outboundRecurrenceEnum("recurrence").notNull().default("one_shot"),
    lastRunKey: text("last_run_key"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [index("outbound_messages_product_status_idx").on(t.productId, t.status)],
);

export const outboundMessageEvents = pgTable(
  "outbound_message_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => outboundMessages.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    type: outboundEventTypeEnum("type").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [index("outbound_message_events_message_idx").on(t.messageId, t.type)],
);

export type Survey = typeof surveys.$inferSelect;
export type SurveyResponse = typeof surveyResponses.$inferSelect;
export type SurveyImpression = typeof surveyImpressions.$inferSelect;
export type WidgetExperience = typeof widgetExperiences.$inferSelect;
export type WidgetExperienceCompletion =
  typeof widgetExperienceCompletions.$inferSelect;
export type OutboundMessage = typeof outboundMessages.$inferSelect;
