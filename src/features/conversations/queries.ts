import "server-only";

import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { db } from "@/db";
import { user } from "@/db/schema/auth";
import { boards } from "@/db/schema/boards";
import {
  customerCompanies,
  customerCompanyMemberships,
  customers,
} from "@/db/schema/customers";
import {
  conversationAttachments,
  conversationDrafts,
  conversationMessages,
  conversationNotifications,
  conversationParticipants,
  conversationReminders,
  conversationTagLinks,
  conversationTags,
  conversations,
  type ConversationNotification,
  type ConversationSourceContext,
  type ConversationStatus,
} from "@/db/schema/conversations";
import {
  feedbackCustomerVotes,
  feedbackInsights,
} from "@/db/schema/feedback-extensions";
import { junoConversations } from "@/db/schema/knowledge";
import { feedbackComments, feedbackPosts } from "@/db/schema/feedback";
import { customerReleaseViews, releases } from "@/db/schema/releases";
import { releaseFeedbackLinks } from "@/db/schema/roadmap";
import { productSupportSettings } from "@/db/schema/support";
import { workspaceMembers, type WorkspaceRoleValue } from "@/db/schema/workspaces";
import { createSignedStorageUrl } from "@/features/storage/urls";

import { businessMinutesBetween } from "./business-time";

import {
  CONVERSATION_VIEWS,
  type ConversationView,
  type InboxFilters,
} from "./filters";

/**
 * Conversation reads.
 *
 * Every function takes a `productId` already authorized by the caller and
 * filters on it, including joins. A guessed conversation id from another
 * product resolves to `null`, never to a thread.
 *
 * The denormalised last-message columns on `conversations` are read instead of
 * a per-row lateral join; the service layer keeps them in sync inside the same
 * transaction as the message insert.
 */

export type ConversationSlaStatus = {
  /** Negative once the target has passed. */
  remainingMinutes: number;
  breached: boolean;
};

export type ConversationListItem = {
  id: string;
  subject: string;
  status: ConversationStatus;
  unreadForTeam: number;
  lastMessagePreview: string;
  lastMessageAt: string;
  createdAt: string;
  snoozedUntil: string | null;
  customer: { id: string; name: string; email: string | null };
  assigneeId: string | null;
  assigneeName: string | null;
  sla: ConversationSlaStatus | null;
};

export type InboxCounts = Record<ConversationView, number>;

export type DueReminder = {
  id: string;
  conversationId: string;
  subject: string;
  remindAt: string;
};

export type AssignableMember = {
  id: string;
  name: string;
  email: string;
  role: WorkspaceRoleValue;
};

export type ThreadMessage = {
  id: string;
  kind: "message" | "note";
  authorType: "customer" | "team" | "juno" | "system";
  authorName: string;
  body: string;
  citations: { sourceName: string; title: string; url: string | null }[] | null;
  createdAt: string;
};

export type ThreadAttachment = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  kind: "image" | "file";
  url: string;
  createdAt: string;
};

export type ThreadReminder = {
  id: string;
  remindAt: string;
  completedAt: string | null;
};

export type CustomerTimeline = {
  conversations: Array<{
    id: string;
    subject: string;
    status: ConversationStatus;
    createdAt: string;
    csatRating: number | null;
  }>;
  requests: Array<{
    id: string;
    title: string;
    status: string;
    createdAt: string;
  }>;
  releasesSeen: Array<{
    id: string;
    title: string;
    slug: string;
    lastViewedAt: string;
  }>;
  csat: Array<{
    conversationId: string;
    subject: string;
    rating: number;
    ratedAt: string;
  }>;
};

export type ThreadLinkedRequest = {
  id: string;
  title: string;
  status: string;
  boardSlug: string | null;
  /** The published release that shipped this request, when one is linked. */
  release: { title: string; slug: string | null } | null;
};

