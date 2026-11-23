import "server-only";

import { and, asc, count, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  customerCompanies,
  customerCompanyMemberships,
  customers,
  feedbackComments,
  feedbackCustomerVotes,
  feedbackInsights,
  feedbackPosts,
  feedbackVotes,
  releaseFeedbackLinks,
  releases,
  workspaces,
} from "@/db/schema";
import { getRequest } from "@/features/api-v1/service";

import { buildRequestBrief, type RequestBriefInput } from "./brief";

/**
 * Load everything a brief needs, scoped to one workspace (and optionally one
 * product).
 *
 * Tenant safety comes from `getRequest`, which resolves the row through
 * `products.workspace_id`; every follow-up query starts from that resolved post
 * id rather than from a caller-supplied id. Voter rows deliberately select only
 * a name and a company — never an email — so the builder has no contact detail
 * to render. Internal comments are filtered in SQL as well as in the builder.
 */
export async function loadRequestBrief(input: {
  workspaceId: string;
  requestId: string;
  productId?: string;
}): Promise<{ requestId: string; title: string; markdown: string } | null> {
  const found = await getRequest(input.workspaceId, input.requestId);
  if (!found) return null;
  if (input.productId && found.row.productId !== input.productId) return null;

  const row = found.row;

  const [voterRows, insightRows, commentRows, releaseRows, teamVotes, postRow, workspaceRow] =
    await Promise.all([
      db
        .select({
          id: feedbackCustomerVotes.id,
          customerId: feedbackCustomerVotes.customerId,
          name: customers.name,
        })
        .from(feedbackCustomerVotes)
        .innerJoin(
          customers,
          and(
            eq(customers.id, feedbackCustomerVotes.customerId),
            eq(customers.workspaceId, input.workspaceId),
          ),
        )
        .where(eq(feedbackCustomerVotes.feedbackPostId, row.id))
        .orderBy(asc(customers.name), asc(feedbackCustomerVotes.id)),
      db
        .select({
          quote: feedbackInsights.quote,
          source: feedbackInsights.source,
          authorLabel: feedbackInsights.authorLabel,
          occurredAt: feedbackInsights.occurredAt,
        })
        .from(feedbackInsights)
        .where(
          and(
            eq(feedbackInsights.feedbackPostId, row.id),
            eq(feedbackInsights.productId, row.productId),
          ),
        )
        .orderBy(asc(feedbackInsights.occurredAt), asc(feedbackInsights.createdAt)),
      db
        .select({
          body: feedbackComments.body,
          authorName: feedbackComments.authorName,
          authorType: feedbackComments.authorType,
          createdAt: feedbackComments.createdAt,
        })
        .from(feedbackComments)
        .where(
          and(
            eq(feedbackComments.feedbackPostId, row.id),
            eq(feedbackComments.productId, row.productId),
            eq(feedbackComments.internal, false),
          ),
        )
        .orderBy(asc(feedbackComments.createdAt)),
      db
        .select({
          title: releases.title,
          slug: releases.slug,
          status: releases.status,
          publishedAt: releases.publishedAt,
        })
        .from(releaseFeedbackLinks)
        .innerJoin(releases, eq(releases.id, releaseFeedbackLinks.releaseId))
        .where(
          and(
            eq(releaseFeedbackLinks.feedbackPostId, row.id),
            eq(releases.productId, row.productId),
          ),
        )
        .orderBy(asc(releases.publishedAt), asc(releases.title)),
      db
        .select({ value: count() })
        .from(feedbackVotes)
        .where(eq(feedbackVotes.feedbackPostId, row.id)),
      db
        .select({ importedVoteCount: feedbackPosts.importedVoteCount })
        .from(feedbackPosts)
        .where(eq(feedbackPosts.id, row.id))
        .limit(1),
      db
        .select({ slug: workspaces.slug })
        .from(workspaces)
        .where(eq(workspaces.id, input.workspaceId))
        .limit(1),
    ]);

  // A customer may belong to several companies; take the first by name so one
  // vote is never counted twice in the segment list.
  const customerIds = [...new Set(voterRows.map((voter) => voter.customerId))];
  const companyRows =
    customerIds.length === 0
      ? []
      : await db
          .select({
            customerId: customerCompanyMemberships.customerId,
            name: customerCompanies.name,
          })
          .from(customerCompanyMemberships)
          .innerJoin(
            customerCompanies,
            eq(customerCompanies.id, customerCompanyMemberships.companyId),
          )
          .where(
            and(
              eq(customerCompanyMemberships.workspaceId, input.workspaceId),
              inArray(customerCompanyMemberships.customerId, customerIds),
            ),
          )
          .orderBy(asc(customerCompanies.name));

  const companyByCustomer = new Map<string, string>();
  for (const company of companyRows) {
    if (!companyByCustomer.has(company.customerId)) {
      companyByCustomer.set(company.customerId, company.name);
    }
  }

  const briefInput: RequestBriefInput = {
    workspaceSlug: workspaceRow[0]?.slug ?? "",
    productName: row.productName,
    requestId: row.id,
    title: row.title,
    body: row.body,
    status: row.status,
    category: row.category,
    boardName: row.boardName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    voteCount: row.voteCount,
    teamVoteCount: teamVotes[0]?.value ?? 0,
    importedVoteCount: postRow[0]?.importedVoteCount ?? 0,
    voters: voterRows.map((voter) => ({
      id: voter.id,
      name: voter.name,
      company: companyByCustomer.get(voter.customerId) ?? null,
    })),
    insights: insightRows,
    comments: commentRows,
    tags: found.tags.map((tag) => tag.name),
    releases: releaseRows,
  };

  return {
    requestId: row.id,
    title: row.title,
    markdown: buildRequestBrief(briefInput),
  };
}
