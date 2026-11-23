import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db";
import { customerReleaseViews } from "@/db/schema/releases";

/**
 * Remember that a signed-in customer opened a published release.
 *
 * Only the public changelog detail view calls this, and only after the page has
 * resolved the release for that product. Repeat views update one row instead
 * of growing an event log; the support timeline needs the latest view, not a
 * browsing history.
 */
export async function recordCustomerReleaseView(input: {
  workspaceId: string;
  productId: string;
  customerId: string;
  releaseId: string;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();
  try {
    await db
      .insert(customerReleaseViews)
      .values({
        workspaceId: input.workspaceId,
        productId: input.productId,
        customerId: input.customerId,
        releaseId: input.releaseId,
        firstViewedAt: now,
        lastViewedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          customerReleaseViews.customerId,
          customerReleaseViews.releaseId,
        ],
        set: {
          lastViewedAt: now,
          viewCount: sql`${customerReleaseViews.viewCount} + 1`,
        },
      });
  } catch (error) {
    // The changelog must render even when the support timeline cannot record
    // this view; the next successful view refreshes the same row.
    console.error("[releases] customer view tracking failed", error);
  }
}
