import {
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { customers } from "@/db/schema/customers";
import { products, workspaces } from "@/db/schema/workspaces";

const tz = { withTimezone: true } as const;

export type CustomerEventProperties = Record<string, string | number | boolean | null>;

/**
 * Product events recorded through `POST /api/v1/events`.
 *
 * Deliberately separate from `analytics_events`: those are the narrow, public
 * interaction counters, while these are customer-scoped product events used for
 * targeting and automation. A customer is always resolved inside the token's
 * workspace; `event_id` is the caller's own dedupe key, unique per product.
 */
export const customerEvents = pgTable(
  "customer_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").notNull(),
    name: text("name").notNull(),
    /** Caller-supplied idempotency id; null when the SDK used no event id. */
    eventId: text("event_id"),
    properties: jsonb("properties")
      .$type<CustomerEventProperties>()
      .notNull()
      .default({}),
    occurredAt: timestamp("occurred_at", tz).notNull().defaultNow(),
    receivedAt: timestamp("received_at", tz).notNull().defaultNow(),
    source: text("source").notNull().default("api"),
  },
  (t) => [
    // Composite target keeps the customer in the same tenant as the event.
    foreignKey({
      columns: [t.customerId, t.workspaceId],
      foreignColumns: [customers.id, customers.workspaceId],
      name: "customer_events_customer_fk",
    }).onDelete("cascade"),
    // Postgres allows many NULLs, so an event without an id is never deduped.
    unique("customer_events_product_event_unique").on(t.productId, t.eventId),
    index("customer_events_product_time_idx").on(t.productId, t.occurredAt),
    index("customer_events_customer_time_idx").on(t.customerId, t.occurredAt),
    index("customer_events_product_name_time_idx").on(
      t.productId,
      t.name,
      t.occurredAt,
    ),
  ],
);

export type CustomerEvent = typeof customerEvents.$inferSelect;
export type NewCustomerEvent = typeof customerEvents.$inferInsert;
