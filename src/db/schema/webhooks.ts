import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "@/db/schema/auth";
import { workspaces } from "@/db/schema/workspaces";

const tz = { withTimezone: true } as const;

/**
 * Workspace outbound webhooks.
 *
 * The signing secret is stored so deliveries can be signed after a restart; it
 * is returned once at creation and never included in a listing. Rotation keeps
 * the previous secret only until `previous_secret_expires_at`, so a receiver
 * can deploy the new secret without dropping in-flight deliveries.
 *
 * `events` is a JSON array so a new event type needs no migration. The check
 * constraint keeps it an array and a subset of the known events, matching the
 * validation in the feature module.
 */
export const WEBHOOK_EVENTS = [
  "request.created",
  "request.updated",
  "comment.created",
  "changelog.created",
  "conversation.updated",
  "message.created",
  "customer.event",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const WEBHOOK_DELIVERY_STATUSES = [
  "pending",
  "succeeded",
  "failed",
  "skipped",
] as const;
export type WebhookDeliveryStatus = (typeof WEBHOOK_DELIVERY_STATUSES)[number];

export const webhooks = pgTable(
  "webhooks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    url: text("url").notNull(),
    secret: text("secret").notNull(),
    /** Accepted (and sent as a second signature) until the overlap ends. */
    previousSecret: text("previous_secret"),
    previousSecretExpiresAt: timestamp("previous_secret_expires_at", tz),
    events: jsonb("events").$type<WebhookEvent[]>().notNull().default([...WEBHOOK_EVENTS]),
    active: boolean("active").notNull().default(true),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    index("webhooks_workspace_active_idx").on(t.workspaceId, t.active),
    check("webhooks_name_ck", sql`length(${t.name}) between 1 and 120`),
    check("webhooks_url_ck", sql`${t.url} ~ '^https?://'`),
    check("webhooks_secret_ck", sql`length(${t.secret}) >= 20`),
    check(
      "webhooks_previous_secret_ck",
      sql`${t.previousSecret} is null or length(${t.previousSecret}) >= 20`,
    ),
    check(
      "webhooks_previous_secret_expiry_ck",
      sql`${t.previousSecret} is null or ${t.previousSecretExpiresAt} is not null`,
    ),
    check(
      "webhooks_events_ck",
      sql`jsonb_typeof(${t.events}) = 'array' and ${t.events} <@ '["request.created","request.updated","comment.created","changelog.created","conversation.updated","message.created","customer.event"]'::jsonb`,
    ),
  ],
);

/**
 * One delivery attempt chain for one event and one webhook.
 *
 * The payload is frozen at enqueue time so retries and manual replays send
 * exactly the bytes that were signed. `next_attempt_at` doubles as a lease:
 * a worker moves it forward before calling out, so two workers cannot send the
 * same row concurrently.
 */
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    webhookId: uuid("webhook_id")
      .notNull()
      .references(() => webhooks.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    payload: jsonb("payload").$type<unknown>().notNull(),
    status: text("status").$type<WebhookDeliveryStatus>().notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    responseStatus: integer("response_status"),
    error: text("error"),
    nextAttemptAt: timestamp("next_attempt_at", tz).notNull().defaultNow(),
    lastAttemptAt: timestamp("last_attempt_at", tz),
    deliveredAt: timestamp("delivered_at", tz),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    index("webhook_deliveries_due_idx").on(t.status, t.nextAttemptAt),
    index("webhook_deliveries_webhook_created_idx").on(t.webhookId, t.createdAt),
    check(
      "webhook_deliveries_status_ck",
      sql`${t.status} in ('pending','succeeded','failed','skipped')`,
    ),
    check("webhook_deliveries_attempts_ck", sql`${t.attempts} >= 0`),
  ],
);

export type Webhook = typeof webhooks.$inferSelect;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
