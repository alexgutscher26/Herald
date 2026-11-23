import "server-only";

import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";

import { db } from "@/db";
import { emailSuppressions } from "@/db/schema/email";
import { notificationDeliveries } from "@/db/schema/notifications";
import { releases } from "@/db/schema/releases";
import { subscribers } from "@/db/schema/subscribers";
import {
  cancellationReasons,
  customerAccounts,
  customerCancellations,
  releaseReasonLinks,
  winbackCampaignRecipients,
  winbackCampaigns,
  type WinbackCampaign,
  type WinbackCampaignRecipient,
} from "@/db/schema/winback";
import { getSenderIdentity, senderIdentityProblem } from "@/features/email/identity";
import { enqueueJob } from "@/features/jobs/queue";
import { createPreferenceToken } from "@/features/subscribers/preferences";
import { evaluateSegmentById, getSegmentForProduct } from "@/features/segments/service";
import type { SenderIdentity as SenderIdentityType } from "@/features/email/identity";

import type { CancellationImportRow } from "./csv";
import { assignVariant, normalizeAbTestPercent } from "./variants";

/**
 * Win-back campaign lifecycle.
 *
 * Audience membership is a snapshot of product-scoped customer accounts. A
 * customer is only writable when the account is cancelled, explicitly marked
 * eligible, has a valid address, has not opted out or been suppressed, and has
 * not already received a campaign. Approval and sending are separate; sending
 * re-checks every pending recipient so a late opt-out or bounce still wins.
 */

export const WINBACK_CANARY_SIZE = 5;
export const WINBACK_ATTRIBUTION_DAYS = 30;

export type WinbackExclusionReason =
  | "no_email"
  | "ineligible"
  | "unsubscribed"
  | "winback_opted_out"
  | "already_received"
  | "segment_mismatch"
  | "campaign_not_approved"
  | "campaign_stopped";

export type WinbackAudienceMember = {
  customerAccountId: string;
  email: string;
  emailNormalized: string;
  name: string | null;
};

export type WinbackExcludedMember = {
  customerAccountId: string;
  email: string | null;
  emailNormalized: string | null;
  name: string | null;
  reason: WinbackExclusionReason;
};

export type WinbackAudienceCounts = {
  cancelled: number;
  eligible: number;
  excluded: number;
  no_email: number;
  ineligible: number;
  unsubscribed: number;
  winback_opted_out: number;
  already_received: number;
  segment_mismatch: number;
};

export type WinbackAudience = {
  eligible: WinbackAudienceMember[];
  excluded: WinbackExcludedMember[];
  counts: WinbackAudienceCounts;
};

type AccountRow = {
  id: string;
  email: string | null;
  emailNormalized: string | null;
  name: string | null;
  status: "active" | "cancelled" | "reactivated" | "unknown";
  winbackEligibility: "unknown" | "eligible" | "ineligible";
  winbackOptedOutAt: Date | null;
};

function emptyCounts(): WinbackAudienceCounts {
  return {
    cancelled: 0,
    eligible: 0,
    excluded: 0,
    no_email: 0,
    ineligible: 0,
    unsubscribed: 0,
    winback_opted_out: 0,
    already_received: 0,
    segment_mismatch: 0,
  };
}

/**
 * Build the current audience without writing it. The result is deterministic
 * for a given database state and is reused by the page preview and by send.
 */
export async function getWinbackAudience(input: {
  workspaceId: string;
  productId: string;
  excludeCampaignId?: string;
  /** Optional saved segment; recipients must also be in its customer list. */
  segmentId?: string | null;
}): Promise<WinbackAudience> {
  const [accountRows, suppressionRows, subscriberRows, priorRows] = await Promise.all([
    db
      .select({
        id: customerAccounts.id,
        email: customerAccounts.email,
        emailNormalized: customerAccounts.emailNormalized,
        name: customerAccounts.name,
        status: customerAccounts.status,
        winbackEligibility: customerAccounts.winbackEligibility,
        winbackOptedOutAt: customerAccounts.winbackOptedOutAt,
      })
      .from(customerAccounts)
      .where(
        and(
          eq(customerAccounts.productId, input.productId),
          eq(customerAccounts.status, "cancelled"),
        ),
      )
      .orderBy(asc(customerAccounts.emailNormalized), asc(customerAccounts.id))
      .limit(10_000),
    db
      .select({ emailNormalized: emailSuppressions.emailNormalized })
      .from(emailSuppressions)
      .where(eq(emailSuppressions.workspaceId, input.workspaceId)),
    db
      .select({
        emailNormalized: subscribers.emailNormalized,
        status: subscribers.status,
        winbackOptedOutAt: subscribers.winbackOptedOutAt,
      })
      .from(subscribers)
      .where(eq(subscribers.productId, input.productId)),
    db
      .selectDistinct({ customerAccountId: winbackCampaignRecipients.customerAccountId })
      .from(winbackCampaignRecipients)
      .innerJoin(
        winbackCampaigns,
        eq(winbackCampaigns.id, winbackCampaignRecipients.campaignId),
      )
      .where(
        and(
          eq(winbackCampaigns.productId, input.productId),
          inArray(winbackCampaigns.sendStatus, ["sending", "sent", "partially_sent"]),
          input.excludeCampaignId
            ? ne(winbackCampaigns.id, input.excludeCampaignId)
            : undefined,
        ),
      ),
  ]);

  const segment = input.segmentId
    ? await evaluateSegmentById({
        workspaceId: input.workspaceId,
        productId: input.productId,
        segmentId: input.segmentId,
      })
    : null;
  const segmentEmails = input.segmentId ? (segment?.emails ?? new Set<string>()) : null;

  const suppressed = new Set(suppressionRows.map((row) => row.emailNormalized));
  const subscriberByEmail = new Map(
    subscriberRows
      .filter((row) => row.emailNormalized !== "")
      .map((row) => [row.emailNormalized, row]),
  );
  const alreadyReceived = new Set(priorRows.map((row) => row.customerAccountId));

  const eligible: WinbackAudienceMember[] = [];
  const excluded: WinbackExcludedMember[] = [];
  const counts = emptyCounts();
  counts.cancelled = accountRows.length;

  function exclude(
    account: AccountRow,
    reason: Exclude<WinbackExclusionReason, "campaign_not_approved" | "campaign_stopped">,
  ): void {
    counts.excluded += 1;
    counts[reason] += 1;
    excluded.push({
      customerAccountId: account.id,
      email: account.email,
      emailNormalized: account.emailNormalized,
      name: account.name,
      reason,
    });
  }

  for (const account of accountRows as AccountRow[]) {
    if (!account.email || !account.emailNormalized || !account.email.includes("@")) {
      exclude(account, "no_email");
      continue;
    }
    if (account.winbackEligibility !== "eligible") {
      exclude(account, "ineligible");
      continue;
    }
    if (account.winbackOptedOutAt !== null) {
      exclude(account, "winback_opted_out");
      continue;
    }

    const subscriber = subscriberByEmail.get(account.emailNormalized);
    if (
      subscriber?.winbackOptedOutAt !== null &&
      subscriber?.winbackOptedOutAt !== undefined
    ) {
      exclude(account, "winback_opted_out");
      continue;
    }
    if (subscriber?.status === "unsubscribed" || suppressed.has(account.emailNormalized)) {
      exclude(account, "unsubscribed");
      continue;
    }
    if (segmentEmails && !segmentEmails.has(account.emailNormalized)) {
      exclude(account, "segment_mismatch");
      continue;
    }
    if (alreadyReceived.has(account.id)) {
      exclude(account, "already_received");
      continue;
    }

    eligible.push({
      customerAccountId: account.id,
      email: account.email,
      emailNormalized: account.emailNormalized,
      name: account.name,
    });
    counts.eligible += 1;
  }

  return { eligible, excluded, counts };
}