export type ConversationThread = {
  conversation: {
    id: string;
    subject: string;
    status: ConversationStatus;
    unreadForTeam: number;
    sourceUrl: string | null;
    sourceContext: ConversationSourceContext | null;
    awayReplySentAt: string | null;
    snoozedUntil: string | null;
    lastMessageAt: string;
    createdAt: string;
    csat: { requested: boolean; rating: number | null };
    sla: ConversationSlaStatus | null;
  };
  customer: {
    id: string;
    name: string;
    email: string | null;
    verifiedAt: string | null;
    activity: { posts: number; comments: number; votes: number };
  };
  linkedRequests: ThreadLinkedRequest[];
  companies: Array<{ id: string; name: string }>;
  timeline: CustomerTimeline;
  draft: string;
  assigneeId: string | null;
  assigneeName: string | null;
  messages: ThreadMessage[];
  attachments: ThreadAttachment[];
  tags: Array<{ id: string; name: string }>;
  reminders: ThreadReminder[];
  juno: {
    state: "active" | "paused" | "handed_off" | "resolved";
    handoffReason: string | null;
  } | null;
};

export type OperatorConversationNotification = {
  id: string;
  conversationId: string;
  kind: ConversationNotification["kind"];
  title: string;
  body: string;
  createdAt: string;
};

function iso(value: Date): string {
  return value.toISOString();
}

function isoOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function pendingSla(
  conversation: {
    lastMessageAt: Date;
    lastCustomerMessageAt: Date | null;
  },
  settings:
    | {
        slaEnabled: boolean;
        slaFirstResponseMinutes: number;
        slaTimezone: string;
        slaBusinessHours: { days: number[]; start: string; end: string }[] | null;
      }
    | undefined,
  now: Date,
): ConversationSlaStatus | null {
  if (!settings?.slaEnabled || !conversation.lastCustomerMessageAt) return null;
  // A reply after the customer message pauses the clock.
  if (conversation.lastMessageAt.getTime() > conversation.lastCustomerMessageAt.getTime()) {
    return null;
  }
  try {
    const elapsed = businessMinutesBetween(
      conversation.lastCustomerMessageAt,
      now,
      settings.slaTimezone,
      settings.slaBusinessHours,
    );
    const remainingMinutes = settings.slaFirstResponseMinutes - elapsed;
    return { remainingMinutes, breached: remainingMinutes <= 0 };
  } catch {
    return null;
  }
}

/**
 * Rows for one tab.
 *
 * `queue` also contains snoozed threads whose deadline has passed, so a snooze
 * expires into the work list without a background job. `all` excludes spam and
 * archived; those are reachable only through their own tabs, which also keeps
 * them out of search.
 */
export function viewPredicate(
  productId: string,
  view: ConversationView,
  now: Date,
): SQL | undefined {
  const base = eq(conversations.productId, productId);

  switch (view) {
    case "queue":
      return and(
        base,
        or(
          inArray(conversations.status, ["queue", "open"]),
          and(
            eq(conversations.status, "snoozed"),
            lte(conversations.snoozedUntil, now),
          ),
        ),
      );
    case "open":
      return and(base, eq(conversations.status, "open"));
    case "all":
      return and(
        base,
        inArray(conversations.status, ["queue", "open", "snoozed", "resolved"]),
      );
    case "snoozed":
      return and(
        base,
        eq(conversations.status, "snoozed"),
        gte(conversations.snoozedUntil, now),
      );
    case "resolved":
      return and(base, eq(conversations.status, "resolved"));
    case "spam":
      return and(base, eq(conversations.status, "spam"));
    case "archived":
      return and(base, eq(conversations.status, "archived"));
  }
}

function assigneePredicate(
  userId: string,
  filter: InboxFilters["assignee"],
): SQL | undefined {
  if (filter === "me") return eq(conversations.assigneeId, userId);
  if (filter === "unassigned") return isNull(conversations.assigneeId);
  return undefined;
}

function searchPredicate(query: string): SQL | undefined {
  if (query === "") return undefined;
  const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
  return or(
    ilike(conversations.subject, pattern),
    ilike(conversations.lastMessagePreview, pattern),
    ilike(customers.name, pattern),
    ilike(customers.email, pattern),
    // Search every message body, not only what the denormalised preview kept.
    exists(
      db
        .select({ one: sql`1` })
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.conversationId, conversations.id),
            eq(conversationMessages.productId, conversations.productId),
            ilike(conversationMessages.body, pattern),
          ),
        ),
    ),
  );
}

