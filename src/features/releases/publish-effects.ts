import "server-only";

import { and, eq, inArray, isNull, ne, notExists, or, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { customers } from "@/db/schema/customers";
import { emailSuppressions } from "@/db/schema/email";
import { feedbackPosts } from "@/db/schema/feedback";
import { notificationDeliveries, buildDeliveryDedupeKey } from "@/db/schema/notifications";
import { releaseFeedbackLinks } from "@/db/schema/roadmap";
import { releaseTagLinks, releaseTags } from "@/db/schema/releases";
import {
  subscriberTopicPreferences,
  subscribers,
  subscriptionTopics,
} from "@/db/schema/subscribers";
import { queueFeedbackStatusNotifications } from "@/features/notifications/service";
import { createPreferenceToken } from "@/features/subscribers/preferences";
import { releaseTagTopicKey } from "@/features/subscribers/topics";

/**
 * Side effects shared by every path that publishes a release.
 *
 * Manual publishing (the editor, the list action) and the scheduled-release
 * publisher both call these helpers inside their own transaction, so the two
 * paths cannot diverge on what "published" means.
 */

export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Mark linked feedback shipped.
 *
 * Returns the requests this call actually changed, with their previous status,
 * so the caller can push the new status to linked issue trackers *after* the
 * transaction commits. Publishing is the only path that ships linked requests.
 */
export async function applyPublishedFeedbackEffects(
  tx: Transaction,
  productId: string,
  releaseId: string,
  now: Date,
): Promise<{ id: string; fromStatus: string }[]> {
  const links = await tx
    .select({ id: feedbackPosts.id, status: feedbackPosts.status })
    .from(releaseFeedbackLinks)
    .innerJoin(
      feedbackPosts,
      and(
        eq(feedbackPosts.id, releaseFeedbackLinks.feedbackPostId),
        eq(feedbackPosts.productId, productId),
      ),
    )
    .where(eq(releaseFeedbackLinks.releaseId, releaseId));
  const pending = [...new Map(links.map((link) => [link.id, link])).values()].filter(
    (link) => link.status !== "shipped",
  );
  if (pending.length === 0) return [];

  const changed = await tx
    .update(feedbackPosts)
    .set({ status: "shipped", updatedAt: now })
    .where(
      and(
        eq(feedbackPosts.productId, productId),
        inArray(
          feedbackPosts.id,
          pending.map((link) => link.id),
        ),
        ne(feedbackPosts.status, "shipped"),
      ),
    )
    .returning({ id: feedbackPosts.id });

  const previous = new Map(pending.map((link) => [link.id, link.status]));
  const shipped = changed.map((row) => ({
    id: row.id,
    fromStatus: previous.get(row.id) ?? "open",
  }));

  for (const row of shipped) {
    await queueFeedbackStatusNotifications(tx, {
      productId,
      postId: row.id,
      toStatus: "shipped",
      eventAt: now,
    });
  }

  return shipped;
}

/**
 * Queue one pending delivery per active subscriber that may actually receive
 * it. Suppressed addresses are excluded at queue time (they would be skipped at
 * send time anyway), and a subscriber linked to a banned customer is excluded
 * as well. This keeps the outbox and its delivery log honest about the audience
 * the pre-send preview shows.
 *
 * The unique dedupe key makes repeated publication idempotent.
 */
export async function queueReleaseDeliveries(
  tx: Transaction,
  input: {
    workspaceId: string;
    productId: string;
    releaseId: string;
  },
) {
  const tagRows = await tx
    .select({ slug: releaseTags.slug })
    .from(releaseTagLinks)
    .innerJoin(releaseTags, eq(releaseTagLinks.tagId, releaseTags.id))
    .where(eq(releaseTagLinks.releaseId, input.releaseId));
  const tagTopicKeys = tagRows.map((row) => releaseTagTopicKey(row.slug));

  const active = await tx
    .select({
      id: subscribers.id,
      email: subscribers.email,
      emailNormalized: subscribers.emailNormalized,
      unsubscribeToken: subscribers.unsubscribeToken,
    })
    .from(subscribers)
    .leftJoin(
      emailSuppressions,
      and(
        eq(emailSuppressions.workspaceId, input.workspaceId),
        eq(emailSuppressions.emailNormalized, subscribers.emailNormalized),
      ),
    )
    .leftJoin(customers, eq(subscribers.customerId, customers.id))
    .where(
      and(
        eq(subscribers.productId, input.productId),
        eq(subscribers.status, "active"),
        isNull(emailSuppressions.id),
        or(isNull(subscribers.customerId), isNull(customers.bannedAt)),
        tagTopicKeys.length === 0
          ? undefined
          : notExists(
              tx
                .select({ one: sql`1` })
                .from(subscriberTopicPreferences)
                .innerJoin(
                  subscriptionTopics,
                  eq(subscriberTopicPreferences.topicId, subscriptionTopics.id),
                )
                .where(
                  and(
                    eq(subscriberTopicPreferences.subscriberId, subscribers.id),
                    eq(subscriberTopicPreferences.productId, input.productId),
                    eq(subscriberTopicPreferences.subscribed, false),
                    inArray(subscriptionTopics.key, tagTopicKeys),
                  ),
                ),
            ),
      ),
    );

  if (active.length === 0) return;
  // The link in the email is the only way to change preferences without an
  // account, so every recipient gets a token before the delivery is queued.
  const now = new Date();
  for (const subscriber of active) {
    if (subscriber.unsubscribeToken) continue;
    await tx
      .update(subscribers)
      .set({ unsubscribeToken: createPreferenceToken(), updatedAt: now })
      .where(eq(subscribers.id, subscriber.id));
  }

  await tx
    .insert(notificationDeliveries)
    .values(
      active.map((subscriber) => ({
        workspaceId: input.workspaceId,
        productId: input.productId,
        template: "release_published" as const,
        releaseId: input.releaseId,
        recipientEmail: subscriber.email,
        recipientEmailNormalized: subscriber.emailNormalized,
        status: "pending" as const,
        dedupeKey: buildDeliveryDedupeKey({
          template: "release_published",
          productId: input.productId,
          recipientEmailNormalized: subscriber.emailNormalized,
          sourceId: input.releaseId,
        }),
      })),
    )
    .onConflictDoNothing();
}
