import {
  boolean,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "@/db/schema/auth";
import { feedbackPosts } from "@/db/schema/feedback";
import { products, workspaces } from "@/db/schema/workspaces";

const tz = { withTimezone: true } as const;

export const issueTrackerProviderEnum = pgEnum("issue_tracker_provider", [
  "linear",
  "jira",
  "github",
  "clickup",
  "azure_devops",
]);

export const issueLinkStateEnum = pgEnum("issue_link_state", [
  "pending",
  "linked",
  "failed",
]);

export const issueSyncDirectionEnum = pgEnum("issue_sync_direction", [
  "outbound",
  "inbound",
]);

export const issueSyncOutcomeEnum = pgEnum("issue_sync_outcome", [
  "succeeded",
  "skipped",
  "failed",
]);

export const crmProviderEnum = pgEnum("crm_provider", ["hubspot", "salesforce"]);

/**
 * One issue-tracker connection per product and provider.
 *
 * `apiToken` and `webhookSecret` are secrets and are never selected by a page
 * or returned to a client. `webhookToken` is the unguessable path segment used
 * by providers that cannot sign an admin webhook (Jira and Azure DevOps); it is
 * shown only on the settings page so an administrator can paste the URL.
 */
export const issueTrackerConnections = pgTable(
  "issue_tracker_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    provider: issueTrackerProviderEnum("provider").notNull(),
    name: text("name").notNull(),
    /** Non-secret provider fields: team, project, repository, board, etc. */
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    /** External status name → Herald status. Keys are compared lower-cased. */
    statusMap: jsonb("status_map")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    apiToken: text("api_token").notNull(),
    webhookSecret: text("webhook_secret"),
    webhookToken: text("webhook_token").notNull().unique(),
    active: boolean("active").notNull().default(true),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("issue_tracker_connections_product_provider_unique").on(
      t.productId,
      t.provider,
    ),
    // Composite target so an issue link cannot mix tenants.
    unique("issue_tracker_connections_tenant_unique").on(
      t.id,
      t.workspaceId,
      t.productId,
    ),
    index("issue_tracker_connections_product_idx").on(t.productId, t.active),
  ],
);

/**
 * The link between one request and one external issue.
 *
 * The pending row is inserted before the provider call. That is the
 * idempotency boundary: a double click, a retry, or two workers cannot create
 * two external issues for the same request/connection. If the provider call
 * succeeds but the response is lost, the row stays pending and the UI asks a
 * person to link the issue manually rather than silently creating a duplicate.
 */
export const issueLinks = pgTable(
  "issue_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id").notNull(),
    feedbackPostId: uuid("feedback_post_id").notNull(),
    provider: issueTrackerProviderEnum("provider").notNull(),
    state: issueLinkStateEnum("state").notNull().default("pending"),
    externalId: text("external_id").notNull(),
    externalKey: text("external_key"),
    externalUrl: text("external_url"),
    externalStatus: text("external_status"),
    lastEventAt: timestamp("last_event_at", tz),
    lastError: text("last_error"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "issue_links_connection_fk",
      columns: [t.connectionId, t.workspaceId, t.productId],
      foreignColumns: [
        issueTrackerConnections.id,
        issueTrackerConnections.workspaceId,
        issueTrackerConnections.productId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "issue_links_feedback_fk",
      columns: [t.feedbackPostId, t.productId],
      foreignColumns: [feedbackPosts.id, feedbackPosts.productId],
    }).onDelete("cascade"),
    unique("issue_links_post_connection_unique").on(t.feedbackPostId, t.connectionId),
    unique("issue_links_external_unique").on(t.connectionId, t.externalId),
    index("issue_links_product_post_idx").on(t.productId, t.feedbackPostId),
    index("issue_links_connection_external_idx").on(t.connectionId, t.externalId),
  ],
);

/**
 * Immutable audit rows for both directions.
 *
 * `dedupeKey` is unique, so a provider retry cannot apply the same status twice
 * or write two audit rows. `actorUserId` attributes a team-initiated write;
 * `actorName` records the external actor from a webhook when the provider
 * supplies one.
 */
export const issueSyncEvents = pgTable(
  "issue_sync_events",
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
      .references(() => issueTrackerConnections.id, { onDelete: "cascade" }),
    issueLinkId: uuid("issue_link_id").references(() => issueLinks.id, {
      onDelete: "set null",
    }),
    feedbackPostId: uuid("feedback_post_id").references(() => feedbackPosts.id, {
      onDelete: "set null",
    }),
    direction: issueSyncDirectionEnum("direction").notNull(),
    action: text("action").notNull(),
    outcome: issueSyncOutcomeEnum("outcome").notNull(),
    dedupeKey: text("dedupe_key").notNull().unique(),
    externalId: text("external_id"),
    externalStatus: text("external_status"),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    actorUserId: text("actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    actorName: text("actor_name"),
    detail: text("detail"),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    index("issue_sync_events_product_time_idx").on(t.productId, t.createdAt),
    index("issue_sync_events_connection_time_idx").on(t.connectionId, t.createdAt),
  ],
);

/**
 * Workspace-scoped read-only CRM credentials.
 *
 * The sync job is the only writer of the cached CRM columns on customers and
 * companies. No dashboard form accepts those cached values, so a browser
 * cannot invent a revenue or deal total.
 */
export const crmConnections = pgTable(
  "crm_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    provider: crmProviderEnum("provider").notNull(),
    name: text("name").notNull(),
    apiToken: text("api_token").notNull(),
    /** Salesforce instance origin; null for HubSpot. */
    instanceUrl: text("instance_url"),
    active: boolean("active").notNull().default(true),
    lastSyncedAt: timestamp("last_synced_at", tz),
    lastError: text("last_error"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("crm_connections_workspace_provider_unique").on(t.workspaceId, t.provider),
    index("crm_connections_workspace_idx").on(t.workspaceId, t.active),
  ],
);

export type IssueTrackerConnection = typeof issueTrackerConnections.$inferSelect;
export type NewIssueTrackerConnection = typeof issueTrackerConnections.$inferInsert;
export type IssueLink = typeof issueLinks.$inferSelect;
export type NewIssueLink = typeof issueLinks.$inferInsert;
export type IssueSyncEvent = typeof issueSyncEvents.$inferSelect;
export type CrmConnection = typeof crmConnections.$inferSelect;
export type NewCrmConnection = typeof crmConnections.$inferInsert;
export type IssueTrackerProvider = (typeof issueTrackerProviderEnum.enumValues)[number];
export type CrmProvider = (typeof crmProviderEnum.enumValues)[number];