function tagPredicate(productId: string, tag: string | undefined): SQL | undefined {
  if (!tag) return undefined;
  return exists(
    db
      .select({ one: sql`1` })
      .from(conversationTagLinks)
      .innerJoin(
        conversationTags,
        and(
          eq(conversationTagLinks.tagId, conversationTags.id),
          eq(conversationTagLinks.productId, conversationTags.productId),
        ),
      )
      .where(
        and(
          eq(conversationTagLinks.conversationId, conversations.id),
          eq(conversationTagLinks.productId, productId),
          eq(conversationTags.name, tag),
        ),
      ),
  );
}

export async function getInboxCounts(
  productId: string,
  now: Date = new Date(),
): Promise<InboxCounts> {
  const entries = await Promise.all(
    CONVERSATION_VIEWS.map(async (view) => {
      const rows = await db
        .select({ value: count() })
        .from(conversations)
        .where(viewPredicate(productId, view, now));
      return [view, rows[0]?.value ?? 0] as const;
    }),
  );

  const counts = {} as InboxCounts;
  for (const [view, value] of entries) counts[view] = value;
  return counts;
}

export async function listConversations(input: {
  productId: string;
  userId: string;
  filters: InboxFilters;
  now?: Date;
  limit?: number;
}): Promise<{ items: ConversationListItem[]; counts: InboxCounts }> {
  const now = input.now ?? new Date();
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);

  const rows = await db
    .select({
      conversation: conversations,
      customerName: customers.name,
      customerEmail: customers.email,
      assigneeName: user.name,
    })
    .from(conversations)
    .innerJoin(customers, eq(conversations.customerId, customers.id))
    .leftJoin(user, eq(conversations.assigneeId, user.id))
    .where(
      and(
        viewPredicate(input.productId, input.filters.view, now),
        assigneePredicate(input.userId, input.filters.assignee),
        tagPredicate(input.productId, input.filters.tag),
        searchPredicate(input.filters.query),
      ),
    )
    .orderBy(desc(conversations.lastMessageAt))
    .limit(limit);

  const [counts, slaSettings] = await Promise.all([
    getInboxCounts(input.productId, now),
    db
      .select()
      .from(productSupportSettings)
      .where(eq(productSupportSettings.productId, input.productId))
      .limit(1),
  ]);

  return {
    counts,
    items: rows.map((row) => ({
      id: row.conversation.id,
      subject: row.conversation.subject,
      status: row.conversation.status,
      unreadForTeam: row.conversation.unreadForTeam,
      lastMessagePreview: row.conversation.lastMessagePreview,
      lastMessageAt: iso(row.conversation.lastMessageAt),
      createdAt: iso(row.conversation.createdAt),
      snoozedUntil: isoOrNull(row.conversation.snoozedUntil),
      customer: {
        id: row.conversation.customerId,
        name: row.customerName ?? "Customer",
        email: row.customerEmail,
      },
      assigneeId: row.conversation.assigneeId,
      assigneeName: row.assigneeName,
      sla: pendingSla(row.conversation, slaSettings[0], now),
    })),
  };
}