export type WinbackCampaignSummary = {
  id: string;
  name: string;
  approvalStatus: WinbackCampaign["approvalStatus"];
  sendStatus: WinbackCampaign["sendStatus"];
  releaseTitle: string | null;
  recipients: number;
  excluded: number;
  queued: number;
  sent: number;
  returned: number;
  createdAt: string;
  sentAt: string | null;
  canarySentAt: string | null;
  stoppedAt: string | null;
};

export type WinbackOverview = {
  campaigns: WinbackCampaignSummary[];
  audience: WinbackAudienceCounts;
  reasons: number;
};

export async function getWinbackOverview(input: {
  workspaceId: string;
  productId: string;
}): Promise<WinbackOverview> {
  const [audience, campaignRows, reasonRows] = await Promise.all([
    getWinbackAudience(input),
    db
      .select({
        campaign: winbackCampaigns,
        releaseTitle: releases.title,
      })
      .from(winbackCampaigns)
      .leftJoin(releases, eq(winbackCampaigns.releaseId, releases.id))
      .where(eq(winbackCampaigns.productId, input.productId))
      .orderBy(desc(winbackCampaigns.createdAt))
      .limit(100),
    db
      .select({ id: cancellationReasons.id })
      .from(cancellationReasons)
      .where(eq(cancellationReasons.workspaceId, input.workspaceId)),
  ]);

  const ids = campaignRows.map((row) => row.campaign.id);
  const recipients =
    ids.length === 0
      ? []
      : await db
          .select({
            campaignId: winbackCampaignRecipients.campaignId,
            status: winbackCampaignRecipients.status,
            convertedAt: winbackCampaignRecipients.convertedAt,
          })
          .from(winbackCampaignRecipients)
          .where(inArray(winbackCampaignRecipients.campaignId, ids));

  const byCampaign = new Map<
    string,
    { total: number; excluded: number; queued: number; sent: number; returned: number }
  >();
  for (const row of recipients) {
    const current = byCampaign.get(row.campaignId) ?? {
      total: 0,
      excluded: 0,
      queued: 0,
      sent: 0,
      returned: 0,
    };
    current.total += 1;
    if (row.status === "excluded") current.excluded += 1;
    if (row.status === "queued") current.queued += 1;
    if (row.status === "sent") current.sent += 1;
    if (row.convertedAt !== null) current.returned += 1;
    byCampaign.set(row.campaignId, current);
  }

  return {
    campaigns: campaignRows.map(({ campaign, releaseTitle }) => {
      const stats = byCampaign.get(campaign.id) ?? {
        total: 0,
        excluded: 0,
        queued: 0,
        sent: 0,
        returned: 0,
      };
      return {
        id: campaign.id,
        name: campaign.name,
        approvalStatus: campaign.approvalStatus,
        sendStatus: campaign.sendStatus,
        releaseTitle,
        recipients: stats.total,
        excluded: stats.excluded,
        queued: stats.queued,
        sent: stats.sent,
        returned: stats.returned,
        createdAt: campaign.createdAt.toISOString(),
        sentAt: campaign.sentAt?.toISOString() ?? null,
        canarySentAt: campaign.canarySentAt?.toISOString() ?? null,
        stoppedAt: campaign.stoppedAt?.toISOString() ?? null,
      };
    }),
    audience: audience.counts,
    reasons: reasonRows.length,
  };
}

export type CampaignRecipientView = {
  id: string;
  customerAccountId: string;
  email: string | null;
  name: string | null;
  status: WinbackCampaignRecipient["status"];
  variant: WinbackCampaignRecipient["variant"];
  exclusionReason: WinbackCampaignRecipient["exclusionReason"];
  attributionBasis: WinbackCampaignRecipient["attributionBasis"];
  convertedAt: string | null;
  queuedAt: string | null;
  sentAt: string | null;
  /** When the 30-day return window closes for this send. */
  attributionWindowEndsAt: string | null;
  attributionOpen: boolean;
  /** Sent, window elapsed, and never attributed. */
  attributionWindowEnded: boolean;
  delivery: {
    id: string;
    status: string;
    attempts: number;
    providerMessageId: string | null;
    error: string | null;
    sentAt: string | null;
  } | null;
};

