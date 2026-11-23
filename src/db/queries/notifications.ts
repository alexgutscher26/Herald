import "server-only";

import { and, count, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import { feedbackPosts } from "@/db/schema/feedback";
import {
  notificationDeliveries,
  type NotificationTemplate,
} from "@/db/schema/notifications";
import { releases } from "@/db/schema/releases";
import {
  winbackCampaignRecipients,
  winbackCampaigns,
} from "@/db/schema/winback";

/**
 * Read-only projection of the email outbox.
 *
 * The delivery log is workspace-facing: every member who can read subscribers
 * can see what was attempted, what is queued and what failed. Rows are always
 * scoped by both product and workspace, and a joined title is only accepted
 * when it belongs to the same product, so a malformed row cannot leak a name
 * from another tenant into the page.
 */

export type DeliveryStatus =
  | "pending"
  | "sent"
  | "failed"
  | "bounced"
  | "complained"
  | "skipped";

export type DeliveryLogRow = {
  id: string;
  recipientEmail: string;
  template: NotificationTemplate;
  status: DeliveryStatus;
  attempts: number;
  providerMessageId: string | null;
  error: string | null;
  createdAt: string;
  sentAt: string | null;
  deferUntil: string | null;
  releaseTitle: string | null;
  feedbackTitle: string | null;
  campaignTitle: string | null;
};

export type DeliveryLogCounts = Record<DeliveryStatus, number>;

export type DeliveryLog = {
  rows: DeliveryLogRow[];
  counts: DeliveryLogCounts;
  /** Rows matching the current search/status filter. */
  total: number;
  /** All rows in the product, regardless of the filter. */
  unfilteredTotal: number;
};

export type DeliveryLogFilters = {
  limit?: number;
  search?: string;
  status?: DeliveryStatus | "all";
};

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

const EMPTY_COUNTS: DeliveryLogCounts = {
  pending: 0,
  sent: 0,
  failed: 0,
  bounced: 0,
  complained: 0,
  skipped: 0,
};

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

export async function getDeliveryLog(
  productId: string,
  workspaceId: string,
  options: number | DeliveryLogFilters = DEFAULT_LIMIT,
): Promise<DeliveryLog> {
  const filters: DeliveryLogFilters =
    typeof options === "number" ? { limit: options } : options;
  const bounded = Math.min(
    Math.max(Math.trunc(filters.limit ?? DEFAULT_LIMIT), 1),
    MAX_LIMIT,
  );
  const baseWhere =
    and(
      eq(notificationDeliveries.productId, productId),
      eq(notificationDeliveries.workspaceId, workspaceId),
    ) ?? sql`true`;
  const conditions: SQL[] = [baseWhere];
  if (filters.status && filters.status !== "all") {
    conditions.push(eq(notificationDeliveries.status, filters.status));
  }
  const search = filters.search?.trim().slice(0, 200) ?? "";
  if (search) {
    const pattern = `%${search}%`;
    const contentMatch = or(
      ilike(notificationDeliveries.recipientEmail, pattern),
      ilike(notificationDeliveries.providerMessageId, pattern),
      ilike(notificationDeliveries.error, pattern),
      sql`exists (select 1 from ${releases} where ${releases.id} = ${notificationDeliveries.releaseId} and ${releases.productId} = ${productId} and ${releases.title} ilike ${pattern})`,
      sql`exists (select 1 from ${feedbackPosts} where ${feedbackPosts.id} = ${notificationDeliveries.feedbackPostId} and ${feedbackPosts.productId} = ${productId} and ${feedbackPosts.title} ilike ${pattern})`,
      sql`exists (select 1 from ${winbackCampaignRecipients} wcr inner join ${winbackCampaigns} wc on wc.id = wcr.campaign_id where wcr.id = ${notificationDeliveries.winbackRecipientId} and wc.product_id = ${productId} and wc.name ilike ${pattern})`,
    );
    if (contentMatch) conditions.push(contentMatch);
  }
  const where = and(...conditions);

  const [rows, statusRows, totalRows] = await Promise.all([
    db
      .select({
        id: notificationDeliveries.id,
        recipientEmail: notificationDeliveries.recipientEmail,
        template: notificationDeliveries.template,
        status: notificationDeliveries.status,
        attempts: notificationDeliveries.attemptCount,
        providerMessageId: notificationDeliveries.providerMessageId,
        error: notificationDeliveries.error,
        createdAt: notificationDeliveries.createdAt,
        sentAt: notificationDeliveries.sentAt,
        deferUntil: notificationDeliveries.deferUntil,
        releaseTitle: releases.title,
        feedbackTitle: feedbackPosts.title,
        campaignTitle: winbackCampaigns.name,
      })
      .from(notificationDeliveries)
      .leftJoin(
        releases,
        and(
          eq(releases.id, notificationDeliveries.releaseId),
          eq(releases.productId, productId),
        ),
      )
      .leftJoin(
        feedbackPosts,
        and(
          eq(feedbackPosts.id, notificationDeliveries.feedbackPostId),
          eq(feedbackPosts.productId, productId),
        ),
      )
      .leftJoin(
        winbackCampaignRecipients,
        eq(
          winbackCampaignRecipients.id,
          notificationDeliveries.winbackRecipientId,
        ),
      )
      .leftJoin(
        winbackCampaigns,
        and(
          eq(winbackCampaigns.id, winbackCampaignRecipients.campaignId),
          eq(winbackCampaigns.productId, productId),
        ),
      )
      .where(where)
      .orderBy(desc(notificationDeliveries.createdAt))
      .limit(bounded),
    db
      .select({
        status: notificationDeliveries.status,
        value: count(),
      })
      .from(notificationDeliveries)
      .where(baseWhere)
      .groupBy(notificationDeliveries.status),
    db
      .select({ value: count() })
      .from(notificationDeliveries)
      .where(where),
  ]);

  const counts: DeliveryLogCounts = { ...EMPTY_COUNTS };
  for (const row of statusRows) {
    counts[row.status] = Number(row.value);
  }

  const unfilteredTotal = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const total = Number(totalRows[0]?.value ?? 0);

  return {
    rows: rows.map((row) => ({
      id: row.id,
      recipientEmail: row.recipientEmail,
      template: row.template,
      status: row.status,
      attempts: row.attempts,
      providerMessageId: row.providerMessageId,
      error: row.error,
      createdAt: row.createdAt.toISOString(),
      sentAt: iso(row.sentAt),
      deferUntil: iso(row.deferUntil),
      releaseTitle: row.releaseTitle,
      feedbackTitle: row.feedbackTitle,
      campaignTitle: row.campaignTitle,
    })),
    counts,
    total,
    unfilteredTotal,
  };
}
