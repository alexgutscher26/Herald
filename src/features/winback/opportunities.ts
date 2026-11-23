import "server-only";

import { and, asc, desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { releases } from "@/db/schema/releases";
import {
  cancellationReasons,
  customerAccounts,
  customerCancellations,
  releaseReasonLinks,
  winbackCampaignRecipients,
} from "@/db/schema/winback";

import { getWinbackAudience } from "./service";

/**
 * Why a cancelled customer is a win-back opportunity.
 *
 * The match is explicit data, never a score: the customer recorded a
 * cancellation reason, and a published release was deliberately linked to that
 * same reason in the release editor. Nothing here infers intent from timing or
 * text similarity.
 */

export type WinbackOpportunity = {
  customerAccountId: string;
  name: string | null;
  email: string | null;
  cancelledAt: string;
  reasonLabel: string;
  releases: { id: string; title: string; publishedAt: string | null }[];
  /** True when the customer passes every send rule (address, consent, suppression). */
  eligible: boolean;
  /** Why the customer cannot be contacted, when that is the case. */
  exclusionReason: string | null;
};

export type WinbackOpportunityList = {
  /** Customers with at least one reason-to-release match. */
  matched: number;
  /** Matched customers that are also contactable right now. */
  eligible: number;
  items: WinbackOpportunity[];
};

const EXCLUSION_LABELS: Record<string, string> = {
  no_email: "No email address",
  ineligible: "Win-back not allowed",
  unsubscribed: "Unsubscribed or suppressed",
  winback_opted_out: "Opted out of win-back",
  already_received: "Already received a campaign",
};

export function exclusionLabel(reason: string | null): string | null {
  return reason ? (EXCLUSION_LABELS[reason] ?? reason) : null;
}

type MatchRow = {
  accountId: string;
  name: string | null;
  email: string | null;
  cancelledAt: Date;
  reasonLabel: string;
  releaseId: string;
  releaseTitle: string;
  releasedAt: Date | null;
};

/**
 * Read every match for the product, then keep one row per customer using their
 * most recent cancellation. The audience check is the same function the send
 * path runs, so a customer shown as eligible here is eligible for the same
 * reasons a campaign would accept them.
 */
export async function listWinbackOpportunities(input: {
  workspaceId: string;
  productId: string;
  limit?: number;
}): Promise<WinbackOpportunityList> {
  const rows = await db
    .select({
      accountId: customerAccounts.id,
      name: customerAccounts.name,
      email: customerAccounts.email,
      cancelledAt: customerCancellations.cancelledAt,
      reasonLabel: cancellationReasons.label,
      releaseId: releases.id,
      releaseTitle: releases.title,
      releasedAt: releases.publishedAt,
    })
    .from(customerAccounts)
    .innerJoin(
      customerCancellations,
      eq(customerCancellations.customerAccountId, customerAccounts.id),
    )
    .innerJoin(
      cancellationReasons,
      eq(cancellationReasons.id, customerCancellations.cancellationReasonId),
    )
    .innerJoin(
      releaseReasonLinks,
      eq(releaseReasonLinks.cancellationReasonId, cancellationReasons.id),
    )
    .innerJoin(
      releases,
      and(
        eq(releases.id, releaseReasonLinks.releaseId),
        eq(releases.productId, customerAccounts.productId),
      ),
    )
    .where(
      and(
        eq(customerAccounts.productId, input.productId),
        eq(customerAccounts.status, "cancelled"),
        eq(cancellationReasons.workspaceId, input.workspaceId),
        eq(releases.status, "published"),
      ),
    )
    .orderBy(desc(customerCancellations.cancelledAt))
    .limit(2_000);

  const audience = await getWinbackAudience({
    workspaceId: input.workspaceId,
    productId: input.productId,
  });
  const eligibleIds = new Set(
    audience.eligible.map((member) => member.customerAccountId),
  );
  const exclusionByAccount = new Map(
    audience.excluded.map((member) => [member.customerAccountId, member.reason]),
  );

  const byAccount = new Map<string, WinbackOpportunity>();
  for (const row of rows as MatchRow[]) {
    const existing = byAccount.get(row.accountId);
    const release = {
      id: row.releaseId,
      title: row.releaseTitle,
      publishedAt: row.releasedAt ? row.releasedAt.toISOString() : null,
    };

    if (existing) {
      if (!existing.releases.some((item) => item.id === release.id)) {
        existing.releases.push(release);
      }
      if (existing.reasonLabel !== row.reasonLabel) {
        const labels = new Set(existing.reasonLabel.split(", "));
        labels.add(row.reasonLabel);
        existing.reasonLabel = [...labels].join(", ");
      }
      continue;
    }

    byAccount.set(row.accountId, {
      customerAccountId: row.accountId,
      name: row.name,
      email: row.email,
      cancelledAt: row.cancelledAt.toISOString(),
      reasonLabel: row.reasonLabel,
      releases: [release],
      eligible: eligibleIds.has(row.accountId),
      exclusionReason: exclusionByAccount.get(row.accountId) ?? null,
    });
  }

  const items = [...byAccount.values()].sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    return new Date(b.cancelledAt).getTime() - new Date(a.cancelledAt).getTime();
  });

  return {
    matched: items.length,
    eligible: items.filter((item) => item.eligible).length,
    items: items.slice(0, input.limit ?? 50),
  };
}