export type CampaignDetail = {
  campaign: WinbackCampaign;
  release: { id: string; title: string; slug: string; status: string } | null;
  reasons: { id: string; label: string }[];
  recipients: CampaignRecipientView[];
  counts: {
    total: number;
    excluded: number;
    queued: number;
    sent: number;
    returned: number;
    windowEnded: number;
  };
  /** Present only when an A/B test is configured. */
  variantSummary: {
    percent: number;
    a: { recipients: number; sent: number; returned: number };
    b: { recipients: number; sent: number; returned: number };
  } | null;
  excludedByReason: { reason: WinbackExclusionReason; count: number }[];
  canary: { sentAt: string | null; recipientCount: number; ready: boolean };
  attributionWindowDays: number;
  sender: SenderIdentityType;
  senderProblem: string | null;
};

export async function getCampaignDetail(input: {
  workspaceId: string;
  productId: string;
  campaignId: string;
}): Promise<CampaignDetail | null> {
  const rows = await db
    .select({
      campaign: winbackCampaigns,
      releaseId: releases.id,
      releaseTitle: releases.title,
      releaseSlug: releases.slug,
      releaseStatus: releases.status,
    })
    .from(winbackCampaigns)
    .leftJoin(releases, eq(winbackCampaigns.releaseId, releases.id))
    .where(
      and(
        eq(winbackCampaigns.id, input.campaignId),
        eq(winbackCampaigns.productId, input.productId),
        eq(winbackCampaigns.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const [recipientRows, deliveries, reasonRows, sender] = await Promise.all([
    db
      .select({
        recipient: winbackCampaignRecipients,
        accountName: customerAccounts.name,
        accountEmail: customerAccounts.email,
      })
      .from(winbackCampaignRecipients)
      .innerJoin(
        customerAccounts,
        eq(winbackCampaignRecipients.customerAccountId, customerAccounts.id),
      )
      .where(eq(winbackCampaignRecipients.campaignId, input.campaignId))
      .orderBy(asc(winbackCampaignRecipients.emailNormalized)),
    db
      .select({
        id: notificationDeliveries.id,
        status: notificationDeliveries.status,
        attemptCount: notificationDeliveries.attemptCount,
        providerMessageId: notificationDeliveries.providerMessageId,
        error: notificationDeliveries.error,
        sentAt: notificationDeliveries.sentAt,
        winbackRecipientId: notificationDeliveries.winbackRecipientId,
      })
      .from(notificationDeliveries)
      .innerJoin(
        winbackCampaignRecipients,
        eq(notificationDeliveries.winbackRecipientId, winbackCampaignRecipients.id),
      )
      .where(eq(winbackCampaignRecipients.campaignId, input.campaignId))
      .orderBy(desc(notificationDeliveries.createdAt)),
    row.releaseId
      ? db
          .select({ id: cancellationReasons.id, label: cancellationReasons.label })
          .from(releaseReasonLinks)
          .innerJoin(
            cancellationReasons,
            eq(releaseReasonLinks.cancellationReasonId, cancellationReasons.id),
          )
          .where(eq(releaseReasonLinks.releaseId, row.releaseId))
          .orderBy(asc(cancellationReasons.label))
      : Promise.resolve([]),
    getSenderIdentity(input.workspaceId),
  ]);

  const deliveryByRecipient = new Map(
    deliveries
      .filter((delivery) => delivery.winbackRecipientId !== null)
      .map((delivery) => [delivery.winbackRecipientId as string, delivery]),
  );

  const recipients: CampaignRecipientView[] = recipientRows.map(({ recipient, accountName, accountEmail }) => {
    const delivery = deliveryByRecipient.get(recipient.id);
    const windowEndsAt = recipient.sentAt
      ? new Date(
          recipient.sentAt.getTime() +
            WINBACK_ATTRIBUTION_DAYS * 24 * 60 * 60 * 1000,
        )
      : null;
    const attributionOpen =
      recipient.status === "sent" &&
      windowEndsAt !== null &&
      windowEndsAt.getTime() >= Date.now();
    return {
      id: recipient.id,
      customerAccountId: recipient.customerAccountId,
      email: recipient.email ?? accountEmail,
      name: accountName,
      status: recipient.status,
      variant: recipient.variant,
      exclusionReason: recipient.exclusionReason,
      attributionBasis: recipient.attributionBasis,
      convertedAt: recipient.convertedAt?.toISOString() ?? null,
      queuedAt: recipient.queuedAt?.toISOString() ?? null,
      sentAt: recipient.sentAt?.toISOString() ?? null,
      attributionWindowEndsAt: windowEndsAt?.toISOString() ?? null,
      attributionOpen,
      attributionWindowEnded:
        recipient.status === "sent" &&
        windowEndsAt !== null &&
        !attributionOpen &&
        recipient.convertedAt === null,
      delivery: delivery
        ? {
            id: delivery.id,
            status: delivery.status,
            attempts: delivery.attemptCount,
            providerMessageId: delivery.providerMessageId,
            error: delivery.error,
            sentAt: delivery.sentAt?.toISOString() ?? null,
          }
        : null,
    };
  });

  const counts = {
    total: recipients.length,
    excluded: recipients.filter((recipient) => recipient.status === "excluded").length,
    queued: recipients.filter((recipient) => recipient.status === "queued").length,
    sent: recipients.filter((recipient) => recipient.status === "sent").length,
    returned: recipients.filter((recipient) => recipient.convertedAt !== null).length,
    windowEnded: recipients.filter((recipient) => recipient.attributionWindowEnded).length,
  };

  const abTestPercent = row.campaign.abTestPercent ?? 0;
  const variantSummary =
    abTestPercent > 0
      ? {
          percent: abTestPercent,
          a: {
            recipients: recipients.filter((recipient) => recipient.variant === "a").length,
            sent: recipients.filter(
              (recipient) => recipient.variant === "a" && recipient.status === "sent",
            ).length,
            returned: recipients.filter(
              (recipient) => recipient.variant === "a" && recipient.convertedAt !== null,
            ).length,
          },
          b: {
            recipients: recipients.filter((recipient) => recipient.variant === "b").length,
            sent: recipients.filter(
              (recipient) => recipient.variant === "b" && recipient.status === "sent",
            ).length,
            returned: recipients.filter(
              (recipient) => recipient.variant === "b" && recipient.convertedAt !== null,
            ).length,
          },
        }
      : null;

  const excludedByReason = new Map<WinbackExclusionReason, number>();
  for (const recipient of recipients) {
    if (recipient.status !== "excluded" || !recipient.exclusionReason) continue;
    excludedByReason.set(
      recipient.exclusionReason,
      (excludedByReason.get(recipient.exclusionReason) ?? 0) + 1,
    );
  }

  const canaryAt = row.campaign.canarySentAt?.getTime() ?? null;
  const canaryPending = recipients.filter(
    (recipient) =>
      recipient.queuedAt !== null &&
      canaryAt !== null &&
      new Date(recipient.queuedAt).getTime() <= canaryAt &&
      (recipient.status === "pending" || recipient.status === "queued"),
  ).length;

  return {
    campaign: row.campaign,
    release:
      row.releaseId && row.releaseTitle && row.releaseSlug && row.releaseStatus
        ? {
            id: row.releaseId,
            title: row.releaseTitle,
            slug: row.releaseSlug,
            status: row.releaseStatus,
          }
        : null,
    reasons: reasonRows,
    recipients,
    counts,
    variantSummary,
    excludedByReason: [...excludedByReason.entries()].map(([reason, count]) => ({
      reason,
      count,
    })),
    canary: {
      sentAt: row.campaign.canarySentAt?.toISOString() ?? null,
      recipientCount: row.campaign.canaryRecipientCount,
      ready: canaryAt !== null && row.campaign.canaryRecipientCount > 0 && canaryPending === 0,
    },
    attributionWindowDays: WINBACK_ATTRIBUTION_DAYS,
    sender,
    senderProblem: senderIdentityProblem(sender),
  };
}

export type CreateCampaignResult =
  | { ok: true; campaignId: string; audience: WinbackAudienceCounts }
  | { ok: false; error: string };

function campaignDescription(value: string): string | null {
  const description = value.trim();
  return description.length === 0 ? null : description.slice(0, 5_000);
}

function resolveAbTest(input: {
  messageB?: string | null;
  abTestPercent?: number | null;
}): { ok: true; messageB: string | null; percent: number } | { ok: false; error: string } {
  const percent = normalizeAbTestPercent(input.abTestPercent ?? 0);
  const messageB = input.messageB?.trim() ?? "";
  if (percent === 0) return { ok: true, messageB: null, percent: 0 };
  if (messageB.length < 10) {
    return {
      ok: false,
      error: "Write at least a sentence for the second A/B message.",
    };
  }
  return { ok: true, messageB: messageB.slice(0, 5_000), percent };
}

async function validateRelease(
  productId: string,
  releaseId: string | null,
): Promise<string | null> {
  if (!releaseId) return null;
  const rows = await db
    .select({ id: releases.id })
    .from(releases)
    .where(and(eq(releases.id, releaseId), eq(releases.productId, productId)))
    .limit(1);
  return rows[0] ? null : "That release does not belong to this product.";
}

async function replaceRecipients(input: {
  campaignId: string;
  audience: WinbackAudience;
  abTestPercent: number;
}): Promise<void> {
  await db
    .delete(winbackCampaignRecipients)
    .where(eq(winbackCampaignRecipients.campaignId, input.campaignId));

  const values: Array<typeof winbackCampaignRecipients.$inferInsert> = [
    ...input.audience.eligible.map((member) => ({
      campaignId: input.campaignId,
      customerAccountId: member.customerAccountId,
      email: member.email,
      emailNormalized: member.emailNormalized,
      status: "pending" as const,
      variant: assignVariant(member.customerAccountId, input.abTestPercent),
    })),
    ...input.audience.excluded.map((member) => ({
      campaignId: input.campaignId,
      customerAccountId: member.customerAccountId,
      email: member.email,
      emailNormalized: member.emailNormalized,
      status: "excluded" as const,
      exclusionReason: member.reason,
      variant: "a" as const,
    })),
  ];

  for (let index = 0; index < values.length; index += 500) {
    await db.insert(winbackCampaignRecipients).values(values.slice(index, index + 500));
  }
}

export async function createCampaign(input: {
  workspaceId: string;
  productId: string;
  actorUserId: string;
  name: string;
  description: string;
  releaseId: string | null;
  segmentId?: string | null;
  messageB?: string | null;
  abTestPercent?: number | null;
}): Promise<CreateCampaignResult> {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 160) {
    return { ok: false, error: "Use a campaign name between 2 and 160 characters." };
  }
  const description = campaignDescription(input.description);
  if (!description) return { ok: false, error: "Write the campaign message before saving." };
  if (description.length < 10) {
    return { ok: false, error: "Write at least a sentence for the campaign message." };
  }
  const abTest = resolveAbTest(input);
  if (!abTest.ok) return abTest;

  const releaseError = await validateRelease(input.productId, input.releaseId);
  if (releaseError) return { ok: false, error: releaseError };

  const segmentId = input.segmentId ?? null;
  if (segmentId) {
    const segment = await getSegmentForProduct({
      workspaceId: input.workspaceId,
      productId: input.productId,
      segmentId,
    });
    if (!segment) {
      return { ok: false, error: "That segment does not belong to this product." };
    }
  }

  const audience = await getWinbackAudience({ ...input, segmentId });
  const inserted = await db
    .insert(winbackCampaigns)
    .values({
      workspaceId: input.workspaceId,
      productId: input.productId,
      name,
      description,
      releaseId: input.releaseId,
      segmentId,
      messageB: abTest.messageB,
      abTestPercent: abTest.percent,
      createdBy: input.actorUserId,
    })
    .returning({ id: winbackCampaigns.id });
  const campaign = inserted[0];
  if (!campaign) return { ok: false, error: "Could not create the campaign." };

  await replaceRecipients({
    campaignId: campaign.id,
    audience,
    abTestPercent: abTest.percent,
  });
  return { ok: true, campaignId: campaign.id, audience: audience.counts };
}

export async function updateCampaign(input: {
  workspaceId: string;
  productId: string;
  campaignId: string;
  name: string;
  description: string;
  releaseId: string | null;
  segmentId?: string | null;
  messageB?: string | null;
  abTestPercent?: number | null;
}): Promise<CreateCampaignResult> {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 160) {
    return { ok: false, error: "Use a campaign name between 2 and 160 characters." };
  }
  const description = campaignDescription(input.description);
  if (!description) return { ok: false, error: "Write the campaign message before saving." };
  if (description.length < 10) {
    return { ok: false, error: "Write at least a sentence for the campaign message." };
  }
  const abTest = resolveAbTest(input);
  if (!abTest.ok) return abTest;

  const existing = await db
    .select({ id: winbackCampaigns.id })
    .from(winbackCampaigns)
    .where(
      and(
        eq(winbackCampaigns.id, input.campaignId),
        eq(winbackCampaigns.productId, input.productId),
        eq(winbackCampaigns.workspaceId, input.workspaceId),
        eq(winbackCampaigns.approvalStatus, "draft"),
        eq(winbackCampaigns.sendStatus, "not_sent"),
      ),
    )
    .limit(1);
  if (!existing[0]) return { ok: false, error: "Only a draft campaign can be edited." };

  const releaseError = await validateRelease(input.productId, input.releaseId);
  if (releaseError) return { ok: false, error: releaseError };

  const segmentId = input.segmentId ?? null;
  if (segmentId) {
    const segment = await getSegmentForProduct({
      workspaceId: input.workspaceId,
      productId: input.productId,
      segmentId,
    });
    if (!segment) {
      return { ok: false, error: "That segment does not belong to this product." };
    }
  }

  await db
    .update(winbackCampaigns)
    .set({
      name,
      description,
      releaseId: input.releaseId,
      segmentId,
      messageB: abTest.messageB,
      abTestPercent: abTest.percent,
      updatedAt: new Date(),
    })
    .where(eq(winbackCampaigns.id, input.campaignId));

  const audience = await getWinbackAudience({ ...input, segmentId });
  await replaceRecipients({
    campaignId: input.campaignId,
    audience,
    abTestPercent: abTest.percent,
  });
  return { ok: true, campaignId: input.campaignId, audience: audience.counts };
}

async function campaignForProduct(input: {
  workspaceId: string;
  productId: string;
  campaignId: string;
}): Promise<WinbackCampaign | null> {
  const rows = await db
    .select()
    .from(winbackCampaigns)
    .where(
      and(
        eq(winbackCampaigns.id, input.campaignId),
        eq(winbackCampaigns.productId, input.productId),
        eq(winbackCampaigns.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function submitCampaign(input: {
  workspaceId: string;
  productId: string;
  campaignId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const campaign = await campaignForProduct(input);
  if (!campaign) return { ok: false, error: "Campaign not found." };
  if (campaign.approvalStatus !== "draft") {
    return { ok: false, error: "Only a draft can be submitted for approval." };
  }

  const countRows = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(winbackCampaignRecipients)
    .where(
      and(
        eq(winbackCampaignRecipients.campaignId, input.campaignId),
        eq(winbackCampaignRecipients.status, "pending"),
      ),
    );
  if ((countRows[0]?.value ?? 0) === 0) {
    return { ok: false, error: "This campaign has no eligible recipients." };
  }

  await db
    .update(winbackCampaigns)
    .set({ approvalStatus: "pending_approval", updatedAt: new Date() })
    .where(eq(winbackCampaigns.id, input.campaignId));
  return { ok: true };
}

export async function approveCampaign(input: {
  workspaceId: string;
  productId: string;
  campaignId: string;
  actorUserId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const campaign = await campaignForProduct(input);
  if (!campaign) return { ok: false, error: "Campaign not found." };
  if (campaign.approvalStatus !== "pending_approval") {
    return { ok: false, error: "Only a campaign awaiting approval can be approved." };
  }

  const sender = await getSenderIdentity(input.workspaceId);
  const problem = senderIdentityProblem(sender);
  if (problem) return { ok: false, error: problem };

  await db
    .update(winbackCampaigns)
    .set({
      approvalStatus: "approved",
      approvedBy: input.actorUserId,
      approvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(winbackCampaigns.id, input.campaignId));
  return { ok: true };
}

export async function rejectCampaign(input: {
  workspaceId: string;
  productId: string;
  campaignId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const updated = await db
    .update(winbackCampaigns)
    .set({ approvalStatus: "rejected", updatedAt: new Date() })
    .where(
      and(
        eq(winbackCampaigns.id, input.campaignId),
        eq(winbackCampaigns.productId, input.productId),
        eq(winbackCampaigns.workspaceId, input.workspaceId),
        eq(winbackCampaigns.approvalStatus, "pending_approval"),
      ),
    )
    .returning({ id: winbackCampaigns.id });
  return updated[0] ? { ok: true } : { ok: false, error: "Only a campaign awaiting approval can be rejected." };
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function preferenceTokenForRecipient(
  tx: Transaction,
  input: {
    productId: string;
    recipient: WinbackCampaignRecipient;
  },
): Promise<string | null> {
  if (!input.recipient.email || !input.recipient.emailNormalized) return null;
  const token = createPreferenceToken();
  const now = new Date();
  const rows = await tx
    .insert(subscribers)
    .values({
      productId: input.productId,
      email: input.recipient.email,
      emailNormalized: input.recipient.emailNormalized,
      status: "pending",
      source: "import",
      unsubscribeToken: token,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [subscribers.productId, subscribers.emailNormalized],
      set: {
        unsubscribeToken: sql`coalesce(${subscribers.unsubscribeToken}, ${token})`,
        updatedAt: now,
      },
    })
    .returning({ token: subscribers.unsubscribeToken });
  return rows[0]?.token ?? null;
}

export type SendCampaignPhase = "canary" | "remaining";

export type SendCampaignResult =
  | { ok: true; queued: number; excluded: number; phase: SendCampaignPhase }
  | { ok: false; error: string };

export async function sendCampaign(input: {
  workspaceId: string;
  productId: string;
  campaignId: string;
  canary?: boolean | undefined;
}): Promise<SendCampaignResult> {
  const campaign = await campaignForProduct(input);
  if (!campaign) return { ok: false, error: "Campaign not found." };
  if (campaign.stoppedAt) {
    return { ok: false, error: "This campaign was stopped and cannot send again." };
  }
  if (campaign.sendStatus === "paused") {
    return { ok: false, error: "Resume the campaign before sending." };
  }
  if (campaign.approvalStatus !== "approved") {
    return { ok: false, error: "Approve the campaign before sending." };
  }

  const canaryPhase = input.canary === true;
  if (canaryPhase) {
    if (campaign.sendStatus !== "not_sent" || campaign.canarySentAt !== null) {
      return { ok: false, error: "This campaign has already started or finished sending." };
    }
  } else {
    if (campaign.canarySentAt === null) {
      return {
        ok: false,
        error: "Send a small canary batch before the full audience.",
      };
    }
    if (campaign.sendStatus !== "sending") {
      return { ok: false, error: "This campaign has already started or finished sending." };
    }
    const pendingCanary = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(winbackCampaignRecipients)
      .where(
        and(
          eq(winbackCampaignRecipients.campaignId, input.campaignId),
          inArray(winbackCampaignRecipients.status, ["pending", "queued"]),
          lte(winbackCampaignRecipients.queuedAt, campaign.canarySentAt),
        ),
      );
    if ((pendingCanary[0]?.value ?? 0) > 0) {
      return {
        ok: false,
        error: "Wait for the canary batch to finish before sending the rest.",
      };
    }
  }

  if (campaign.releaseId) {
    const releaseRows = await db
      .select({ productId: releases.productId, status: releases.status })
      .from(releases)
      .where(eq(releases.id, campaign.releaseId))
      .limit(1);
    const release = releaseRows[0];
    if (
      !release ||
      release.productId !== input.productId ||
      release.status !== "published"
    ) {
      return {
        ok: false,
        error: "The linked release must be published before this campaign can send.",
      };
    }
  }

  const sender = await getSenderIdentity(input.workspaceId);
  const problem = senderIdentityProblem(sender);
  if (problem) return { ok: false, error: problem };

  const audience = await getWinbackAudience({
    workspaceId: input.workspaceId,
    productId: input.productId,
    excludeCampaignId: input.campaignId,
    segmentId: campaign.segmentId,
  });
  const eligible = new Set(audience.eligible.map((member) => member.customerAccountId));
  const exclusions = new Map(
    audience.excluded.map((member) => [member.customerAccountId, member.reason]),
  );

  const recipients = await db
    .select()
    .from(winbackCampaignRecipients)
    .where(eq(winbackCampaignRecipients.campaignId, input.campaignId))
    .orderBy(asc(winbackCampaignRecipients.createdAt));

  const pendingRecipients = recipients.filter((recipient) => recipient.status === "pending");
  const toProcess = canaryPhase
    ? pendingRecipients.slice(0, WINBACK_CANARY_SIZE)
    : pendingRecipients;
  if (toProcess.length === 0) {
    return { ok: false, error: "There are no pending recipients to send." };
  }

  let queued = 0;
  let excluded = 0;
  await db.transaction(async (tx) => {
    for (const recipient of toProcess) {
      if (recipient.status === "excluded" || recipient.status === "sent" || recipient.status === "bounced" || recipient.status === "failed") {
        continue;
      }

      const exclusion = exclusions.get(recipient.customerAccountId);
      if (!eligible.has(recipient.customerAccountId)) {
        await tx
          .update(winbackCampaignRecipients)
          .set({
            status: "excluded",
            exclusionReason: exclusion ?? "ineligible",
            updatedAt: new Date(),
          })
          .where(eq(winbackCampaignRecipients.id, recipient.id));
        excluded += 1;
        continue;
      }

      const token = await preferenceTokenForRecipient(tx, {
        productId: input.productId,
        recipient,
      });
      if (!token || !recipient.email || !recipient.emailNormalized) {
        await tx
          .update(winbackCampaignRecipients)
          .set({ status: "excluded", exclusionReason: "no_email", updatedAt: new Date() })
          .where(eq(winbackCampaignRecipients.id, recipient.id));
        excluded += 1;
        continue;
      }

      const delivery = await tx
        .insert(notificationDeliveries)
        .values({
          workspaceId: input.workspaceId,
          productId: input.productId,
          template: "winback_campaign",
          winbackRecipientId: recipient.id,
          recipientEmail: recipient.email,
          recipientEmailNormalized: recipient.emailNormalized,
          status: "pending",
          dedupeKey: `winback:${input.campaignId}:${recipient.customerAccountId}`,
        })
        .onConflictDoNothing()
        .returning({ id: notificationDeliveries.id });

      if (delivery[0]) {
        queued += 1;
        await tx
          .update(winbackCampaignRecipients)
          .set({ status: "queued", queuedAt: new Date(), updatedAt: new Date() })
          .where(eq(winbackCampaignRecipients.id, recipient.id));
      }
    }

    if (queued > 0) {
      const now = new Date();
      await tx
        .update(winbackCampaigns)
        .set({
          sendStatus: "sending",
          sentAt: campaign.sentAt ?? now,
          canarySentAt: canaryPhase ? now : campaign.canarySentAt,
          canaryRecipientCount: canaryPhase
            ? queued
            : campaign.canaryRecipientCount,
          updatedAt: now,
        })
        .where(
          and(
            eq(winbackCampaigns.id, input.campaignId),
            inArray(winbackCampaigns.sendStatus, ["not_sent", "sending"]),
            isNull(winbackCampaigns.stoppedAt),
          ),
        );
    }
  });

  if (queued === 0) {
    return { ok: false, error: "No eligible recipients were available to send." };
  }

  try {
    await enqueueJob({
      type: "deliver_notification",
      dedupeKey: `winback-campaign:${input.campaignId}:${canaryPhase ? "canary" : "remaining"}`,
      payload: { campaignId: input.campaignId },
    });
  } catch (error) {
    // The outbox is already durable. The global delivery worker will pick
    // the rows up even if the immediate wake-up could not be queued.
    console.error("[winback] delivery wake-up failed", error);
  }

  return { ok: true, queued, excluded, phase: canaryPhase ? "canary" : "remaining" };
}

export async function markRecipientReturned(input: {
  workspaceId: string;
  productId: string;
  campaignId: string;
  recipientId: string;
  basis: "inferred" | "confirmed";
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const campaign = await campaignForProduct(input);
  if (!campaign) return { ok: false, error: "Campaign not found." };

  const rows = await db
    .select({
      status: winbackCampaignRecipients.status,
      sentAt: winbackCampaignRecipients.sentAt,
    })
    .from(winbackCampaignRecipients)
    .where(
      and(
        eq(winbackCampaignRecipients.id, input.recipientId),
        eq(winbackCampaignRecipients.campaignId, input.campaignId),
      ),
    )
    .limit(1);
  const recipient = rows[0];
  if (!recipient) return { ok: false, error: "Recipient not found in this campaign." };
  if (recipient.status !== "sent" || !recipient.sentAt) {
    return {
      ok: false,
      error: "Only a recipient whose email was sent can be attributed.",
    };
  }

  const now = new Date();
  const cutoff = new Date(
    now.getTime() - WINBACK_ATTRIBUTION_DAYS * 24 * 60 * 60 * 1000,
  );
  if (recipient.sentAt < cutoff) {
    return {
      ok: false,
      error: `The ${WINBACK_ATTRIBUTION_DAYS}-day attribution window has closed.`,
    };
  }

  const updated = await db
    .update(winbackCampaignRecipients)
    .set({
      attributionBasis: input.basis,
      convertedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(winbackCampaignRecipients.id, input.recipientId),
        eq(winbackCampaignRecipients.campaignId, input.campaignId),
        eq(winbackCampaignRecipients.status, "sent"),
        gte(winbackCampaignRecipients.sentAt, cutoff),
      ),
    )
    .returning({ id: winbackCampaignRecipients.id });
  return updated[0]
    ? { ok: true }
    : {
        ok: false,
        error: "Only a recipient whose email was sent can be attributed.",
      };
}

const PAUSED_DEFER_UNTIL = new Date("9999-12-31T00:00:00.000Z");
const PAUSED_DELIVERY_NOTE = "Campaign paused.";

/**
 * Reversible hold for a campaign that has started sending. Pending deliveries
 * are deferred rather than deleted, so resuming reuses the same dedupe keys and
 * the same recipients. Stopping stays irreversible and separate.
 */
export async function pauseCampaign(input: {
  workspaceId: string;
  productId: string;
  campaignId: string;
  actorUserId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const campaign = await campaignForProduct(input);
  if (!campaign) return { ok: false, error: "Campaign not found." };
  if (campaign.stoppedAt) return { ok: false, error: "This campaign was stopped." };
  if (campaign.sendStatus !== "sending") {
    return {
      ok: false,
      error: "Only a campaign that is currently sending can be paused.",
    };
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(winbackCampaigns)
      .set({
        sendStatus: "paused",
        pausedAt: now,
        pausedBy: input.actorUserId,
        updatedAt: now,
      })
      .where(
        and(
          eq(winbackCampaigns.id, input.campaignId),
          eq(winbackCampaigns.sendStatus, "sending"),
          isNull(winbackCampaigns.stoppedAt),
        ),
      );

    const pending = await tx
      .select({ id: winbackCampaignRecipients.id })
      .from(winbackCampaignRecipients)
      .where(
        and(
          eq(winbackCampaignRecipients.campaignId, input.campaignId),
          inArray(winbackCampaignRecipients.status, ["pending", "queued"]),
        ),
      );
    if (pending.length === 0) return;

    await tx
      .update(notificationDeliveries)
      .set({
        status: "pending",
        deferUntil: PAUSED_DEFER_UNTIL,
        error: PAUSED_DELIVERY_NOTE,
        updatedAt: now,
      })
      .where(
        and(
          inArray(
            notificationDeliveries.winbackRecipientId,
            pending.map((recipient) => recipient.id),
          ),
          eq(notificationDeliveries.status, "pending"),
        ),
      );
  });
  return { ok: true };
}

export async function resumeCampaign(input: {
  workspaceId: string;
  productId: string;
  campaignId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const campaign = await campaignForProduct(input);
  if (!campaign) return { ok: false, error: "Campaign not found." };
  if (campaign.stoppedAt) return { ok: false, error: "This campaign was stopped." };
  if (campaign.sendStatus !== "paused") {
    return { ok: false, error: "This campaign is not paused." };
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(winbackCampaigns)
      .set({ sendStatus: "sending", pausedAt: null, pausedBy: null, updatedAt: now })
      .where(
        and(
          eq(winbackCampaigns.id, input.campaignId),
          eq(winbackCampaigns.sendStatus, "paused"),
          isNull(winbackCampaigns.stoppedAt),
        ),
      );

    const pending = await tx
      .select({ id: winbackCampaignRecipients.id })
      .from(winbackCampaignRecipients)
      .where(
        and(
          eq(winbackCampaignRecipients.campaignId, input.campaignId),
          inArray(winbackCampaignRecipients.status, ["pending", "queued"]),
        ),
      );
    if (pending.length === 0) return;

    await tx
      .update(notificationDeliveries)
      .set({ deferUntil: null, error: null, updatedAt: now })
      .where(
        and(
          inArray(
            notificationDeliveries.winbackRecipientId,
            pending.map((recipient) => recipient.id),
          ),
          eq(notificationDeliveries.status, "pending"),
          eq(notificationDeliveries.error, PAUSED_DELIVERY_NOTE),
        ),
      );
  });

  try {
    await enqueueJob({
      type: "deliver_notification",
      dedupeKey: `winback-campaign:${input.campaignId}:resume:${now.getTime()}`,
      payload: { campaignId: input.campaignId },
    });
  } catch (error) {
    console.error("[winback] resume wake-up failed", error);
  }
  return { ok: true };
}

export async function stopCampaign(input: {
  workspaceId: string;
  productId: string;
  campaignId: string;
  actorUserId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const campaign = await campaignForProduct(input);
  if (!campaign) return { ok: false, error: "Campaign not found." };
  if (campaign.stoppedAt) return { ok: true };
  if (campaign.sendStatus === "sent" || campaign.sendStatus === "partially_sent") {
    return { ok: false, error: "This campaign has already finished sending." };
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(winbackCampaigns)
      .set({
        stoppedAt: now,
        stoppedBy: input.actorUserId,
        sendStatus: "failed",
        pausedAt: null,
        pausedBy: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(winbackCampaigns.id, input.campaignId),
          isNull(winbackCampaigns.stoppedAt),
        ),
      );

    const pending = await tx
      .select({ id: winbackCampaignRecipients.id })
      .from(winbackCampaignRecipients)
      .where(
        and(
          eq(winbackCampaignRecipients.campaignId, input.campaignId),
          inArray(winbackCampaignRecipients.status, ["pending", "queued"]),
        ),
      );
    if (pending.length === 0) return;

    const recipientIds = pending.map((recipient) => recipient.id);
    await tx
      .update(winbackCampaignRecipients)
      .set({
        status: "excluded",
        exclusionReason: "campaign_stopped",
        updatedAt: now,
      })
      .where(inArray(winbackCampaignRecipients.id, recipientIds));
    await tx
      .update(notificationDeliveries)
      .set({ status: "skipped", error: "Campaign stopped.", updatedAt: now })
      .where(
        and(
          inArray(notificationDeliveries.winbackRecipientId, recipientIds),
          inArray(notificationDeliveries.status, ["pending"]),
        ),
      );
  });

  return { ok: true };
}

export type ImportCancellationsResult = {
  created: number;
  updated: number;
  skipped: number;
  total: number;
};

/**
 * Import cancellation events and make the account explicitly eligible.
 *
 * Ingestion is idempotent on (customer account, cancelled_at): replaying the
 * same export does not create a second cancellation or resend anything. A
 * customer who opted out keeps the opt-out timestamp; the import changes
 * eligibility, not consent.
 */
export async function importCancellations(input: {
  workspaceId: string;
  productId: string;
  rows: CancellationImportRow[];
}): Promise<ImportCancellationsResult> {
  let created = 0;
  let updated = 0;
  let skipped = 0;

  await db.transaction(async (tx) => {
    const reasons = await tx
      .select({ id: cancellationReasons.id, label: cancellationReasons.label })
      .from(cancellationReasons)
      .where(eq(cancellationReasons.workspaceId, input.workspaceId));
    const reasonByLabel = new Map(
      reasons.map((reason) => [reason.label.trim().toLowerCase(), reason.id]),
    );

    for (const row of input.rows) {
      let reasonId: string | null = null;
      if (row.reason) {
        const key = row.reason.trim().toLowerCase();
        reasonId = reasonByLabel.get(key) ?? null;
        if (!reasonId) {
          const inserted = await tx
            .insert(cancellationReasons)
            .values({
              workspaceId: input.workspaceId,
              label: row.reason,
              position: reasons.length,
            })
            .returning({ id: cancellationReasons.id });
          reasonId = inserted[0]?.id ?? null;
          if (reasonId) reasonByLabel.set(key, reasonId);
        }
      }

      const existing = await tx
        .select({
          id: customerAccounts.id,
          email: customerAccounts.email,
          name: customerAccounts.name,
        })
        .from(customerAccounts)
        .where(
          and(
            eq(customerAccounts.productId, input.productId),
            eq(customerAccounts.emailNormalized, row.emailNormalized),
          ),
        )
        .limit(1);

      let accountId = existing[0]?.id ?? null;
      if (accountId) {
        await tx
          .update(customerAccounts)
          .set({
            email: row.email,
            name: row.name ?? existing[0]?.name ?? null,
            status: "cancelled",
            winbackEligibility: "eligible",
            updatedAt: new Date(),
          })
          .where(eq(customerAccounts.id, accountId));
        updated += 1;
      } else {
        const inserted = await tx
          .insert(customerAccounts)
          .values({
            productId: input.productId,
            externalId: row.externalId,
            provider: "import",
            email: row.email,
            emailNormalized: row.emailNormalized,
            name: row.name,
            status: "cancelled",
            winbackEligibility: "eligible",
            lastSeenAt: row.cancelledAt,
          })
          .returning({ id: customerAccounts.id });
        accountId = inserted[0]?.id ?? null;
        if (accountId) created += 1;
      }

      if (!accountId) {
        skipped += 1;
        continue;
      }

      // A file without an explicit cancellation time must still be
      // idempotent: reuse the account's latest cancellation rather than
      // inventing a new timestamp on every replay.
      let cancelledAt = row.cancelledAt;
      if (!row.cancelledAtExplicit) {
        const latest = await tx
          .select({ cancelledAt: customerCancellations.cancelledAt })
          .from(customerCancellations)
          .where(eq(customerCancellations.customerAccountId, accountId))
          .orderBy(desc(customerCancellations.cancelledAt))
          .limit(1);
        if (latest[0]) cancelledAt = latest[0].cancelledAt;
      }

      const cancellation = await tx
        .insert(customerCancellations)
        .values({
          customerAccountId: accountId,
          cancellationReasonId: reasonId,
          cancelledAt,
          feedback: row.feedback,
        })
        .onConflictDoNothing()
        .returning({ id: customerCancellations.id });
      if (!cancellation[0]) skipped += 1;
    }
  });

  return { created, updated, skipped, total: input.rows.length };
}
