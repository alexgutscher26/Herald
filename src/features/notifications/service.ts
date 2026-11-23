import "server-only";

import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import type { Database } from "@/db";
import {
  inAppNotifications,
  notificationDeliveries,
  buildDeliveryDedupeKey,
} from "@/db/schema/notifications";
import { boards } from "@/db/schema/boards";
import { customers } from "@/db/schema/customers";
import {
  feedbackComments,
  feedbackPosts,
  feedbackStatusEnum,
} from "@/db/schema/feedback";
import {
  feedbackCustomerVotes,
  feedbackFollowers,
  feedbackInsights,
} from "@/db/schema/feedback-extensions";
import { conversationMessages, conversations } from "@/db/schema/conversations";
import { releases } from "@/db/schema/releases";
import { releaseFeedbackLinks } from "@/db/schema/roadmap";
import { subscribers } from "@/db/schema/subscribers";
import { products, workspaces } from "@/db/schema/workspaces";
import { publicSurfaceEnabled } from "@/features/entitlements/entitlements";
import { toPlanId } from "@/features/entitlements/plans";
import {
  publicChangelogEntryPath,
  publicRequestPath,
} from "@/features/public/paths";
import { createPreferenceToken } from "@/features/subscribers/preferences";

import { withCommentAnchor } from "./links";

/**
 * Notification fan-out.
 *
 * One event writes both the email outbox row and the in-app row inside the
 * caller's transaction. `notification_deliveries.dedupe_key` and
 * `in_app_notifications.dedupe_key` make replays harmless, so a retried job or
 * a repeated action cannot notify the same person twice.
 *
 * Recipients are resolved from the request's real engagement — author, voters,
 * commenters and followers — and then narrowed by their own preferences. Only
 * public, unarchived, unhidden, unmerged requests notify anyone.
 */

export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type FeedbackStatus = (typeof feedbackStatusEnum.enumValues)[number];

const STATUS_LABELS: Record<FeedbackStatus, string> = {
  open: "Open",
  under_review: "Under review",
  planned: "Planned",
  in_progress: "In progress",
  shipped: "Shipped",
  closed: "Closed",
};

type NotifiablePost = {
  id: string;
  productId: string;
  workspaceId: string;
  workspaceSlug: string;
  productName: string;
  title: string;
  status: FeedbackStatus;
  boardSlug: string;
};

type CustomerRecipient = {
  id: string;
  email: string;
  emailNormalized: string;
  name: string | null;
};

function excerpt(value: string, length = 180): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length <= length ? text : `${text.slice(0, length - 1)}…`;
}

/**
 * Load a request only when it is still on a public, live board. A private or
 * archived board, a hidden request, a merged duplicate and a product with the
 * feedback surface off all produce `null`, and therefore no notification.
 */
