import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { releases } from "@/db/schema/releases";
import {
  cancellationReasons,
  customerAccounts,
  customerCancellations,
  releaseReasonLinks,
} from "@/db/schema/winback";
import { getWinbackAudience } from "@/features/winback/service";

import type { ReleaseWinbackPreview } from "./audience-types";

/**
 * Explain the win-back match for one release before it is published.
 *
 * Publishing never sends a campaign. This reads the same explicit data a
 * campaign would: cancellation reasons deliberately linked in the editor, the
 * cancelled customers who recorded one of those reasons, and the existing
 * audience rules for who is contactable right now. No text similarity, no
 * inferred intent.
 */
export async function loadReleaseWinbackPreview(input: {
  workspaceId: string;
  productId: string;
  releaseId: string;
}): Promise<ReleaseWinbackPreview> {
  const linked = await db
    .select({ reasonId: releaseReasonLinks.cancellationReasonId })
    .from(releaseReasonLinks)
    .innerJoin(
      cancellationReasons,
      and(
        eq(cancellationReasons.id, releaseReasonLinks.cancellationReasonId),
        eq(cancellationReasons.workspaceId, input.workspaceId),
      ),
    )
    .innerJoin(
      releases,
      and(
        eq(releases.id, releaseReasonLinks.releaseId),
        eq(releases.productId, input.productId),
      ),
    )
    .where(eq(releaseReasonLinks.releaseId, input.releaseId));
  const reasonIds = [...new Set(linked.map((row) => row.reasonId))];
  if (reasonIds.length === 0) {
    return { reasons: 0, matched: 0, eligible: 0 };
  }

  const matchedRows = await db
    .select({ accountId: customerAccounts.id })
    .from(customerAccounts)
    .innerJoin(
      customerCancellations,
      eq(customerCancellations.customerAccountId, customerAccounts.id),
    )
    .where(
      and(
        eq(customerAccounts.productId, input.productId),
        eq(customerAccounts.status, "cancelled"),
        inArray(customerCancellations.cancellationReasonId, reasonIds),
      ),
    );
  const matchedIds = new Set(matchedRows.map((row) => row.accountId));
  if (matchedIds.size === 0) {
    return { reasons: reasonIds.length, matched: 0, eligible: 0 };
  }

  const audience = await getWinbackAudience({
    workspaceId: input.workspaceId,
    productId: input.productId,
  });
  const eligible = audience.eligible.filter((member) =>
    matchedIds.has(member.customerAccountId),
  ).length;

  return { reasons: reasonIds.length, matched: matchedIds.size, eligible };
}
