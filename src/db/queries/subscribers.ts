import "server-only";

import { and, asc, count, desc, eq, gte, ilike, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { emailSuppressions } from "@/db/schema/email";
import { customerEvents } from "@/db/schema/events";
import { customers } from "@/db/schema/customers";
import { feedbackPosts } from "@/db/schema/feedback";
import { outboundMessageEvents, outboundMessages } from "@/db/schema/engagement";
import { notificationDeliveries } from "@/db/schema/notifications";
import { products } from "@/db/schema/workspaces";
import {
  subscriberTopicPreferences,
  subscribers,
  subscriptionTopics,
  type DigestFrequency,
} from "@/db/schema/subscribers";
import { pageOffset, paginationMeta } from "@/lib/pagination";

/**
 * Subscriber reads for the dashboard.
 *
 * Every query takes an already-authorized product or workspace id. Search is
 * bounded and parameterized; segment counts describe the whole product so the
 * header stays meaningful while a filter is active.
 */

export type SubscriberStatus = "pending" | "active" | "unsubscribed";
export type SubscriberSource = "widget" | "import" | "api" | "manual" | "follower";

export type SubscriberRow = {
  id: string;
  email: string;
  name: string | null;
  customerId: string | null;
  status: SubscriberStatus;
  source: SubscriberSource;
  notifyStatusChanges: boolean;
  notifyReplies: boolean;
  weeklyDigest: boolean;
  digestFrequency: DigestFrequency;
  createdAt: string;
  unsubscribedAt: string | null;
};

export type SubscriberFilters = {
  search?: string;
  status?: SubscriberStatus | "all";
  source?: SubscriberSource | "all";
  page?: number;
  pageSize?: number;
};

export type SubscriberCounts = {
  total: number;
  active: number;
  pending: number;
  unsubscribed: number;
  suppressed: number;
};

export type SubscriberList = {
  rows: SubscriberRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  counts: SubscriberCounts;
  sourceCounts: Record<string, number>;
};

function iso(value: Date): string {
  return value.toISOString();
}

function searchPattern(value: string): string {
  return `%${value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

export async function listSubscribers(
  productId: string,
  filters: SubscriberFilters = {},
  workspaceId?: string,
): Promise<SubscriberList> {
  const pageSize = Math.min(Math.max(Math.trunc(filters.pageSize ?? 25), 1), 100);
  const search = filters.search?.trim() ?? "";
  const status = filters.status ?? "all";
  const source = filters.source ?? "all";

  const conditions = [eq(subscribers.productId, productId)];
  if (search !== "") {
    conditions.push(
      or(
        ilike(subscribers.email, searchPattern(search)),
        ilike(subscribers.name, searchPattern(search)),
      )!,
    );
  }
  if (status !== "all") conditions.push(eq(subscribers.status, status));
  if (source !== "all") conditions.push(eq(subscribers.source, source));

  const where = and(...conditions);

  const [totalRows, statusRows, sourceRows, suppressedRows] = await Promise.all([
    db.select({ value: count() }).from(subscribers).where(where),
    db
      .select({ status: subscribers.status, value: count() })
      .from(subscribers)
      .where(eq(subscribers.productId, productId))
      .groupBy(subscribers.status),
    db
      .select({ source: subscribers.source, value: count() })
      .from(subscribers)
      .where(eq(subscribers.productId, productId))
      .groupBy(subscribers.source),
    workspaceId
      ? db
          .select({ value: count() })
          .from(emailSuppressions)
          .where(eq(emailSuppressions.workspaceId, workspaceId))
      : db
          .select({ value: count() })
          .from(emailSuppressions)
          .innerJoin(
            subscribers,
            eq(subscribers.emailNormalized, emailSuppressions.emailNormalized),
          )
          .where(eq(subscribers.productId, productId)),
  ]);

  const total = totalRows[0]?.value ?? 0;
  const pagination = paginationMeta({
    page: filters.page ?? 1,
    pageSize,
    total,
    maxPageSize: 100,
  });

  const rows = await db
    .select({
      id: subscribers.id,
      email: subscribers.email,
      name: subscribers.name,
      customerId: subscribers.customerId,
      status: subscribers.status,
      source: subscribers.source,
      notifyStatusChanges: subscribers.notifyStatusChanges,
      notifyReplies: subscribers.notifyReplies,
      weeklyDigest: subscribers.weeklyDigest,
      digestFrequency: subscribers.digestFrequency,
      createdAt: subscribers.createdAt,
      unsubscribedAt: subscribers.unsubscribedAt,
    })
    .from(subscribers)
    .where(where)
    .orderBy(desc(subscribers.createdAt), asc(subscribers.email))
    .limit(pagination.pageSize)
    .offset(pageOffset(pagination.page, pagination.pageSize, 100));

  const counts: SubscriberCounts = {
    total: 0,
    active: 0,
    pending: 0,
    unsubscribed: 0,
    suppressed: suppressedRows[0]?.value ?? 0,
  };
  const sourceCounts: Record<string, number> = {};

  for (const row of statusRows) {
    const value = row.value;
    counts[row.status] = value;
    counts.total += value;
  }
  for (const row of sourceRows) {
    sourceCounts[row.source] = row.value;
  }

  return {
    rows: rows.map((row) => ({
      ...row,
      createdAt: iso(row.createdAt),
      unsubscribedAt: row.unsubscribedAt ? iso(row.unsubscribedAt) : null,
    })),
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalPages: pagination.totalPages,
    counts,
    sourceCounts,
  };
}

export async function listAllSubscribers(productId: string): Promise<SubscriberRow[]> {
  const rows = await db
    .select({
      id: subscribers.id,
      email: subscribers.email,
      name: subscribers.name,
      customerId: subscribers.customerId,
      status: subscribers.status,
      source: subscribers.source,
      notifyStatusChanges: subscribers.notifyStatusChanges,
      notifyReplies: subscribers.notifyReplies,
      weeklyDigest: subscribers.weeklyDigest,
      digestFrequency: subscribers.digestFrequency,
      createdAt: subscribers.createdAt,
      unsubscribedAt: subscribers.unsubscribedAt,
    })
    .from(subscribers)
    .where(eq(subscribers.productId, productId))
    .orderBy(asc(subscribers.email));

  return rows.map((row) => ({
    ...row,
    createdAt: iso(row.createdAt),
    unsubscribedAt: row.unsubscribedAt ? iso(row.unsubscribedAt) : null,
  }));
}

export type SubscriberGrowthWeek = {
  /** Monday of the week, as YYYY-MM-DD in UTC. */
  weekStart: string;
  joined: number;
  lost: number;
};

function mondayOf(date: Date): Date {
  const day = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const offset = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - offset);
  return day;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Weekly joins and losses for the last `weeks` completed weeks, including
 * empty weeks so the chart's x-axis stays stable.
 */
export async function getSubscriberGrowth(
  productId: string,
  weeks = 12,
): Promise<SubscriberGrowthWeek[]> {
  const weekCount = Math.min(Math.max(Math.trunc(weeks), 1), 52);
  const currentWeek = mondayOf(new Date());
  const firstWeek = new Date(currentWeek);
  firstWeek.setUTCDate(firstWeek.getUTCDate() - (weekCount - 1) * 7);

  const [joinedRows, lostRows] = await Promise.all([
    db
      .select({
        week: sql<string>`date_trunc('week', ${subscribers.createdAt})::date::text`,
        total: count(),
      })
      .from(subscribers)
      .where(
        and(
          eq(subscribers.productId, productId),
          gte(subscribers.createdAt, firstWeek),
        ),
      )
      .groupBy(sql`date_trunc('week', ${subscribers.createdAt})::date`),
    db
      .select({
        week: sql<string>`date_trunc('week', ${subscribers.unsubscribedAt})::date::text`,
        total: count(),
      })
      .from(subscribers)
      .where(
        and(
          eq(subscribers.productId, productId),
          gte(subscribers.unsubscribedAt, firstWeek),
        ),
      )
      .groupBy(sql`date_trunc('week', ${subscribers.unsubscribedAt})::date`),
  ]);

  const joined = new Map(joinedRows.map((row) => [row.week, row.total]));
  const lost = new Map(lostRows.map((row) => [row.week, row.total]));

  return Array.from({ length: weekCount }, (_, index) => {
    const week = new Date(firstWeek);
    week.setUTCDate(week.getUTCDate() + index * 7);
    const key = isoDay(week);
    return {
      weekStart: key,
      joined: joined.get(key) ?? 0,
      lost: lost.get(key) ?? 0,
    };
  });
}

export type SubscriberEmailRow = {
  id: string;
  template: string;
  status: string;
  sentAt: string | null;
  createdAt: string;
  error: string | null;
};

export type SubscriberEventRow = {
  id: string;
  name: string;
  occurredAt: string;
};

export type SubscriberDetail = {
  subscriber: SubscriberRow & {
    confirmedAt: string | null;
    confirmationSentAt: string | null;
    winbackOptedOutAt: string | null;
  };
  customer: {
    id: string;
    email: string | null;
    name: string | null;
    traits: Record<string, unknown>;
    createdAt: string;
    lastSeenAt: string | null;
    verifiedAt: string | null;
    crmLifecycleStage: string | null;
  } | null;
  events: SubscriberEventRow[];
  emails: SubscriberEmailRow[];
  engagement: {
    feedbackAuthored: number;
    delivered: number;
    bounced: number;
    complained: number;
    opened: number;
    clicked: number;
  };
  topics: {
    key: string;
    name: string;
    subscribed: boolean;
    builtIn: boolean;
  }[];
};

/** One subscriber with the customer, activity and email history behind it. */
export async function getSubscriberDetail(input: {
  workspaceId: string;
  productId: string;
  subscriberId: string;
}): Promise<SubscriberDetail | null> {
  const rows = await db
    .select({
      id: subscribers.id,
      email: subscribers.email,
      emailNormalized: subscribers.emailNormalized,
      name: subscribers.name,
      customerId: subscribers.customerId,
      status: subscribers.status,
      source: subscribers.source,
      notifyStatusChanges: subscribers.notifyStatusChanges,
      notifyReplies: subscribers.notifyReplies,
      weeklyDigest: subscribers.weeklyDigest,
      digestFrequency: subscribers.digestFrequency,
      createdAt: subscribers.createdAt,
      unsubscribedAt: subscribers.unsubscribedAt,
      confirmedAt: subscribers.confirmedAt,
      confirmationSentAt: subscribers.confirmationSentAt,
      winbackOptedOutAt: subscribers.winbackOptedOutAt,
    })
    .from(subscribers)
    .innerJoin(products, eq(subscribers.productId, products.id))
    .where(
      and(
        eq(subscribers.id, input.subscriberId),
        eq(subscribers.productId, input.productId),
        eq(products.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);

  const subscriber = rows[0];
  if (!subscriber) return null;

  const customerId = subscriber.customerId;

  const [customerRows, eventRows, emailRows, deliveryCounts, outboundCounts, feedbackCount, topics] =
    await Promise.all([
      customerId
        ? db
            .select({
              id: customers.id,
              email: customers.email,
              name: customers.name,
              traits: customers.traits,
              createdAt: customers.createdAt,
              lastSeenAt: customers.lastSeenAt,
              verifiedAt: customers.verifiedAt,
              crmLifecycleStage: customers.crmLifecycleStage,
            })
            .from(customers)
            .where(
              and(
                eq(customers.id, customerId),
                eq(customers.workspaceId, input.workspaceId),
              ),
            )
            .limit(1)
        : Promise.resolve([]),
      customerId
        ? db
            .select({
              id: customerEvents.id,
              name: customerEvents.name,
              occurredAt: customerEvents.occurredAt,
            })
            .from(customerEvents)
            .where(
              and(
                eq(customerEvents.customerId, customerId),
                eq(customerEvents.productId, input.productId),
              ),
            )
            .orderBy(desc(customerEvents.occurredAt))
            .limit(25)
        : Promise.resolve([]),
      db
        .select({
          id: notificationDeliveries.id,
          template: notificationDeliveries.template,
          status: notificationDeliveries.status,
          sentAt: notificationDeliveries.sentAt,
          createdAt: notificationDeliveries.createdAt,
          error: notificationDeliveries.error,
        })
        .from(notificationDeliveries)
        .where(
          and(
            eq(notificationDeliveries.productId, input.productId),
            eq(
              notificationDeliveries.recipientEmailNormalized,
              subscriber.emailNormalized,
            ),
          ),
        )
        .orderBy(desc(notificationDeliveries.createdAt))
        .limit(25),
      db
        .select({ status: notificationDeliveries.status, total: count() })
        .from(notificationDeliveries)
        .where(
          and(
            eq(notificationDeliveries.productId, input.productId),
            eq(
              notificationDeliveries.recipientEmailNormalized,
              subscriber.emailNormalized,
            ),
          ),
        )
        .groupBy(notificationDeliveries.status),
      customerId
        ? db
            .select({ type: outboundMessageEvents.type, total: count() })
            .from(outboundMessageEvents)
            .innerJoin(
              outboundMessages,
              eq(outboundMessageEvents.messageId, outboundMessages.id),
            )
            .where(
              and(
                eq(outboundMessageEvents.customerId, customerId),
                eq(outboundMessages.productId, input.productId),
              ),
            )
            .groupBy(outboundMessageEvents.type)
        : Promise.resolve([]),
      customerId
        ? db
            .select({ total: count() })
            .from(feedbackPosts)
            .where(
              and(
                eq(feedbackPosts.authorCustomerId, customerId),
                eq(feedbackPosts.productId, input.productId),
              ),
            )
        : Promise.resolve([{ total: 0 }]),
      db
        .select({
          key: subscriptionTopics.key,
          name: subscriptionTopics.name,
          subscribed: subscriberTopicPreferences.subscribed,
        })
        .from(subscriptionTopics)
        .leftJoin(
          subscriberTopicPreferences,
          and(
            eq(subscriberTopicPreferences.topicId, subscriptionTopics.id),
            eq(subscriberTopicPreferences.subscriberId, subscriber.id),
          ),
        )
        .where(eq(subscriptionTopics.productId, input.productId))
        .orderBy(asc(subscriptionTopics.position)),
    ]);

  const deliveryByStatus = new Map(deliveryCounts.map((row) => [row.status, row.total]));
  const outboundByType = new Map(outboundCounts.map((row) => [row.type, row.total]));
  const customer = customerRows[0] ?? null;

  return {
    subscriber: {
      ...subscriber,
      createdAt: iso(subscriber.createdAt),
      unsubscribedAt: subscriber.unsubscribedAt ? iso(subscriber.unsubscribedAt) : null,
      confirmedAt: subscriber.confirmedAt ? iso(subscriber.confirmedAt) : null,
      confirmationSentAt: subscriber.confirmationSentAt
        ? iso(subscriber.confirmationSentAt)
        : null,
      winbackOptedOutAt: subscriber.winbackOptedOutAt
        ? iso(subscriber.winbackOptedOutAt)
        : null,
    },
    customer: customer
      ? {
          id: customer.id,
          email: customer.email,
          name: customer.name,
          traits: customer.traits ?? {},
          createdAt: iso(customer.createdAt),
          lastSeenAt: customer.lastSeenAt ? iso(customer.lastSeenAt) : null,
          verifiedAt: customer.verifiedAt ? iso(customer.verifiedAt) : null,
          crmLifecycleStage: customer.crmLifecycleStage,
        }
      : null,
    events: eventRows.map((row) => ({
      id: row.id,
      name: row.name,
      occurredAt: iso(row.occurredAt),
    })),
    emails: emailRows.map((row) => ({
      id: row.id,
      template: row.template,
      status: row.status,
      sentAt: row.sentAt ? iso(row.sentAt) : null,
      createdAt: iso(row.createdAt),
      error: row.error,
    })),
    engagement: {
      feedbackAuthored: feedbackCount[0]?.total ?? 0,
      delivered: deliveryByStatus.get("sent") ?? 0,
      bounced: deliveryByStatus.get("bounced") ?? 0,
      complained: deliveryByStatus.get("complained") ?? 0,
      opened: outboundByType.get("opened") ?? 0,
      clicked: outboundByType.get("clicked") ?? 0,
    },
    topics: topics.map((topic) => ({
      key: topic.key,
      name: topic.name,
      // The two built-in topics live on the subscriber row, not in preferences.
      subscribed:
        topic.key === "product_updates"
          ? subscriber.status === "active"
          : topic.key === "winback"
            ? subscriber.winbackOptedOutAt === null
            : (topic.subscribed ?? false),
      builtIn: topic.key === "product_updates" || topic.key === "winback",
    })),
  };
}

export type SuppressionRow = {
  id: string;
  email: string;
  reason: "hard_bounce" | "complaint" | "manual" | "unsubscribe";
  note: string | null;
  createdAt: string;
};

export async function listAllSuppressions(
  workspaceId: string,
): Promise<SuppressionRow[]> {
  const rows = await db
    .select({
      id: emailSuppressions.id,
      email: emailSuppressions.email,
      reason: emailSuppressions.reason,
      note: emailSuppressions.note,
      createdAt: emailSuppressions.createdAt,
    })
    .from(emailSuppressions)
    .where(eq(emailSuppressions.workspaceId, workspaceId))
    .orderBy(desc(emailSuppressions.createdAt))
    .limit(10_000);

  return rows.map((row) => ({ ...row, createdAt: iso(row.createdAt) }));
}

export async function listSuppressions(
  workspaceId: string,
  search = "",
): Promise<SuppressionRow[]> {
  const needle = search.trim();
  const rows = await db
    .select({
      id: emailSuppressions.id,
      email: emailSuppressions.email,
      reason: emailSuppressions.reason,
      note: emailSuppressions.note,
      createdAt: emailSuppressions.createdAt,
    })
    .from(emailSuppressions)
    .where(
      needle === ""
        ? eq(emailSuppressions.workspaceId, workspaceId)
        : and(
            eq(emailSuppressions.workspaceId, workspaceId),
            ilike(emailSuppressions.email, searchPattern(needle)),
          ),
    )
    .orderBy(desc(emailSuppressions.createdAt))
    .limit(200);

  return rows.map((row) => ({ ...row, createdAt: iso(row.createdAt) }));
}