export type CancellationReasonUsage = {
  id: string;
  label: string;
  description: string | null;
  cancellations: number;
  /** Publishable releases deliberately linked to this reason. */
  releases: { id: string; title: string; status: string }[];
  /** Recipients emailed for this reason (unique per campaign). */
  sent: number;
  /** Sent recipients who returned, confirmed or inferred, within the window. */
  returned: number;
  /** The subset of `returned` a person explicitly confirmed. */
  confirmed: number;
  /** returned / sent, or null when nothing was sent. */
  returnRate: number | null;
};

export type CancellationReasonPerformance = {
  reasons: CancellationReasonUsage[];
  /** Reasons with cancellations but no published release addressing them. */
  unmatched: number;
  /** Highest return rate among reasons with at least five sends. */
  best: { id: string; label: string; returnRate: number; sent: number } | null;
};

export type CancellationReasonUsageList = {
  reasons: CancellationReasonUsage[];
  /** Reasons with cancellations but no published release addressing them. */
  unmatched: number;
};

/** Reason tags with the cancellations and release links that make them useful. */
export async function listCancellationReasonUsage(input: {
  workspaceId: string;
  productId: string;
}): Promise<CancellationReasonUsageList> {
  const [reasonRows, countRows, linkRows] = await Promise.all([
    db
      .select({
        id: cancellationReasons.id,
        label: cancellationReasons.label,
        description: cancellationReasons.description,
      })
      .from(cancellationReasons)
      .where(eq(cancellationReasons.workspaceId, input.workspaceId))
      .orderBy(asc(cancellationReasons.position), asc(cancellationReasons.label)),
    db
      .select({
        reasonId: customerCancellations.cancellationReasonId,
        count: sql<number>`count(*)::int`,
      })
      .from(customerCancellations)
      .innerJoin(
        customerAccounts,
        eq(customerAccounts.id, customerCancellations.customerAccountId),
      )
      .where(
        and(
          eq(customerAccounts.productId, input.productId),
          eq(customerAccounts.status, "cancelled"),
        ),
      )
      .groupBy(customerCancellations.cancellationReasonId),
    db
      .select({
        reasonId: releaseReasonLinks.cancellationReasonId,
        releaseId: releases.id,
        title: releases.title,
        status: releases.status,
      })
      .from(releaseReasonLinks)
      .innerJoin(releases, eq(releases.id, releaseReasonLinks.releaseId))
      .where(
        and(
          eq(releases.productId, input.productId),
          eq(releases.status, "published"),
        ),
      ),
  ]);

  const countByReason = new Map(
    countRows
      .filter((row) => row.reasonId !== null)
      .map((row) => [row.reasonId as string, row.count]),
  );
  const linksByReason = new Map<string, CancellationReasonUsage["releases"]>();
  for (const row of linkRows) {
    const current = linksByReason.get(row.reasonId) ?? [];
    current.push({ id: row.releaseId, title: row.title, status: row.status });
    linksByReason.set(row.reasonId, current);
  }

  const reasons = reasonRows.map((reason) => ({
    id: reason.id,
    label: reason.label,
    description: reason.description,
    cancellations: countByReason.get(reason.id) ?? 0,
    releases: linksByReason.get(reason.id) ?? [],
    sent: 0,
    returned: 0,
    confirmed: 0,
    returnRate: null,
  }));

  return {
    reasons,
    unmatched: reasons.filter(
      (reason) => reason.cancellations > 0 && reason.releases.length === 0,
    ).length,
  };
}

