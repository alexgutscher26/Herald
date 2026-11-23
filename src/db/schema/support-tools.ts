import {
  boolean,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "@/db/schema/auth";
import { boards } from "@/db/schema/boards";
import { feedbackPosts } from "@/db/schema/feedback";
import { products, workspaces } from "@/db/schema/workspaces";

const tz = { withTimezone: true } as const;

export const supportToolProviderEnum = pgEnum("support_tool_provider", [
  "intercom",
  "zendesk",
]);
export type SupportToolProvider = (typeof supportToolProviderEnum.enumValues)[number];

/**
 * Capture connection for a support tool.
 *
 * Intercom and Zendesk push a webhook with a conversation or ticket. The
 * unguessable path token is the authenticator, like the Jira/Azure issue
 * webhooks: both providers can send their standard payload without Herald
 * needing their OAuth grant. Only the token is stored; it is shown on the
 * settings page so an administrator can paste the URL into the provider.
 */
export const supportToolConnections = pgTable(
  "support_tool_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    provider: supportToolProviderEnum("provider").notNull(),
    name: text("name").notNull(),
    /** New captures become requests on this board. */
    boardId: uuid("board_id").notNull(),
    webhookToken: text("webhook_token").notNull().unique(),
    active: boolean("active").notNull().default(true),
    lastEventAt: timestamp("last_event_at", tz),
    lastError: text("last_error"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("support_tool_connections_product_provider_unique").on(t.productId, t.provider),
    foreignKey({
      name: "support_tool_connections_board_fk",
      columns: [t.boardId, t.productId],
      foreignColumns: [boards.id, boards.productId],
    }).onDelete("cascade"),
    index("support_tool_connections_product_idx").on(t.productId, t.active),
  ],
);

/**
 * Dedupe boundary for provider retries and duplicate webhook subscriptions.
 * The request is written in the same transaction as this row, so a retry can
 * never create a second request for one external conversation.
 */
export const supportToolCaptures = pgTable(
  "support_tool_captures",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => supportToolConnections.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    feedbackPostId: uuid("feedback_post_id").references(() => feedbackPosts.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("support_tool_captures_external_unique").on(t.connectionId, t.externalId),
    index("support_tool_captures_product_idx").on(t.productId, t.createdAt),
  ],
);

export type SupportToolConnection = typeof supportToolConnections.$inferSelect;
export type SupportToolCapture = typeof supportToolCaptures.$inferSelect;
