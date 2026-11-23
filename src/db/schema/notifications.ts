import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { conversationMessages, conversations } from "@/db/schema/conversations";
import { customers } from "@/db/schema/customers";
import { feedbackComments, feedbackPosts } from "@/db/schema/feedback";
import { releases } from "@/db/schema/releases";
import { winbackCampaignRecipients } from "@/db/schema/winback";
import { outboundMessages } from "@/db/schema/engagement";
import { products, workspaces } from "@/db/schema/workspaces";

const tz = { withTimezone: true } as const;

export const notificationChannelEnum = pgEnum("notification_channel", ["email"]);

export const notificationTemplateEnum = pgEnum("notification_template", [
  "release_published",
  "winback_campaign",
  "feedback_status_changed",
  "feedback_reply",
  "conversation_reply",
  "conversation_csat",
  "conversation_notification",
  "conversation_away_reply",
  "conversation_transcript",
  "weekly_digest",
  "daily_digest",
  "outbound_message",
]);

export const deliveryStatusEnum = pgEnum("notification_delivery_status", [
  "pending",
  "sent",
  "failed",
  "bounced",
  "complained",
  "skipped",
]);

/**
 * One row per intended outbound message.
 *
 * `dedupeKey` is the idempotency key: it is generated once, before any send
 * attempt, and made unique so retries and repeated job runs cannot produce a
 * second message for the same logical event.
 *
 * Each row has exactly one source — a published release *or* a win-back
 * recipient — enforced by a check constraint rather than by convention.
 */
export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    channel: notificationChannelEnum("channel").notNull().default("email"),
    template: notificationTemplateEnum("template").notNull(),
    releaseId: uuid("release_id").references(() => releases.id, { onDelete: "cascade" }),
    winbackRecipientId: uuid("winback_recipient_id").references(
      () => winbackCampaignRecipients.id,
      { onDelete: "cascade" },
    ),
    outboundMessageId: uuid("outbound_message_id").references(
      () => outboundMessages.id,
      { onDelete: "cascade" },
    ),
    feedbackPostId: uuid("feedback_post_id").references(() => feedbackPosts.id, {
      onDelete: "cascade",
    }),
    feedbackCommentId: uuid("feedback_comment_id").references(
      () => feedbackComments.id,
      { onDelete: "cascade" },
    ),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "cascade",
    }),
    conversationMessageId: uuid("conversation_message_id").references(
      () => conversationMessages.id,
      { onDelete: "cascade" },
    ),
    recipientCustomerId: uuid("recipient_customer_id").references(
      () => customers.id,
      { onDelete: "set null" },
    ),
    recipientEmail: text("recipient_email").notNull(),
    recipientEmailNormalized: text("recipient_email_normalized").notNull(),
    status: deliveryStatusEnum("status").notNull().default("pending"),
    dedupeKey: text("dedupe_key").notNull().unique(),
    providerMessageId: text("provider_message_id"),
    attemptCount: integer("attempt_count").notNull().default(0),
    sentAt: timestamp("sent_at", tz),
    /**
     * Not before this instant. Quiet-hour deferral sets a short moving marker
     * so the periodic outbox sweep leaves the row alone until the subscriber's
     * local window closes. A manual retry clears it.
     */
    deferUntil: timestamp("defer_until", tz),
    error: text("error"),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    index("notification_deliveries_product_status_idx").on(t.productId, t.status),
    index("notification_deliveries_workspace_sent_idx").on(
      t.workspaceId,
      t.status,
      t.sentAt,
    ),
    index("notification_deliveries_pending_defer_idx").on(t.status, t.deferUntil),
    index("notification_deliveries_release_idx").on(t.releaseId),
    index("notification_deliveries_recipient_idx").on(t.winbackRecipientId),
    index("notification_deliveries_feedback_post_idx").on(t.feedbackPostId),
    index("notification_deliveries_conversation_idx").on(t.conversationId),
    index("notification_deliveries_customer_idx").on(t.recipientCustomerId),
    index("notification_deliveries_outbound_idx").on(t.outboundMessageId),
  ],
);

export const inAppNotificationKindEnum = pgEnum("in_app_notification_kind", [
  "feedback_status_changed",
  "feedback_reply",
  "release_published",
  "outbound_message",
]);

/**
 * The unread badge's source of truth.
 *
 * One row per customer and event. `dedupeKey` is unique, so replaying a status
 * change or a job cannot create a second unread item. Reading is recorded on
 * the row instead of deleting it, which keeps the inbox stable across devices.
 */
export const inAppNotifications = pgTable(
  "in_app_notifications",
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
    kind: inAppNotificationKindEnum("kind").notNull(),
    feedbackPostId: uuid("feedback_post_id").references(() => feedbackPosts.id, {
      onDelete: "cascade",
    }),
    releaseId: uuid("release_id").references(() => releases.id, { onDelete: "cascade" }),
    outboundMessageId: uuid("outbound_message_id").references(
      () => outboundMessages.id,
      { onDelete: "cascade" },
    ),
    title: text("title").notNull(),
    body: text("body").notNull(),
    href: text("href").notNull(),
    dedupeKey: text("dedupe_key").notNull().unique(),
    readAt: timestamp("read_at", tz),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    index("in_app_notifications_customer_created_idx").on(t.customerId, t.createdAt),
    index("in_app_notifications_customer_read_idx").on(t.customerId, t.readAt),
    index("in_app_notifications_product_idx").on(t.productId),
  ],
);

export type NotificationTemplate = (typeof notificationTemplateEnum.enumValues)[number];
export type NotificationDelivery = typeof notificationDeliveries.$inferSelect;
export type NewNotificationDelivery = typeof notificationDeliveries.$inferInsert;
export type InAppNotification = typeof inAppNotifications.$inferSelect;
export type NewInAppNotification = typeof inAppNotifications.$inferInsert;

/** Stable idempotency key for one logical outbound message. */
export function buildDeliveryDedupeKey(input: {
  template: NotificationTemplate;
  productId: string;
  recipientEmailNormalized: string;
  sourceId: string;
}): string {
  return [
    input.template,
    input.productId,
    input.recipientEmailNormalized,
    input.sourceId,
  ].join(":");
}