/**
 * Join cancellation reasons to win-back outcomes. A recipient is counted once
 * per reason the customer recorded, and only when the email was actually sent.
 * Rates are descriptive, not causal: "inferred" attribution is not proof.
 */
export async function getCancellationReasonPerformance(input: {
  workspaceId: string;
  productId: string;
}): Promise<CancellationReasonPerformance> {
  const [usage, recipientRows] = await Promise.all([
    listCancellationReasonUsage(input),
    db
      .select({
        reasonId: customerCancellations.cancellationReasonId,
        recipientId: winbackCampaignRecipients.id,
        status: winbackCampaignRecipients.status,
        convertedAt: winbackCampaignRecipients.convertedAt,
        attributionBasis: winbackCampaignRecipients.attributionBasis,
      })
      .from(winbackCampaignRecipients)
      .innerJoin(
        customerAccounts,
        eq(customerAccounts.id, winbackCampaignRecipients.customerAccountId),
      )
      .innerJoin(
        customerCancellations,
        eq(customerCancellations.customerAccountId, customerAccounts.id),
      )
      .where(eq(customerAccounts.productId, input.productId)),
  ]);

  const sentByReason = new Map<string, Set<string>>();
  const returnedByReason = new Map<string, Set<string>>();
  const confirmedByReason = new Map<string, Set<string>>();
  for (const row of recipientRows) {
    if (!row.reasonId || row.status !== "sent") continue;
    const sent = sentByReason.get(row.reasonId) ?? new Set<string>();
    sent.add(row.recipientId);
    sentByReason.set(row.reasonId, sent);
    if (row.convertedAt) {
      const returned = returnedByReason.get(row.reasonId) ?? new Set<string>();
      returned.add(row.recipientId);
      returnedByReason.set(row.reasonId, returned);
      if (row.attributionBasis === "confirmed") {
        const confirmed = confirmedByReason.get(row.reasonId) ?? new Set<string>();
        confirmed.add(row.recipientId);
        confirmedByReason.set(row.reasonId, confirmed);
      }
    }
  }

  const reasons = usage.reasons.map((reason) => {
    const sent = sentByReason.get(reason.id)?.size ?? 0;
    const returned = returnedByReason.get(reason.id)?.size ?? 0;
    const confirmed = confirmedByReason.get(reason.id)?.size ?? 0;
    return {
      ...reason,
      sent,
      returned,
      confirmed,
      returnRate: sent > 0 ? returned / sent : null,
    };
  });

  const eligibleForBest = reasons.filter((reason) => reason.sent >= 5 && reason.returnRate !== null);
  const bestReason = eligibleForBest.sort(
    (a, b) => (b.returnRate ?? 0) - (a.returnRate ?? 0) || b.sent - a.sent,
  )[0];

  return {
    reasons: reasons.sort(
      (a, b) =>
        (b.returnRate ?? -1) - (a.returnRate ?? -1) || b.cancellations - a.cancellations,
    ),
    unmatched: usage.unmatched,
    best: bestReason
      ? {
          id: bestReason.id,
          label: bestReason.label,
          returnRate: bestReason.returnRate ?? 0,
          sent: bestReason.sent,
        }
      : null,
  };
}