async function loadNotifiablePost(
  tx: Transaction,
  productId: string,
  postId: string,
): Promise<NotifiablePost | null> {
  const rows = await tx
    .select({
      id: feedbackPosts.id,
      productId: feedbackPosts.productId,
      title: feedbackPosts.title,
      status: feedbackPosts.status,
      hiddenAt: feedbackPosts.hiddenAt,
      archivedAt: feedbackPosts.archivedAt,
      mergedIntoId: feedbackPosts.mergedIntoId,
      boardSlug: boards.slug,
      boardVisibility: boards.visibility,
      boardArchivedAt: boards.archivedAt,
      workspaceId: workspaces.id,
      workspaceSlug: workspaces.slug,
      workspacePlan: workspaces.plan,
      productName: products.name,
      publicFeedbackEnabled: products.publicFeedbackEnabled,
    })
    .from(feedbackPosts)
    .innerJoin(boards, eq(feedbackPosts.boardId, boards.id))
    .innerJoin(products, eq(feedbackPosts.productId, products.id))
    .innerJoin(workspaces, eq(products.workspaceId, workspaces.id))
    .where(
      and(
        eq(feedbackPosts.id, postId),
        eq(feedbackPosts.productId, productId),
        eq(boards.visibility, "public"),
        isNull(boards.archivedAt),
        isNull(feedbackPosts.hiddenAt),
        isNull(feedbackPosts.archivedAt),
        isNull(feedbackPosts.mergedIntoId),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (
    !row ||
    !row.boardSlug ||
    !row.publicFeedbackEnabled ||
    !publicSurfaceEnabled(toPlanId(row.workspacePlan))
  ) {
    return null;
  }

  return {
    id: row.id,
    productId: row.productId,
    workspaceId: row.workspaceId,
    workspaceSlug: row.workspaceSlug,
    productName: row.productName,
    title: row.title,
    status: row.status,
    boardSlug: row.boardSlug,
  };
}

async function recipientIdsForPost(
  tx: Transaction,
  postId: string,
): Promise<string[]> {
  const [author, voters, commenters, followers] = await Promise.all([
    tx
      .select({ customerId: feedbackPosts.authorCustomerId })
      .from(feedbackPosts)
      .where(eq(feedbackPosts.id, postId))
      .limit(1),
    tx
      .select({ customerId: feedbackCustomerVotes.customerId })
      .from(feedbackCustomerVotes)
      .where(eq(feedbackCustomerVotes.feedbackPostId, postId)),
    tx
      .select({ customerId: feedbackComments.authorCustomerId })
      .from(feedbackComments)
      .where(
        and(
          eq(feedbackComments.feedbackPostId, postId),
          eq(feedbackComments.internal, false),
          isNotNull(feedbackComments.authorCustomerId),
        ),
      ),
    tx
      .select({ customerId: feedbackFollowers.customerId })
      .from(feedbackFollowers)
      .where(eq(feedbackFollowers.feedbackPostId, postId)),
  ]);

  const ids = new Set<string>();
  for (const row of [...author, ...voters, ...commenters, ...followers]) {
    if (row.customerId) ids.add(row.customerId);
  }
  return [...ids];
}

async function loadRecipients(
  tx: Transaction,
  workspaceId: string,
  customerIds: string[],
): Promise<CustomerRecipient[]> {
  if (customerIds.length === 0) return [];

  const rows = await tx
    .select({
      id: customers.id,
      email: customers.email,
      emailNormalized: customers.emailNormalized,
      name: customers.name,
    })
    .from(customers)
    .where(
      and(
        eq(customers.workspaceId, workspaceId),
        inArray(customers.id, customerIds.slice(0, 500)),
        isNull(customers.bannedAt),
        isNotNull(customers.email),
        isNotNull(customers.emailNormalized),
      ),
    )
    .limit(500);

  return rows.flatMap((row) =>
    row.email && row.emailNormalized
      ? [
          {
            id: row.id,
            email: row.email,
            emailNormalized: row.emailNormalized,
            name: row.name,
          },
        ]
      : [],
  );
}

/**
 * Create (or find) the subscriber row that carries a preference token. A
 * follower is `pending`, not `active`: following one request must not silently
 * subscribe them to the changelog.
 */
async function ensurePreferenceRow(
  tx: Transaction,
  productId: string,
  recipient: CustomerRecipient,
) {
  const token = createPreferenceToken();
  const now = new Date();

  const rows = await tx
    .insert(subscribers)
    .values({
      productId,
      email: recipient.email,
      emailNormalized: recipient.emailNormalized,
      name: recipient.name,
      customerId: recipient.id,
      status: "pending",
      source: "follower",
      unsubscribeToken: token,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [subscribers.productId, subscribers.emailNormalized],
      set: {
        customerId: sql`coalesce(${subscribers.customerId}, excluded.customer_id)`,
        name: sql`coalesce(${subscribers.name}, excluded.name)`,
        unsubscribeToken: sql`coalesce(${subscribers.unsubscribeToken}, ${token})`,
        updatedAt: now,
      },
    })
    .returning({
      id: subscribers.id,
      status: subscribers.status,
      notifyStatusChanges: subscribers.notifyStatusChanges,
      notifyReplies: subscribers.notifyReplies,
      weeklyDigest: subscribers.weeklyDigest,
      unsubscribeToken: subscribers.unsubscribeToken,
    });

  return rows[0] ?? null;
}

async function insertInApp(
  tx: Transaction,
  input: {
    workspaceId: string;
    productId: string;
    customerId: string;
    kind: "feedback_status_changed" | "feedback_reply" | "release_published";
    title: string;
    body: string;
    href: string;
    dedupeKey: string;
    feedbackPostId?: string;
    releaseId?: string;
  },
): Promise<boolean> {
  const inserted = await tx
    .insert(inAppNotifications)
    .values({
      workspaceId: input.workspaceId,
      productId: input.productId,
      customerId: input.customerId,
      kind: input.kind,
      feedbackPostId: input.feedbackPostId ?? null,
      releaseId: input.releaseId ?? null,
      title: input.title,
      body: input.body,
      href: input.href,
      dedupeKey: input.dedupeKey,
    })
    .onConflictDoNothing()
    .returning({ id: inAppNotifications.id });

  return inserted.length > 0;
}

async function hasPendingStatusEmail(
  tx: Transaction,
  input: {
    productId: string;
    feedbackPostId: string;
    recipientEmailNormalized: string;
  },
): Promise<boolean> {
  const rows = await tx
    .select({ id: notificationDeliveries.id })
    .from(notificationDeliveries)
    .where(
      and(
        eq(notificationDeliveries.template, "feedback_status_changed"),
        eq(notificationDeliveries.status, "pending"),
        eq(notificationDeliveries.productId, input.productId),
        eq(notificationDeliveries.feedbackPostId, input.feedbackPostId),
        eq(
          notificationDeliveries.recipientEmailNormalized,
          input.recipientEmailNormalized,
        ),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function insertEmailDelivery(
  tx: Transaction,
  input: {
    workspaceId: string;
    productId: string;
    template: "feedback_status_changed" | "feedback_reply";
    recipient: CustomerRecipient;
    feedbackPostId: string;
    feedbackCommentId?: string;
    dedupeKey: string;
  },
): Promise<boolean> {
  const inserted = await tx
    .insert(notificationDeliveries)
    .values({
      workspaceId: input.workspaceId,
      productId: input.productId,
      template: input.template,
      feedbackPostId: input.feedbackPostId,
      feedbackCommentId: input.feedbackCommentId ?? null,
      recipientCustomerId: input.recipient.id,
      recipientEmail: input.recipient.email,
      recipientEmailNormalized: input.recipient.emailNormalized,
      status: "pending",
      dedupeKey: input.dedupeKey,
    })
    .onConflictDoNothing()
    .returning({ id: notificationDeliveries.id });

  return inserted.length > 0;
}

export type FeedbackNotificationSummary = {
  recipients: number;
  emails: number;
  inApp: number;
};

export async function queueFeedbackStatusNotifications(
  tx: Transaction,
  input: {
    productId: string;
    postId: string;
    toStatus: FeedbackStatus;
    eventAt: Date;
  },
): Promise<FeedbackNotificationSummary> {
  const post = await loadNotifiablePost(tx, input.productId, input.postId);
  if (!post) return { recipients: 0, emails: 0, inApp: 0 };

  const recipients = await loadRecipients(
    tx,
    post.workspaceId,
    await recipientIdsForPost(tx, post.id),
  );
  const href = publicRequestPath(
    post.workspaceSlug,
    await productSlug(tx, post.productId),
    post.boardSlug,
    post.id,
  );

  let emails = 0;
  let inApp = 0;

  await addLinkedSupportNotes(tx, {
    post,
    toStatus: input.toStatus,
    eventAt: input.eventAt,
  });

  for (const recipient of recipients) {
    const subscriber = await ensurePreferenceRow(tx, post.productId, recipient);
    if (!subscriber?.notifyStatusChanges) continue;

    const eventId = `${post.id}:${input.toStatus}:${input.eventAt.toISOString()}`;
    const created = await insertInApp(tx, {
      workspaceId: post.workspaceId,
      productId: post.productId,
      customerId: recipient.id,
      kind: "feedback_status_changed",
      title: "Request updated",
      body: `“${post.title}” is now ${STATUS_LABELS[input.toStatus]}.`,
      href,
      dedupeKey: `in-app:feedback-status:${recipient.id}:${eventId}`,
      feedbackPostId: post.id,
    });
    if (created) inApp += 1;

    // Ten rapid status changes on one request should produce one email. The
    // pending row renders the current status when it is finally sent, so no
    // second row is needed until that one has gone out.
    const alreadyQueued = await hasPendingStatusEmail(tx, {
      productId: post.productId,
      feedbackPostId: post.id,
      recipientEmailNormalized: recipient.emailNormalized,
    });
    if (!alreadyQueued) {
      const sent = await insertEmailDelivery(tx, {
        workspaceId: post.workspaceId,
        productId: post.productId,
        template: "feedback_status_changed",
        recipient,
        feedbackPostId: post.id,
        dedupeKey: buildDeliveryDedupeKey({
          template: "feedback_status_changed",
          productId: post.productId,
          recipientEmailNormalized: recipient.emailNormalized,
          sourceId: eventId,
        }),
      });
      if (sent) emails += 1;
    }
  }

  return { recipients: recipients.length, emails, inApp };
}

/**
 * G50: when a tracked request moves, leave an internal note on every support
 * conversation linked as evidence. The customer-facing reply/status fan-out is
 * unchanged; this note is team-only and never affects unread counts or previews.
 */
async function addLinkedSupportNotes(
  tx: Transaction,
  input: { post: NotifiablePost; toStatus: FeedbackStatus; eventAt: Date },
): Promise<void> {
  const refs = await tx
    .select({ sourceRef: feedbackInsights.sourceRef })
    .from(feedbackInsights)
    .where(
      and(
        eq(feedbackInsights.productId, input.post.productId),
        eq(feedbackInsights.feedbackPostId, input.post.id),
        eq(feedbackInsights.source, "support"),
        isNotNull(feedbackInsights.sourceRef),
      ),
    )
    .limit(50);

  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const conversationIds = [
    ...new Set(
      refs
        .map((row) => row.sourceRef ?? "")
        .filter((value) => uuidPattern.test(value)),
    ),
  ];
  if (conversationIds.length === 0) return;

  const existing = await tx
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.productId, input.post.productId),
        inArray(conversations.id, conversationIds),
      ),
    );
  if (existing.length === 0) return;

  const body = `Tracked request “${input.post.title}” moved to ${
    STATUS_LABELS[input.toStatus]
  }. This internal note is only visible to the team.`;
  await tx
    .insert(conversationMessages)
    .values(
      existing.map((conversation) => ({
        conversationId: conversation.id,
        productId: input.post.productId,
        authorType: "system" as const,
        kind: "note" as const,
        channel: "team" as const,
        body,
        externalId: `feedback-status:${input.post.id}:${input.eventAt.toISOString()}:${conversation.id}`,
        createdAt: input.eventAt,
      })),
    )
    .onConflictDoNothing();
}

async function productSlug(tx: Transaction, productId: string): Promise<string> {
  const rows = await tx
    .select({ slug: products.slug })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);
  return rows[0]?.slug ?? "";
}

export async function queueFeedbackReplyNotifications(
  tx: Transaction,
  input: {
    productId: string;
    postId: string;
    commentId: string;
    authorName: string;
    body: string;
    eventAt: Date;
    authorCustomerId?: string | null;
  },
): Promise<FeedbackNotificationSummary> {
  const post = await loadNotifiablePost(tx, input.productId, input.postId);
  if (!post) return { recipients: 0, emails: 0, inApp: 0 };

  const ids = (await recipientIdsForPost(tx, post.id)).filter(
    (id) => id !== input.authorCustomerId,
  );
  const recipients = await loadRecipients(tx, post.workspaceId, ids);
  const slug = await productSlug(tx, post.productId);
  const href = publicRequestPath(post.workspaceSlug, slug, post.boardSlug, post.id);

  let emails = 0;
  let inApp = 0;

  for (const recipient of recipients) {
    const subscriber = await ensurePreferenceRow(tx, post.productId, recipient);
    if (!subscriber?.notifyReplies) continue;

    const created = await insertInApp(tx, {
      workspaceId: post.workspaceId,
      productId: post.productId,
      customerId: recipient.id,
      kind: "feedback_reply",
      title: `New reply on “${post.title}”`,
      body: `${input.authorName}: ${excerpt(input.body)}`,
      // Land on the reply itself; the request page carries the anchor.
      href: withCommentAnchor(href, input.commentId),
      dedupeKey: `in-app:feedback-reply:${recipient.id}:${input.commentId}`,
      feedbackPostId: post.id,
    });
    if (created) inApp += 1;

    const sent = await insertEmailDelivery(tx, {
      workspaceId: post.workspaceId,
      productId: post.productId,
      template: "feedback_reply",
      recipient,
      feedbackPostId: post.id,
      feedbackCommentId: input.commentId,
      dedupeKey: buildDeliveryDedupeKey({
        template: "feedback_reply",
        productId: post.productId,
        recipientEmailNormalized: recipient.emailNormalized,
        sourceId: input.commentId,
      }),
    });
    if (sent) emails += 1;
  }

  return { recipients: recipients.length, emails, inApp };
}

/**
 * In-app changelog notifications for product subscribers and for customers
 * following a request that shipped in this release. Email delivery stays in
 * `queueReleaseDeliveries`, which only addresses active, unsuppressed
 * subscribers.
 *
 * The release itself is public, so an active subscriber remains entitled even
 * when a linked request is not. Follower-driven recipients are narrower: a
 * hidden, private, archived or merged request contributes no follower.
 */
export async function queueReleaseInAppNotifications(
  tx: Transaction,
  input: {
    workspaceId: string;
    productId: string;
    releaseId: string;
  },
): Promise<number> {
  const releaseRows = await tx
    .select({
      id: releases.id,
      title: releases.title,
      slug: releases.slug,
      status: releases.status,
      channelPublicChangelog: releases.channelPublicChangelog,
      workspaceSlug: workspaces.slug,
      workspacePlan: workspaces.plan,
      productName: products.name,
      publicChangelogEnabled: products.publicChangelogEnabled,
      publicFeedbackEnabled: products.publicFeedbackEnabled,
    })
    .from(releases)
    .innerJoin(products, eq(releases.productId, products.id))
    .innerJoin(workspaces, eq(products.workspaceId, workspaces.id))
    .where(and(eq(releases.id, input.releaseId), eq(releases.productId, input.productId)))
    .limit(1);

  const release = releaseRows[0];
  if (
    !release ||
    release.status !== "published" ||
    !release.channelPublicChangelog ||
    !release.publicChangelogEnabled ||
    !publicSurfaceEnabled(toPlanId(release.workspacePlan))
  ) {
    return 0;
  }

  const activeSubscribers = await tx
    .select({ email: subscribers.emailNormalized })
    .from(subscribers)
    .where(
      and(
        eq(subscribers.productId, input.productId),
        eq(subscribers.status, "active"),
        isNotNull(subscribers.emailNormalized),
      ),
    )
    .limit(1_000);

  const emails = activeSubscribers.map((row) => row.email);
  const subscriberCustomers =
    emails.length > 0
      ? await tx
          .select({ id: customers.id })
          .from(customers)
          .where(
            and(
              eq(customers.workspaceId, input.workspaceId),
              inArray(customers.emailNormalized, emails),
              isNull(customers.bannedAt),
            ),
          )
      : [];

  // Following a request does not grant access to a request that later became
  // hidden, private, archived or merged. Those followers are not entitled to
  // the release's linked-request story, so they are not added here; active
  // subscribers still receive the public release through the path above.
  const followerRows = release.publicFeedbackEnabled
    ? await tx
        .selectDistinct({ id: customers.id })
        .from(releaseFeedbackLinks)
        .innerJoin(
          feedbackFollowers,
          eq(feedbackFollowers.feedbackPostId, releaseFeedbackLinks.feedbackPostId),
        )
        .innerJoin(
          feedbackPosts,
          eq(feedbackPosts.id, releaseFeedbackLinks.feedbackPostId),
        )
        .innerJoin(boards, eq(boards.id, feedbackPosts.boardId))
        .innerJoin(customers, eq(feedbackFollowers.customerId, customers.id))
        .where(
          and(
            eq(releaseFeedbackLinks.releaseId, input.releaseId),
            eq(releaseFeedbackLinks.productId, input.productId),
            eq(feedbackPosts.productId, input.productId),
            eq(boards.visibility, "public"),
            isNull(boards.archivedAt),
            isNull(feedbackPosts.hiddenAt),
            isNull(feedbackPosts.archivedAt),
            isNull(feedbackPosts.mergedIntoId),
            eq(customers.workspaceId, input.workspaceId),
            isNull(customers.bannedAt),
          ),
        )
        .limit(1_000)
    : [];

  const customerIds = new Set<string>();
  for (const row of [...subscriberCustomers, ...followerRows]) customerIds.add(row.id);
  if (customerIds.size === 0) return 0;

  const href = publicChangelogEntryPath(
    release.workspaceSlug,
    (await productSlug(tx, input.productId)) || "",
    release.slug,
  );

  let created = 0;
  for (const customerId of customerIds) {
    const inserted = await insertInApp(tx, {
      workspaceId: input.workspaceId,
      productId: input.productId,
      customerId,
      kind: "release_published",
      title: `New update: ${release.title}`,
      body: `A new update from ${release.productName} is available.`,
      href,
      dedupeKey: `in-app:release:${input.releaseId}:${customerId}`,
      releaseId: input.releaseId,
    });
    if (inserted) created += 1;
  }

  return created;
}
