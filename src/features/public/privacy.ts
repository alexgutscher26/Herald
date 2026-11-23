import "server-only";

import { eq, sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import {
  customerCompanyMemberships,
  feedbackComments,
  feedbackPosts,
} from "@/db/schema";

/**
 * Viewer-aware privacy predicates for public reads.
 *
 * Anonymous visitors and viewers without a session only ever match `public`.
 * A signed-in customer also matches their own `author` rows and `company` rows
 * whose author shares a current company membership with them. Membership is
 * joined live rather than copied onto the row, so leaving a company revokes
 * access immediately.
 */

export function postPrivacySql(viewerCustomerId: string | null): SQL {
  if (viewerCustomerId === null) {
    return sql`${feedbackPosts.privacy} = 'public'`;
  }

  return sql`(
    ${feedbackPosts.privacy} = 'public'
    OR (
      ${feedbackPosts.privacy} = 'author'
      AND ${feedbackPosts.authorCustomerId} = ${viewerCustomerId}
    )
    OR (
      ${feedbackPosts.privacy} = 'company'
      AND EXISTS (
        SELECT 1
        FROM customer_company_memberships viewer_membership
        INNER JOIN customer_company_memberships author_membership
          ON author_membership.company_id = viewer_membership.company_id
        WHERE viewer_membership.customer_id = ${viewerCustomerId}
          AND author_membership.customer_id = ${feedbackPosts.authorCustomerId}
      )
    )
  )`;
}

export function commentPrivacySql(viewerCustomerId: string | null): SQL {
  if (viewerCustomerId === null) {
    return sql`${feedbackComments.privacy} = 'public'`;
  }

  return sql`(
    ${feedbackComments.privacy} = 'public'
    OR (
      ${feedbackComments.privacy} = 'author'
      AND ${feedbackComments.authorCustomerId} = ${viewerCustomerId}
    )
    OR (
      ${feedbackComments.privacy} = 'company'
      AND EXISTS (
        SELECT 1
        FROM customer_company_memberships viewer_membership
        INNER JOIN customer_company_memberships author_membership
          ON author_membership.company_id = viewer_membership.company_id
        WHERE viewer_membership.customer_id = ${viewerCustomerId}
          AND author_membership.customer_id = ${feedbackComments.authorCustomerId}
      )
    )
  )`;
}

/** Whether a customer belongs to at least one company in this workspace. */
export async function hasCompanyMembership(customerId: string): Promise<boolean> {
  const rows = await db
    .select({ customerId: customerCompanyMemberships.customerId })
    .from(customerCompanyMemberships)
    .where(eq(customerCompanyMemberships.customerId, customerId))
    .limit(1);
  return rows.length > 0;
}
