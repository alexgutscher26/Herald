import { index, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { products, workspaces } from "@/db/schema/workspaces";

const tz = { withTimezone: true } as const;

/**
 * A saved audience definition.
 *
 * Rules are stored as data, not SQL, so the same definition can be previewed,
 * reused by outbound messages and win-back campaigns, and counted before a
 * send. Only the three documented kinds are accepted: a customer trait, the
 * `plan` trait, and product-event activity.
 */
export type SegmentTraitOperator = "equals" | "contains" | "in" | "exists";

export type SegmentRule =
  | {
      type: "trait";
      key: string;
      operator: SegmentTraitOperator;
      value: string;
    }
  | { type: "plan"; operator: "equals" | "in"; value: string }
  | {
      type: "activity";
      event: string;
      operator: "performed" | "not_performed";
      withinDays: number;
    };

export const segments = pgTable(
  "segments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    rules: jsonb("rules").$type<SegmentRule[]>().notNull().default([]),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("segments_product_name_unique").on(t.productId, t.name),
    index("segments_product_created_idx").on(t.productId, t.createdAt),
  ],
);

export type Segment = typeof segments.$inferSelect;
export type NewSegment = typeof segments.$inferInsert;
