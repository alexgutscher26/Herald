import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { customFields, feedbackCustomFieldValues } from "@/db/schema/custom-fields";
import {
  customerCompanies,
  customerCompanyMemberships,
} from "@/db/schema/customers";
import {
  feedbackComments,
  feedbackCustomerVotes,
  feedbackFollowers,
} from "@/db/schema";
import {
  companyRevenue,
  computeSignals,
  distinctRequesters,
  sumKnownRevenue,
} from "@/features/feedback/prioritisation";
import type { CustomerRevenue, PrioritySignals } from "@/types";

/**
 * Hydrate the two computed parts of a request-list row: custom field values
 * and prioritisation signals.
 *
 * Both are derived from other tables, so they are loaded for a whole page in
 * a fixed number of queries rather than by a subquery per row. The definition
 * and formula live in the pure modules; this file only fetches their inputs.
 */

export type RequestRowForExtras = {
  id: string;
  productId: string;
  authorCustomerId: string | null;
  impact: number | null;
  businessValue: number | null;
  effort: number | null;
};

export type RequestExtras = {
  customFields: Record<string, string | number>;
  signals: PrioritySignals;
};

export async function hydrateRequestExtras(
  workspaceId: string,
  rows: readonly RequestRowForExtras[],
): Promise<Map<string, RequestExtras>> {
  const map = new Map<string, RequestExtras>();
  if (rows.length === 0) return map;

  const postIds = rows.map((row) => row.id);
  const productIds = [...new Set(rows.map((row) => row.productId))];

  const [fieldRows, valueRows, voteRows, commentRows, followerRows] = await Promise.all([
    db
      .select()
      .from(customFields)
      .where(inArray(customFields.productId, productIds))
      .orderBy(customFields.position),
    db
      .select({
        postId: feedbackCustomFieldValues.feedbackPostId,
        fieldId: feedbackCustomFieldValues.fieldId,
        textValue: feedbackCustomFieldValues.textValue,
        numberValue: feedbackCustomFieldValues.numberValue,
        dateValue: feedbackCustomFieldValues.dateValue,
      })
      .from(feedbackCustomFieldValues)
      .where(inArray(feedbackCustomFieldValues.feedbackPostId, postIds)),
    db
      .select({
        postId: feedbackCustomerVotes.feedbackPostId,
        customerId: feedbackCustomerVotes.customerId,
      })
      .from(feedbackCustomerVotes)
      .where(inArray(feedbackCustomerVotes.feedbackPostId, postIds)),
    db
      .select({
        postId: feedbackComments.feedbackPostId,
        customerId: feedbackComments.authorCustomerId,
      })
      .from(feedbackComments)
      .where(
        and(
          inArray(feedbackComments.feedbackPostId, postIds),
          eq(feedbackComments.internal, false),
        ),
      ),
    db
      .select({
        postId: feedbackFollowers.feedbackPostId,
        customerId: feedbackFollowers.customerId,
      })
      .from(feedbackFollowers)
      .where(inArray(feedbackFollowers.feedbackPostId, postIds)),
  ]);

  const fieldById = new Map(fieldRows.map((row) => [row.id, row]));
  const valuesByPost = new Map<string, Record<string, string | number>>();
  for (const row of valueRows) {
    const field = fieldById.get(row.fieldId);
    if (!field) continue;
    const value = row.numberValue ?? row.dateValue ?? row.textValue;
    if (value === null) continue;
    const entry = valuesByPost.get(row.postId) ?? {};
    entry[field.key] = value;
    valuesByPost.set(row.postId, entry);
  }

  const votesByPost = new Map<string, string[]>();
  for (const row of voteRows) {
    const list = votesByPost.get(row.postId) ?? [];
    list.push(row.customerId);
    votesByPost.set(row.postId, list);
  }
  const commentsByPost = new Map<string, (string | null)[]>();
  for (const row of commentRows) {
    const list = commentsByPost.get(row.postId) ?? [];
    list.push(row.customerId);
    commentsByPost.set(row.postId, list);
  }
  const followersByPost = new Map<string, string[]>();
  for (const row of followerRows) {
    const list = followersByPost.get(row.postId) ?? [];
    list.push(row.customerId);
    followersByPost.set(row.postId, list);
  }

  const requesterIds = new Set<string>();
  for (const row of rows) {
    if (row.authorCustomerId) requesterIds.add(row.authorCustomerId);
  }
  for (const ids of votesByPost.values()) for (const id of ids) requesterIds.add(id);
  for (const ids of commentsByPost.values()) {
    for (const id of ids) if (id) requesterIds.add(id);
  }
  for (const ids of followersByPost.values()) for (const id of ids) requesterIds.add(id);

  const revenueRows =
    requesterIds.size === 0
      ? []
      : await db
          .select({
            customerId: customerCompanyMemberships.customerId,
            companyId: customerCompanies.id,
            companyName: customerCompanies.name,
            traits: customerCompanies.traits,
            crmAnnualRevenueCents: customerCompanies.crmAnnualRevenueCents,
            crmOpenDealValueCents: customerCompanies.crmOpenDealValueCents,
          })
          .from(customerCompanyMemberships)
          .innerJoin(
            customerCompanies,
            eq(customerCompanyMemberships.companyId, customerCompanies.id),
          )
          .where(
            and(
              eq(customerCompanies.workspaceId, workspaceId),
              inArray(customerCompanyMemberships.customerId, [...requesterIds]),
            ),
          );

  const revenue: CustomerRevenue[] = revenueRows.flatMap((row) => {
    const values = companyRevenue({
      traits: row.traits,
      crmAnnualRevenueCents: row.crmAnnualRevenueCents,
      crmOpenDealValueCents: row.crmOpenDealValueCents,
    });
    return values.annualRevenue === null && values.openDealValue === null
      ? []
      : [
          {
            customerId: row.customerId,
            companyId: row.companyId,
            companyName: row.companyName,
            ...values,
          },
        ];
  });

  for (const row of rows) {
    const requesters = distinctRequesters({
      authorCustomerId: row.authorCustomerId,
      customerVoteIds: votesByPost.get(row.id) ?? [],
      commentCustomerIds: commentsByPost.get(row.id) ?? [],
      followerCustomerIds: followersByPost.get(row.id) ?? [],
    });

    const known = sumKnownRevenue(requesters, revenue);
    map.set(row.id, {
      customFields: valuesByPost.get(row.id) ?? {},
      signals: computeSignals({
        impact: row.impact,
        businessValue: row.businessValue,
        effort: row.effort,
        requesterCount: requesters.length,
        knownArr: known.annualRevenue,
        knownOpenDealValue: known.openDealValue,
        knownWeightBasis: known.weightBasis,
      }),
    });
  }

  return map;
}
