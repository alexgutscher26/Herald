import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "@/db/schema/auth";
import { feedbackPosts } from "@/db/schema/feedback";
import { products } from "@/db/schema/workspaces";

const tz = { withTimezone: true } as const;

/**
 * The team's stored prioritisation inputs for a request.
 *
 * Only inputs live here. Scores, ratios and requester weights are computed
 * from these rows plus the votes, comments and companies already in the
 * database, so a displayed number is always traceable to a stored fact. A
 * missing input stays `NULL` and renders as "—" rather than zero.
 *
 * `impact` is expected customer impact, `businessValue` the value to the
 * business and `effort` the delivery cost; each uses the same 1–5 scale so a
 * value/effort ratio is meaningful. The scale is deliberately small: it is a
 * judgement the team makes consistently, not false precision.
 */
export const feedbackPrioritisation = pgTable(
  "feedback_prioritisation",
  {
    feedbackPostId: uuid("feedback_post_id").primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    impact: integer("impact"),
    businessValue: integer("business_value"),
    effort: integer("effort"),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "feedback_prioritisation_post_fk",
      columns: [t.feedbackPostId, t.productId],
      foreignColumns: [feedbackPosts.id, feedbackPosts.productId],
    }).onDelete("cascade"),
    check(
      "feedback_prioritisation_impact_ck",
      sql`${t.impact} is null or (${t.impact} between 1 and 5)`,
    ),
    check(
      "feedback_prioritisation_value_ck",
      sql`${t.businessValue} is null or (${t.businessValue} between 1 and 5)`,
    ),
    check(
      "feedback_prioritisation_effort_ck",
      sql`${t.effort} is null or (${t.effort} between 1 and 5)`,
    ),
    index("feedback_prioritisation_product_impact_idx").on(t.productId, t.impact),
  ],
);

export type FeedbackPrioritisationRow = typeof feedbackPrioritisation.$inferSelect;
export type NewFeedbackPrioritisationRow =
  typeof feedbackPrioritisation.$inferInsert;