export async function getConversationThread(input: {
  productId: string;
  conversationId: string;
  userId: string;
}): Promise<ConversationThread | null> {
  const rows = await db
    .select({
      conversation: conversations,
      customerName: customers.name,
      customerEmail: customers.email,
      customerVerifiedAt: customers.verifiedAt,
      assigneeName: user.name,
      junoState: junoConversations.state,
      junoHandoffReason: junoConversations.handoffReason,
    })
    .from(conversations)
    .innerJoin(customers, eq(conversations.customerId, customers.id))
    .leftJoin(user, eq(conversations.assigneeId, user.id))
    .leftJoin(
      junoConversations,
      eq(junoConversations.conversationId, conversations.id),
    )
    .where(
      and(
        eq(conversations.id, input.conversationId),
        eq(conversations.productId, input.productId),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const slaSettings = await db
    .select()
    .from(productSupportSettings)
    .where(eq(productSupportSettings.productId, input.productId))
    .limit(1);

  const [
    messages,
    attachments,
    reminders,
    drafts,
    postCount,
    commentCount,
    voteCount,
    linked,
    tagRows,
    companyRows,
    customerConversations,
    customerRequests,
    releaseViews,
  ] = await Promise.all([
    db
      .select({ message: conversationMessages, authorName: user.name })
      .from(conversationMessages)
      .leftJoin(user, eq(conversationMessages.authorUserId, user.id))
      .where(
        and(
          eq(conversationMessages.conversationId, row.conversation.id),
          eq(conversationMessages.productId, input.productId),
        ),
      )
      .orderBy(asc(conversationMessages.createdAt)),
    db
      .select()
      .from(conversationAttachments)
      .where(
        and(
          eq(conversationAttachments.conversationId, row.conversation.id),
          eq(conversationAttachments.productId, input.productId),
          isNotNull(conversationAttachments.messageId),
        ),
      )
      .orderBy(asc(conversationAttachments.createdAt)),
    db
      .select()
      .from(conversationReminders)
      .where(
        and(
          eq(conversationReminders.conversationId, row.conversation.id),
          eq(conversationReminders.userId, input.userId),
        ),
      )
      .orderBy(desc(conversationReminders.createdAt))
      .limit(1),
    db
      .select({ body: conversationDrafts.body })
      .from(conversationDrafts)
      .where(
        and(
          eq(conversationDrafts.conversationId, row.conversation.id),
          eq(conversationDrafts.userId, input.userId),
        ),
      )
      .limit(1),
    db
      .select({ value: count() })
      .from(feedbackPosts)
      .where(
        and(
          eq(feedbackPosts.productId, input.productId),
          eq(feedbackPosts.authorCustomerId, row.conversation.customerId),
          isNull(feedbackPosts.hiddenAt),
        ),
      ),
    db
      .select({ value: count() })
      .from(feedbackComments)
      .where(
        and(
          eq(feedbackComments.productId, input.productId),
          eq(feedbackComments.authorCustomerId, row.conversation.customerId),
          eq(feedbackComments.internal, false),
        ),
      ),
    db
      .select({ value: count() })
      .from(feedbackCustomerVotes)
      .innerJoin(
        feedbackPosts,
        eq(feedbackCustomerVotes.feedbackPostId, feedbackPosts.id),
      )
      .where(
        and(
          eq(feedbackPosts.productId, input.productId),
          eq(feedbackCustomerVotes.customerId, row.conversation.customerId),
        ),
      ),
    db
      .select({
        id: feedbackPosts.id,
        title: feedbackPosts.title,
        status: feedbackPosts.status,
        boardSlug: boards.slug,
        releaseTitle: releases.title,
        releaseSlug: releases.slug,
      })
      .from(feedbackPosts)
      .leftJoin(boards, eq(feedbackPosts.boardId, boards.id))
      .leftJoin(
        releaseFeedbackLinks,
        eq(releaseFeedbackLinks.feedbackPostId, feedbackPosts.id),
      )
      .leftJoin(
        releases,
        and(
          eq(releases.id, releaseFeedbackLinks.releaseId),
          eq(releases.status, "published"),
        ),
      )
      .where(
        and(
          eq(feedbackPosts.productId, input.productId),
          /*
           * A thread is linked to a request when the customer authored it, or
           * when a support message in this thread was recorded as evidence for
           * it. The second branch is why a release reaches every thread that
           * reported the same problem, not just the one that filed it.
           */
          or(
            eq(feedbackPosts.authorCustomerId, row.conversation.customerId),
            sql`exists (
              select 1 from ${feedbackInsights}
              where ${feedbackInsights.feedbackPostId} = ${feedbackPosts.id}
                and ${feedbackInsights.productId} = ${input.productId}
                and ${feedbackInsights.sourceRef} = ${row.conversation.id}
            )`,
          ),
          isNull(feedbackPosts.hiddenAt),
          isNull(feedbackPosts.mergedIntoId),
        ),
      )
      .orderBy(desc(feedbackPosts.createdAt))
      .limit(10),
    db
      .select({ id: conversationTags.id, name: conversationTags.name })
      .from(conversationTagLinks)
      .innerJoin(
        conversationTags,
        and(
          eq(conversationTagLinks.tagId, conversationTags.id),
          eq(conversationTagLinks.productId, conversationTags.productId),
        ),
      )
      .where(
        and(
          eq(conversationTagLinks.conversationId, row.conversation.id),
          eq(conversationTagLinks.productId, input.productId),
        ),
      )
      .orderBy(asc(conversationTags.name)),
    db
      .select({ id: customerCompanies.id, name: customerCompanies.name })
      .from(customerCompanyMemberships)
      .innerJoin(
        customerCompanies,
        and(
          eq(customerCompanyMemberships.companyId, customerCompanies.id),
          eq(customerCompanyMemberships.workspaceId, customerCompanies.workspaceId),
        ),
      )
      .where(
        and(
          eq(customerCompanyMemberships.customerId, row.conversation.customerId),
          eq(customerCompanyMemberships.workspaceId, row.conversation.workspaceId),
        ),
      )
      .orderBy(asc(customerCompanies.name))
      .limit(20),
    db
      .select({
        id: conversations.id,
        subject: conversations.subject,
        status: conversations.status,
        createdAt: conversations.createdAt,
        csatRating: conversations.csatRating,
        csatRatedAt: conversations.csatRatedAt,
      })
      .from(conversations)
      .where(
        and(
          eq(conversations.productId, input.productId),
          eq(conversations.customerId, row.conversation.customerId),
        ),
      )
      .orderBy(desc(conversations.createdAt))
      .limit(20),
    db
      .select({
        id: feedbackPosts.id,
        title: feedbackPosts.title,
        status: feedbackPosts.status,
        createdAt: feedbackPosts.createdAt,
      })
      .from(feedbackPosts)
      .where(
        and(
          eq(feedbackPosts.productId, input.productId),
          eq(feedbackPosts.authorCustomerId, row.conversation.customerId),
          isNull(feedbackPosts.hiddenAt),
        ),
      )
      .orderBy(desc(feedbackPosts.createdAt))
      .limit(20),
    db
      .select({
        id: releases.id,
        title: releases.title,
        slug: releases.slug,
        lastViewedAt: customerReleaseViews.lastViewedAt,
      })
      .from(customerReleaseViews)
      .innerJoin(releases, eq(customerReleaseViews.releaseId, releases.id))
      .where(
        and(
          eq(customerReleaseViews.productId, input.productId),
          eq(customerReleaseViews.customerId, row.conversation.customerId),
        ),
      )
      .orderBy(desc(customerReleaseViews.lastViewedAt))
      .limit(10),
  ]);

  return {
    conversation: {
      id: row.conversation.id,
      subject: row.conversation.subject,
      status: row.conversation.status,
      unreadForTeam: row.conversation.unreadForTeam,
      sourceUrl: row.conversation.sourceUrl,
      sourceContext: row.conversation.sourceContext ?? null,
      awayReplySentAt: isoOrNull(row.conversation.awayReplySentAt),
      snoozedUntil: isoOrNull(row.conversation.snoozedUntil),
      lastMessageAt: iso(row.conversation.lastMessageAt),
      createdAt: iso(row.conversation.createdAt),
      csat: {
        requested: row.conversation.csatRequestedAt !== null,
        rating: row.conversation.csatRating,
      },
      sla: pendingSla(row.conversation, slaSettings[0], new Date()),
    },
    customer: {
      id: row.conversation.customerId,
      name: row.customerName ?? "Customer",
      email: row.customerEmail,
      verifiedAt: isoOrNull(row.customerVerifiedAt),
      activity: {
        posts: postCount[0]?.value ?? 0,
        comments: commentCount[0]?.value ?? 0,
        votes: voteCount[0]?.value ?? 0,
      },
    },
    linkedRequests: [...new Map(linked.map((request) => [request.id, request])).values()].map(
      (request) => ({
        id: request.id,
        title: request.title,
        status: request.status,
        boardSlug: request.boardSlug,
        release:
          request.releaseTitle !== null
            ? { title: request.releaseTitle, slug: request.releaseSlug }
            : null,
      }),
    ),
    companies: companyRows,
    timeline: {
      conversations: customerConversations.map((conversation) => ({
        id: conversation.id,
        subject: conversation.subject,
        status: conversation.status,
        createdAt: iso(conversation.createdAt),
        csatRating: conversation.csatRating,
      })),
      requests: customerRequests.map((request) => ({
        id: request.id,
        title: request.title,
        status: request.status,
        createdAt: iso(request.createdAt),
      })),
      releasesSeen: releaseViews.map((release) => ({
        id: release.id,
        title: release.title,
        slug: release.slug,
        lastViewedAt: iso(release.lastViewedAt),
      })),
      csat: customerConversations.flatMap((conversation) =>
        conversation.csatRating !== null && conversation.csatRatedAt !== null
          ? [
              {
                conversationId: conversation.id,
                subject: conversation.subject,
                rating: conversation.csatRating,
                ratedAt: iso(conversation.csatRatedAt),
              },
            ]
          : [],
      ),
    },
    draft: drafts[0]?.body ?? "",
    assigneeId: row.conversation.assigneeId,
    assigneeName: row.assigneeName,
    messages: messages.map(({ message, authorName }) => ({
      id: message.id,
      kind: message.kind,
      authorType: message.authorType,
      authorName:
        message.authorType === "customer"
          ? (row.customerName ?? "Customer")
          : message.authorType === "juno"
            ? "Juno"
            : message.authorType === "system"
              ? "Herald"
              : (authorName ?? "Team member"),
      body: message.body,
      citations: message.citations ?? null,
      createdAt: iso(message.createdAt),
    })),
    attachments: attachments.map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      kind: attachment.kind === "image" ? "image" : "file",
      url: createSignedStorageUrl(attachment.storageKey),
      createdAt: iso(attachment.createdAt),
    })),
    tags: tagRows,
    reminders: reminders.map((reminder) => ({
      id: reminder.id,
      remindAt: iso(reminder.remindAt),
      completedAt: isoOrNull(reminder.completedAt),
    })),
    juno: row.junoState
      ? { state: row.junoState, handoffReason: row.junoHandoffReason ?? null }
      : null,
  };
}

