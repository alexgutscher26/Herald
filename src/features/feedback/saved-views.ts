import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { feedbackSavedViews } from "@/db/schema/feedback-views";
import type { FeedbackSavedView, FeedbackSavedViewFilters } from "@/types";

import { normalizeViewFilters } from "./saved-view-filters";

/**
 * Saved inbox views.
 *
 * The product and user ids are arguments the server action already authorized;
 * neither is accepted from the client. Saving an existing name replaces its
 * filters through the unique (product, user, name) index.
 */

function toView(row: typeof feedbackSavedViews.$inferSelect): FeedbackSavedView {
  return {
    id: row.id,
    productId: row.productId,
    name: row.name,
    filters: normalizeViewFilters(row.filters),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function saveFeedbackView(input: {
  productId: string;
  userId: string;
  name: string;
  filters: FeedbackSavedViewFilters;
}): Promise<FeedbackSavedView> {
  const filters = normalizeViewFilters(input.filters);
  const rows = await db
    .insert(feedbackSavedViews)
    .values({
      productId: input.productId,
      userId: input.userId,
      name: input.name,
      filters,
    })
    .onConflictDoUpdate({
      target: [
        feedbackSavedViews.productId,
        feedbackSavedViews.userId,
        feedbackSavedViews.name,
      ],
      set: { filters, updatedAt: new Date() },
    })
    .returning();

  const row = rows[0];
  if (!row) throw new Error("The saved view could not be stored.");
  return toView(row);
}

/** Returns false when the view does not exist for this product and user. */
export async function deleteFeedbackView(input: {
  productId: string;
  userId: string;
  viewId: string;
}): Promise<boolean> {
  const deleted = await db
    .delete(feedbackSavedViews)
    .where(
      and(
        eq(feedbackSavedViews.id, input.viewId),
        eq(feedbackSavedViews.productId, input.productId),
        eq(feedbackSavedViews.userId, input.userId),
      ),
    )
    .returning({ id: feedbackSavedViews.id });

  return deleted.length > 0;
}
