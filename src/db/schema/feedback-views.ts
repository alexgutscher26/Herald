import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { user } from "@/db/schema/auth";
import { products } from "@/db/schema/workspaces";
import type { FeedbackSavedViewFilters } from "@/types";

const tz = { withTimezone: true } as const;

/**
 * A member's private saved inbox view.
 *
 * Views are scoped to both the product and the signed-in user: one member's
 * filters are never returned to another, and a view can never point at a
 * client-supplied product id. The name is unique per member and product so
 * saving the same name updates that view instead of duplicating it.
 */
export const feedbackSavedViews = pgTable(
  "feedback_saved_views",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    filters: jsonb("filters").$type<FeedbackSavedViewFilters>().notNull().default({
      search: "",
      status: "all",
      category: "all",
      sort: "newest",
      customFields: {},
    }),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("feedback_saved_views_product_user_name_unique").on(
      t.productId,
      t.userId,
      t.name,
    ),
    index("feedback_saved_views_product_user_idx").on(t.productId, t.userId),
  ],
);

export type FeedbackSavedViewRow = typeof feedbackSavedViews.$inferSelect;
export type NewFeedbackSavedView = typeof feedbackSavedViews.$inferInsert;