export async function listConversationNotifications(input: {
  productId: string;
  userId: string;
  limit?: number;
}): Promise<OperatorConversationNotification[]> {
  const rows = await db
    .select({
      id: conversationNotifications.id,
      conversationId: conversationNotifications.conversationId,
      kind: conversationNotifications.kind,
      title: conversationNotifications.title,
      body: conversationNotifications.body,
      createdAt: conversationNotifications.createdAt,
    })
    .from(conversationNotifications)
    .where(
      and(
        eq(conversationNotifications.productId, input.productId),
        eq(conversationNotifications.userId, input.userId),
        isNull(conversationNotifications.readAt),
      ),
    )
    .orderBy(desc(conversationNotifications.createdAt))
    .limit(Math.min(Math.max(input.limit ?? 5, 1), 20));

  return rows.map((row) => ({
    id: row.id,
    conversationId: row.conversationId,
    kind: row.kind,
    title: row.title,
    body: row.body,
    createdAt: iso(row.createdAt),
  }));
}

export async function markConversationNotificationsRead(input: {
  productId: string;
  userId: string;
  now?: Date;
}): Promise<{ updated: number }> {
  const updated = await db
    .update(conversationNotifications)
    .set({ readAt: input.now ?? new Date() })
    .where(
      and(
        eq(conversationNotifications.productId, input.productId),
        eq(conversationNotifications.userId, input.userId),
        isNull(conversationNotifications.readAt),
      ),
    )
    .returning({ id: conversationNotifications.id });
  return { updated: updated.length };
}

