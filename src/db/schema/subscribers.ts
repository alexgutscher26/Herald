import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  primaryKey,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { customers } from "@/db/schema/customers";
import { products } from "@/db/schema/workspaces";

const tz = { withTimezone: true } as const;

export const subscriberStatusEnum = pgEnum("subscriber_status", [
  "pending",
  "active",
  "unsubscribed",
]);

export const subscriberSourceEnum = pgEnum("subscriber_source", [
  "widget",
  "import",
  "api",
  "manual",
  "follower",
]);

export const digestFrequencyEnum = pgEnum("digest_frequency", [
  "off",
  "daily",
  "weekly",
]);

/**
 * Product-update subscriptions.
 *
 * Two deliberately separate concepts live here:
 *   - `status` controls product-update (changelog) delivery. An
 *     `unsubscribed` row is kept forever so the unsubscribe state survives;
 *     rows are never deleted to "unsubscribe" someone.
 *   - `winbackOptedOutAt` is the customer's opt-out from win-back campaigns.
 *     Win-back *eligibility* itself lives on `customer_accounts` so that
 *     "subscribes to updates" and "may be contacted about coming back" are
 *     never conflated.
 */
export const subscribers = pgTable(
  "subscribers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** Address exactly as supplied, kept for display and replies. */
    email: text("email").notNull(),
    /** Canonical form produced by `normalizeEmail`; the de-duplication key. */
    emailNormalized: text("email_normalized").notNull(),
    name: text("name"),
    /** Public customer this address belongs to, once it is known. */
    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    status: subscriberStatusEnum("status").notNull().default("active"),
    source: subscriberSourceEnum("source").notNull().default("manual"),
    /** Capability token for the preference/unsubscribe link; never listed. */
    unsubscribeToken: text("unsubscribe_token").unique(),
    /** Capability token for the double opt-in confirmation link; never listed. */
    confirmationToken: text("confirmation_token").unique(),
    confirmationSentAt: timestamp("confirmation_sent_at", tz),
    /** Set when the address owner opened the confirmation link. */
    confirmedAt: timestamp("confirmed_at", tz),
    unsubscribedAt: timestamp("unsubscribed_at", tz),
    winbackOptedOutAt: timestamp("winback_opted_out_at", tz),
    /** Opt-in for request status changes and replies, independent of updates. */
    notifyStatusChanges: boolean("notify_status_changes").notNull().default(true),
    notifyReplies: boolean("notify_replies").notNull().default(true),
    /** Legacy mirror of "any digest selected"; kept for older senders and rows. */
    weeklyDigest: boolean("weekly_digest").notNull().default(false),
    /** New cadence control. Defaults off so existing rows stay unsubscribed. */
    digestFrequency: digestFrequencyEnum("digest_frequency").notNull().default("off"),
    /**
     * Local-time quiet window in the subscriber's own timezone. Minutes past
     * midnight keep the comparison independent of date formatting; a window
     * that wraps midnight (for example 22:00–07:00) is supported. All three
     * columns are set or cleared together.
     */
    quietHoursStart: smallint("quiet_hours_start"),
    quietHoursEnd: smallint("quiet_hours_end"),
    quietHoursTimezone: text("quiet_hours_timezone"),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("subscribers_product_email_unique").on(t.productId, t.emailNormalized),
    // FK target for per-topic preferences, scoped to one product.
    unique("subscribers_id_product_unique").on(t.id, t.productId),
    index("subscribers_product_status_idx").on(t.productId, t.status),
    index("subscribers_email_normalized_idx").on(t.emailNormalized),
    index("subscribers_customer_idx").on(t.customerId),
    index("subscribers_product_source_idx").on(t.productId, t.source),
    check(
      "subscribers_quiet_hours_ck",
      sql`(${t.quietHoursStart} IS NULL AND ${t.quietHoursEnd} IS NULL AND ${t.quietHoursTimezone} IS NULL)
        OR (${t.quietHoursStart} IS NOT NULL AND ${t.quietHoursEnd} IS NOT NULL
          AND ${t.quietHoursTimezone} IS NOT NULL
          AND ${t.quietHoursStart} >= 0 AND ${t.quietHoursStart} < 1440
          AND ${t.quietHoursEnd} >= 0 AND ${t.quietHoursEnd} < 1440
          AND length(${t.quietHoursTimezone}) BETWEEN 1 AND 64)`,
    ),
  ],
);

/**
 * An email list within a product.
 *
 * `product_updates` and `winback` are seeded lazily and keep the existing
 * subscriber columns as their canonical state, so every delivery path remains
 * backward compatible. Additional topics are opt-in by default.
 */
export const subscriptionTopics = pgTable(
  "subscription_topics",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    position: integer("position").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("subscription_topics_product_key_unique").on(t.productId, t.key),
    // FK target for preferences, so a preference cannot cross products.
    unique("subscription_topics_id_product_unique").on(t.id, t.productId),
    index("subscription_topics_product_position_idx").on(t.productId, t.position),
  ],
);

export const subscriberTopicPreferences = pgTable(
  "subscriber_topic_preferences",
  {
    subscriberId: uuid("subscriber_id").notNull(),
    topicId: uuid("topic_id").notNull(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    subscribed: boolean("subscribed").notNull().default(false),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: "subscriber_topic_preferences_pk",
      columns: [t.subscriberId, t.topicId],
    }),
    foreignKey({
      name: "subscriber_topic_preferences_subscriber_fk",
      columns: [t.subscriberId, t.productId],
      foreignColumns: [subscribers.id, subscribers.productId],
    }).onDelete("cascade"),
    foreignKey({
      name: "subscriber_topic_preferences_topic_fk",
      columns: [t.topicId, t.productId],
      foreignColumns: [subscriptionTopics.id, subscriptionTopics.productId],
    }).onDelete("cascade"),
    index("subscriber_topic_preferences_topic_idx").on(t.topicId),
  ],
);

export type DigestFrequency = (typeof digestFrequencyEnum.enumValues)[number];
export type Subscriber = typeof subscribers.$inferSelect;
export type NewSubscriber = typeof subscribers.$inferInsert;
export type SubscriptionTopic = typeof subscriptionTopics.$inferSelect;
export type NewSubscriptionTopic = typeof subscriptionTopics.$inferInsert;
export type SubscriberTopicPreference =
  typeof subscriberTopicPreferences.$inferSelect;