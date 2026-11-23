import "server-only";

import { and, asc, eq, lte } from "drizzle-orm";

import { db } from "@/db";
import { releases } from "@/db/schema/releases";
import { products } from "@/db/schema/workspaces";
import { recordFirstRelease } from "@/features/analytics/signup-funnel";
import { queueReleaseInAppNotifications } from "@/features/notifications/service";
import { pushFeedbackStatusToIssueTracker } from "@/features/integrations/issue-service";
import { invalidateAllPublicReleases } from "@/features/public/payload-cache";
import { createReleaseSuggestions } from "@/features/winback/suggestions";
import { logEvent, serializeError } from "@/lib/logger";

import { applyPublishedFeedbackEffects, queueReleaseDeliveries } from "./publish-effects";
import {
  ensureInitialRevision,
  loadReleaseSnapshot,
  recordReleaseRevision,
} from "./revision-service";

/**
 * Promotes scheduled releases whose time has arrived.
 *
 * Safety properties:
 *  - Each release is published in its own transaction, so one bad row cannot
 *    block the rest of the batch.
 *  - The update is guarded on `status = 'scheduled'`, so two overlapping cron
 *    runs cannot both publish the same release or double-queue its deliveries.
 *  - Publishing reuses the same side effects as the manual publish action
 *    (feedback marked shipped, pending deliveries recorded).
 */

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export type PublishedReleaseSummary = {
  id: string;
  productId: string;
  title: string;
};

export type PublishDueReleasesResult = {
  checkedAt: string;
  published: PublishedReleaseSummary[];
  failed: { id: string; error: string }[];
};

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_LIMIT);
}

export async function publishDueReleases(
  options: { now?: Date; limit?: number } = {},
): Promise<PublishDueReleasesResult> {
  const now = options.now ?? new Date();
  const limit = clampLimit(options.limit ?? DEFAULT_LIMIT);

  const due = await db
    .select({
      id: releases.id,
      title: releases.title,
      productId: releases.productId,
      publishedAt: releases.publishedAt,
      workspaceId: products.workspaceId,
    })
    .from(releases)
    .innerJoin(products, eq(products.id, releases.productId))
    .where(and(eq(releases.status, "scheduled"), lte(releases.scheduledFor, now)))
    .orderBy(asc(releases.scheduledFor))
    .limit(limit);

  const published: PublishedReleaseSummary[] = [];
  const failed: { id: string; error: string }[] = [];

  for (const release of due) {
    try {
      const didPublish = await db.transaction(async (tx) => {
        await ensureInitialRevision(tx, {
          productId: release.productId,
          releaseId: release.id,
        });

        const updated = await tx
          .update(releases)
          .set({
            status: "published",
            publishedAt: release.publishedAt ?? now,
            scheduledFor: null,
            updatedAt: now,
          })
          .where(and(eq(releases.id, release.id), eq(releases.status, "scheduled")))
          .returning({
            id: releases.id,
            channelSubscriberEmail: releases.channelSubscriberEmail,
            channelPublicChangelog: releases.channelPublicChangelog,
          });

        const row = updated[0];
        if (!row) return false; // Another worker published it first.

        const shippedRequests = await applyPublishedFeedbackEffects(
          tx,
          release.productId,
          release.id,
          now,
        );
        if (row.channelPublicChangelog) {
          await queueReleaseInAppNotifications(tx, {
            workspaceId: release.workspaceId,
            productId: release.productId,
            releaseId: release.id,
          });
        }
        if (row.channelSubscriberEmail) {
          await queueReleaseDeliveries(tx, {
            workspaceId: release.workspaceId,
            productId: release.productId,
            releaseId: release.id,
          });
        }
        await createReleaseSuggestions(tx, {
          workspaceId: release.workspaceId,
          productId: release.productId,
          releaseId: release.id,
        });

        const snapshot = await loadReleaseSnapshot(tx, release.productId, release.id);
        if (snapshot) {
          await recordReleaseRevision(tx, {
            productId: release.productId,
            releaseId: release.id,
            action: "publish",
            createdBy: null,
            snapshot,
          });
        }
        return shippedRequests;
      });

      if (didPublish) {
        for (const request of didPublish.slice(0, 50)) {
          await pushFeedbackStatusToIssueTracker({
            productId: release.productId,
            feedbackPostId: request.id,
            fromStatus: request.fromStatus,
            toStatus: "shipped",
          });
        }
        invalidateAllPublicReleases();
        await recordFirstRelease(release.productId);
        published.push({ id: release.id, productId: release.productId, title: release.title });
      }
    } catch (error) {
      logEvent("error", "release.publish_failed", {
        releaseId: release.id,
        error: serializeError(error),
      });
      failed.push({ id: release.id, error: "Could not publish this release." });
    }
  }

  return { checkedAt: now.toISOString(), published, failed };
}
