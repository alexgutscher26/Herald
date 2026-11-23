import "server-only";

import {
  and,
  asc,
  count,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  notExists,
  sql,
} from "drizzle-orm";

import { db } from "@/db";
import { customers } from "@/db/schema/customers";
import { emailSuppressions } from "@/db/schema/email";
import { feedbackFollowers } from "@/db/schema/feedback-extensions";
import {
  subscriberTopicPreferences,
  subscribers,
  subscriptionTopics,
} from "@/db/schema/subscribers";
import { releaseTagTopicKey } from "@/features/subscribers/topics";

import {
  SUPPRESSION_REASONS,
  type AudienceRecipient,
  type AudienceSuppressionReason,
  type AudienceSuppressedAddress,
  type ReleaseAudiencePreview,
} from "./audience-types";

/**
 * Build the audience that a release email would address.
 *
 * Recipients are active subscribers that are not on the workspace's
 * suppression list. `source` answers "why am I on this list"; the linked
 * request flag adds "and you asked for this update". Suppressed and
 * unsubscribed addresses are counted separately so a pre-send screen never
 * implies a larger audience than the outbox will actually have.
 *
 * This is read-only and never queues a delivery.
 */

const RECIPIENT_PREVIEW_LIMIT = 200;
const SUPPRESSION_PREVIEW_LIMIT = 100;

export async function loadReleaseAudiencePreview(input: {
  workspaceId: string;
  productId: string;
  linkedFeedbackIds: string[];
  tagSlugs: string[];
  emailEnabled: boolean;
}): Promise<ReleaseAudiencePreview> {
  const suppressedJoin = and(
    eq(emailSuppressions.workspaceId, input.workspaceId),
    eq(emailSuppressions.emailNormalized, subscribers.emailNormalized),
  );

  const tagTopicKeys = input.tagSlugs.map((slug) => releaseTagTopicKey(slug));
  const tagMutedWhere =
    tagTopicKeys.length === 0
      ? undefined
      : exists(
          db
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
        );
  const notTagMuted = tagMutedWhere ? notExists(
    db
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
  ) : undefined;

  const [
    statusRows,
    eligibleRows,
    recipientRows,
    suppressedRows,
    reasonRows,
    addressRows,
    mutedRows,
  ] =
    await Promise.all([
      db
        .select({ status: subscribers.status, value: count() })
        .from(subscribers)
        .where(eq(subscribers.productId, input.productId))
        .groupBy(subscribers.status),
      db
        .select({ value: count() })
        .from(subscribers)
        .leftJoin(emailSuppressions, suppressedJoin)
        .where(
          and(
            eq(subscribers.productId, input.productId),
            eq(subscribers.status, "active"),
            isNull(emailSuppressions.id),
            notTagMuted,
          ),
        ),
      db
        .select({
          email: subscribers.email,
          emailNormalized: subscribers.emailNormalized,
          name: subscribers.name,
          source: subscribers.source,
        })
        .from(subscribers)
        .leftJoin(emailSuppressions, suppressedJoin)
        .where(
          and(
            eq(subscribers.productId, input.productId),
            eq(subscribers.status, "active"),
            isNull(emailSuppressions.id),
            notTagMuted,
          ),
        )
        .orderBy(asc(subscribers.email))
        .limit(RECIPIENT_PREVIEW_LIMIT),
      db
        .select({ value: count() })
        .from(subscribers)
        .innerJoin(emailSuppressions, suppressedJoin)
        .where(
          and(
            eq(subscribers.productId, input.productId),
            eq(subscribers.status, "active"),
          ),
        ),
      db
        .select({ reason: emailSuppressions.reason, value: count() })
        .from(subscribers)
        .innerJoin(emailSuppressions, suppressedJoin)
        .where(
          and(
            eq(subscribers.productId, input.productId),
            eq(subscribers.status, "active"),
          ),
        )
        .groupBy(emailSuppressions.reason),
      db
        .select({
          email: subscribers.email,
          reason: emailSuppressions.reason,
          note: emailSuppressions.note,
        })
        .from(subscribers)
        .innerJoin(emailSuppressions, suppressedJoin)
        .where(
          and(
            eq(subscribers.productId, input.productId),
            eq(subscribers.status, "active"),
          ),
        )
        .orderBy(asc(subscribers.email))
        .limit(SUPPRESSION_PREVIEW_LIMIT),
      tagMutedWhere
        ? db
            .select({ value: count() })
            .from(subscribers)
            .leftJoin(emailSuppressions, suppressedJoin)
            .where(
              and(
                eq(subscribers.productId, input.productId),
                eq(subscribers.status, "active"),
                isNull(emailSuppressions.id),
                tagMutedWhere,
              ),
            )
        : Promise.resolve([{ value: 0 }]),
    ]);

  const followerEmails = new Set<string>();
  if (input.linkedFeedbackIds.length > 0) {
    const rows = await db
      .selectDistinct({ emailNormalized: customers.emailNormalized })
      .from(feedbackFollowers)
      .innerJoin(customers, eq(feedbackFollowers.customerId, customers.id))
      .where(
        and(
          inArray(feedbackFollowers.feedbackPostId, input.linkedFeedbackIds),
          eq(customers.workspaceId, input.workspaceId),
          isNotNull(customers.emailNormalized),
          isNull(customers.bannedAt),
        ),
      );
    for (const row of rows) {
      if (row.emailNormalized) followerEmails.add(row.emailNormalized);
    }
  }

  const recipients: AudienceRecipient[] = recipientRows.map((row) => ({
    email: row.email,
    name: row.name,
    source: row.source,
    followsLinkedRequest: followerEmails.has(row.emailNormalized),
  }));

  let followersInAudience = recipients.filter((recipient) => recipient.followsLinkedRequest).length;
  if (followerEmails.size > 0 && eligibleRows[0]?.value !== recipients.length) {
    const followerCount = await db
      .select({ value: count() })
      .from(subscribers)
      .leftJoin(emailSuppressions, suppressedJoin)
      .where(
        and(
          eq(subscribers.productId, input.productId),
          eq(subscribers.status, "active"),
          isNull(emailSuppressions.id),
          notTagMuted,
          inArray(subscribers.emailNormalized, [...followerEmails]),
        ),
      );
    followersInAudience = followerCount[0]?.value ?? 0;
  }

  const suppressedByReason = Object.fromEntries(
    SUPPRESSION_REASONS.map((reason) => [reason, 0]),
  ) as Record<AudienceSuppressionReason, number>;
  for (const row of reasonRows) {
    suppressedByReason[row.reason] = row.value;
  }

  const counts = { pending: 0, active: 0, unsubscribed: 0 };
  for (const row of statusRows) counts[row.status] = row.value;

  const suppressedAddresses: AudienceSuppressedAddress[] = addressRows.map((row) => ({
    email: row.email,
    reason: row.reason,
    note: row.note,
  }));

  return {
    emailEnabled: input.emailEnabled,
    totalSubscribers: counts.pending + counts.active + counts.unsubscribed,
    eligible: eligibleRows[0]?.value ?? 0,
    mutedByTag: mutedRows[0]?.value ?? 0,
    recipients,
    suppressed: suppressedRows[0]?.value ?? 0,
    suppressedByReason,
    suppressedAddresses,
    unsubscribed: counts.unsubscribed,
    pending: counts.pending,
    linkedRequestCount: input.linkedFeedbackIds.length,
    followersInAudience,
  };
}
