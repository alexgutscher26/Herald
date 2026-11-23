import { boolean, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { user } from "@/db/schema/auth";
import { conversations } from "@/db/schema/conversations";
import { feedbackPosts } from "@/db/schema/feedback";
import { products, workspaces } from "@/db/schema/workspaces";

const tz = { withTimezone: true } as const;

/**
 * One Slack installation per product, bound to one channel.
 *
 * A product may be connected to one channel and a Slack team may connect
 * several products to different channels; `(team_id, channel_id)` is unique so
 * one inbound message can never map to two products. The bot token is a secret:
 * it is never returned by the settings page or written to a log.
 */
export const slackIntegrations = pgTable(
  "slack_integrations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    teamId: text("team_id").notNull(),
    teamName: text("team_name").notNull(),
    botUserId: text("bot_user_id"),
    accessToken: text("access_token").notNull(),
    scopes: text("scopes").notNull(),
    channelId: text("channel_id"),
    channelName: text("channel_name"),
    active: boolean("active").notNull().default(true),
    installedBy: text("installed_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("slack_integrations_product_unique").on(t.productId),
    unique("slack_integrations_team_channel_unique").on(t.teamId, t.channelId),
    index("slack_integrations_event_idx").on(t.teamId, t.channelId, t.active),
  ],
);

/** One-time, short-lived OAuth state. Only the hash is stored. */
export const slackOAuthStates = pgTable(
  "slack_oauth_states",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    stateHash: text("state_hash").notNull().unique(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", tz).notNull(),
    usedAt: timestamp("used_at", tz),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [index("slack_oauth_states_expiry_idx").on(t.expiresAt)],
);

/**
 * The conversation thread that produced a request.
 *
 * The original message timestamp is the thread root, so every later status
 * reply lands under the message a teammate already understands. `request_id`
 * is unique: a request has one origin thread.
 */
export const slackRequestLinks = pgTable(
  "slack_request_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    requestId: uuid("request_id")
      .notNull()
      .references(() => feedbackPosts.id, { onDelete: "cascade" }),
    teamId: text("team_id").notNull(),
    channelId: text("channel_id").notNull(),
    messageTs: text("message_ts").notNull(),
    confirmationTs: text("confirmation_ts"),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("slack_request_links_request_unique").on(t.requestId),
    unique("slack_request_links_message_unique").on(t.teamId, t.channelId, t.messageTs),
    index("slack_request_links_product_idx").on(t.productId),
  ],
);

/**
 * Maps a Slack thread to a support conversation.
 *
 * The thread root is the top-level `!support` message. A reply in that thread
 * continues the conversation instead of creating a second one, while a reply in
 * any other thread remains plain channel chatter. One conversation has at most
 * one origin thread, and a thread belongs to one product.
 */
export const slackConversationLinks = pgTable(
  "slack_conversation_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    teamId: text("team_id").notNull(),
    channelId: text("channel_id").notNull(),
    threadTs: text("thread_ts").notNull(),
    createdBySlackUser: text("created_by_slack_user"),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("slack_conversation_links_conversation_unique").on(t.conversationId),
    unique("slack_conversation_links_thread_unique").on(
      t.teamId,
      t.channelId,
      t.threadTs,
    ),
    index("slack_conversation_links_product_idx").on(t.productId),
  ],
);

export type SlackIntegration = typeof slackIntegrations.$inferSelect;
export type SlackRequestLink = typeof slackRequestLinks.$inferSelect;
export type SlackConversationLink = typeof slackConversationLinks.$inferSelect;