export async function listAssignableMembers(
  workspaceId: string,
): Promise<AssignableMember[]> {
  return db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(user, eq(workspaceMembers.userId, user.id))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(asc(user.name));
}

export type ConversationTagOption = { name: string; count: number };

export async function listConversationTags(
  productId: string,
): Promise<ConversationTagOption[]> {
  const rows = await db
    .select({
      name: conversationTags.name,
      count: sql<number>`count(${conversationTagLinks.conversationId})::int`,
    })
    .from(conversationTags)
    .leftJoin(
      conversationTagLinks,
      and(
        eq(conversationTagLinks.tagId, conversationTags.id),
        eq(conversationTagLinks.productId, conversationTags.productId),
      ),
    )
    .where(eq(conversationTags.productId, productId))
    .groupBy(conversationTags.id, conversationTags.name)
    .orderBy(asc(conversationTags.name))
    .limit(100);

  return rows.map((row) => ({ name: row.name, count: row.count }));
}

export type MergeCandidate = {
  id: string;
  subject: string;
  status: ConversationStatus;
  lastMessageAt: string;
};

export async function listMergeCandidates(input: {
  productId: string;
  customerId: string;
  excludeConversationId: string;
}): Promise<MergeCandidate[]> {
  const rows = await db
    .select({
      id: conversations.id,
      subject: conversations.subject,
      status: conversations.status,
      lastMessageAt: conversations.lastMessageAt,
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.productId, input.productId),
        eq(conversations.customerId, input.customerId),
        ne(conversations.id, input.excludeConversationId),
        ne(conversations.status, "archived"),
        ne(conversations.status, "spam"),
      ),
    )
    .orderBy(desc(conversations.lastMessageAt))
    .limit(20);

  return rows.map((row) => ({
    ...row,
    lastMessageAt: iso(row.lastMessageAt),
  }));
}

