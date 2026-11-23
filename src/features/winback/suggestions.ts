import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { releases } from "@/db/schema/releases";
import {
  cancellationReasons,
  customerAccounts,
  customerCancellations,
  releaseReasonLinks,
  winbackCampaigns,
  winbackSuggestions,
} from "@/db/schema/winback";

import { getWinbackAudience } from "./service";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Record one suggestion for every cancellation reason a release was linked to.
 * Called inside the publish transaction, so a suggestion exists exactly when the
 * release becomes publishable. It is a prompt only: no campaign is created,
 * approved or queued here.
 */
export async function createReleaseSuggestions(
  tx: Transaction,
  input: { workspaceId: string; productId: string; releaseId: string },
): Promise<void> {
  const links = await tx
    .select({ reasonId: releaseReasonLinks.cancellationReasonId })
    .from(releaseReasonLinks)
    .where(eq(releaseReasonLinks.releaseId, input.releaseId));
  if (links.length === 0) return;

  await tx
    .insert(winbackSuggestions)
    .values(
      links.map((link) => ({
        workspaceId: input.workspaceId,
        productId: input.productId,
        releaseId: input.releaseId,
        cancellationReasonId: link.reasonId,
      })),
    )
    .onConflictDoNothing();
}

export type WinbackSuggestionView = {
  id: string;
  releaseId: string;
  releaseTitle: string;
  reasonId: string;
  reasonLabel: string;
  /** Cancelled customers with this reason who pass every send rule right now. */
  eligible: number;
  /** A campaign already pointing at this release, if one exists. */
  campaignId: string | null;
  createdAt: string;
};

export async function listWinbackSuggestions(input: {
  workspaceId: string;
  productId: string;
}): Promise<WinbackSuggestionView[]> {
  const rows = await db
    .select({
      id: winbackSuggestions.id,
      releaseId: winbackSuggestions.releaseId,
      releaseTitle: releases.title,
      reasonId: winbackSuggestions.cancellationReasonId,
      reasonLabel: cancellationReasons.label,
      createdAt: winbackSuggestions.createdAt,
    })
    .from(winbackSuggestions)
    .innerJoin(releases, eq(releases.id, winbackSuggestions.releaseId))
    .innerJoin(
      cancellationReasons,
      eq(cancellationReasons.id, winbackSuggestions.cancellationReasonId),
    )
    .where(
      and(
        eq(winbackSuggestions.workspaceId, input.workspaceId),
        eq(winbackSuggestions.productId, input.productId),
        eq(winbackSuggestions.status, "pending"),
      ),
    )
    .orderBy(desc(winbackSuggestions.createdAt))
    .limit(20);
  if (rows.length === 0) return [];

  const [audience, cancellationRows, campaignRows] = await Promise.all([
    getWinbackAudience(input),
    db
      .select({
        accountId: customerCancellations.customerAccountId,
        reasonId: customerCancellations.cancellationReasonId,
      })
      .from(customerCancellations)
      .innerJoin(
        customerAccounts,
        eq(customerAccounts.id, customerCancellations.customerAccountId),
      )
      .where(eq(customerAccounts.productId, input.productId)),
    db
      .select({ id: winbackCampaigns.id, releaseId: winbackCampaigns.releaseId })
      .from(winbackCampaigns)
      .where(eq(winbackCampaigns.productId, input.productId)),
  ]);

  const eligibleIds = new Set(
    audience.eligible.map((member) => member.customerAccountId),
  );
  const eligibleByReason = new Map<string, number>();
  for (const row of cancellationRows) {
    if (!row.reasonId || !eligibleIds.has(row.accountId)) continue;
    eligibleByReason.set(row.reasonId, (eligibleByReason.get(row.reasonId) ?? 0) + 1);
  }
  const campaignByRelease = new Map<string, string>();
  for (const campaign of campaignRows) {
    if (campaign.releaseId) campaignByRelease.set(campaign.releaseId, campaign.id);
  }

  return rows.map((row) => ({
    id: row.id,
    releaseId: row.releaseId,
    releaseTitle: row.releaseTitle,
    reasonId: row.reasonId,
    reasonLabel: row.reasonLabel,
    eligible: eligibleByReason.get(row.reasonId) ?? 0,
    campaignId: campaignByRelease.get(row.releaseId) ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function dismissSuggestion(input: {
  workspaceId: string;
  productId: string;
  suggestionId: string;
  actorUserId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const updated = await db
    .update(winbackSuggestions)
    .set({
      status: "dismissed",
      dismissedAt: new Date(),
      dismissedBy: input.actorUserId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(winbackSuggestions.id, input.suggestionId),
        eq(winbackSuggestions.workspaceId, input.workspaceId),
        eq(winbackSuggestions.productId, input.productId),
        eq(winbackSuggestions.status, "pending"),
      ),
    )
    .returning({ id: winbackSuggestions.id });
  return updated[0] ? { ok: true } : { ok: false, error: "That suggestion is no longer open." };
}