export async function listDueReminders(input: {
  productId: string;
  userId: string;
  now?: Date;
}): Promise<DueReminder[]> {
  const now = input.now ?? new Date();
  const rows = await db
    .select({
      id: conversationReminders.id,
      conversationId: conversationReminders.conversationId,
      subject: conversations.subject,
      remindAt: conversationReminders.remindAt,
    })
    .from(conversationReminders)
    .innerJoin(
      conversations,
      eq(conversationReminders.conversationId, conversations.id),
    )
    .where(
      and(
        eq(conversationReminders.productId, input.productId),
        eq(conversationReminders.userId, input.userId),
        isNull(conversationReminders.completedAt),
        lte(conversationReminders.remindAt, now),
      ),
    )
    .orderBy(asc(conversationReminders.remindAt))
    .limit(10);

  return rows.map((row) => ({
    id: row.id,
    conversationId: row.conversationId,
    subject: row.subject,
    remindAt: iso(row.remindAt),
  }));
}

/**
 * Record that this user has seen the thread.
 *
 * The unread counter is team-wide, so opening it clears it for everyone; the
 * participant row keeps the per-person read time. Both writes are idempotent.
 */
export async function markConversationRead(input: {
  productId: string;
  conversationId: string;
  userId: string;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();

  await db
    .update(conversations)
    .set({ unreadForTeam: 0, updatedAt: now })
    .where(
      and(
        eq(conversations.id, input.conversationId),
        eq(conversations.productId, input.productId),
      ),
    );

  // Opening the thread also clears this operator's alerts for it.
  await db
    .update(conversationNotifications)
    .set({ readAt: now })
    .where(
      and(
        eq(conversationNotifications.conversationId, input.conversationId),
        eq(conversationNotifications.productId, input.productId),
        eq(conversationNotifications.userId, input.userId),
        isNull(conversationNotifications.readAt),
      ),
    );

  const existing = await db
    .select({ id: conversationParticipants.id })
    .from(conversationParticipants)
    .where(
      and(
        eq(conversationParticipants.conversationId, input.conversationId),
        eq(conversationParticipants.userId, input.userId),
      ),
    )
    .limit(1);

  if (existing[0]) {
    await db
      .update(conversationParticipants)
      .set({ lastReadAt: now })
      .where(eq(conversationParticipants.id, existing[0].id));
    return;
  }

  await db.insert(conversationParticipants).values({
    conversationId: input.conversationId,
    productId: input.productId,
    role: "team",
    userId: input.userId,
    lastReadAt: now,
  });
}
