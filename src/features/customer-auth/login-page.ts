import "server-only";

import { and, asc, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { boards, products, workspaces } from "@/db/schema";
import { publicSurfaceEnabled } from "@/features/entitlements/entitlements";
import type { PlanId } from "@/features/entitlements/plans";
import { getEmailConfig } from "@/lib/env";

/**
 * Context for the public sign-in page.
 *
 * Sign-in is product-scoped in the URL so it can offer a link back to that
 * product's first public board. The workspace is still the identity boundary:
 * customer accounts are workspace-wide, not per product.
 */

export type PublicLoginPage = {
  workspace: { id: string; name: string; slug: string; plan: PlanId };
  product: { id: string; name: string; slug: string };
  board: { slug: string; name: string } | null;
  emailConfigured: boolean;
};

export async function getPublicLoginPage(input: {
  workspaceSlug: string;
  productSlug: string;
}): Promise<PublicLoginPage | null> {
  const rows = await db
    .select({
      workspace: {
        id: workspaces.id,
        name: workspaces.name,
        slug: workspaces.slug,
        plan: workspaces.plan,
      },
      product: {
        id: products.id,
        name: products.name,
        slug: products.slug,
      },
    })
    .from(products)
    .innerJoin(workspaces, eq(products.workspaceId, workspaces.id))
    .where(
      and(
        eq(workspaces.slug, input.workspaceSlug),
        eq(products.slug, input.productSlug),
        eq(products.publicFeedbackEnabled, true),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row || !publicSurfaceEnabled(row.workspace.plan)) return null;

  const boardRows = await db
    .select({ slug: boards.slug, name: boards.name })
    .from(boards)
    .where(
      and(
        eq(boards.productId, row.product.id),
        eq(boards.visibility, "public"),
        isNull(boards.archivedAt),
      ),
    )
    .orderBy(asc(boards.position), asc(boards.name))
    .limit(1);

  let emailConfigured = false;
  try {
    emailConfigured = getEmailConfig() !== null;
  } catch {
    emailConfigured = false;
  }

  return {
    ...row,
    board: boardRows[0] ?? null,
    emailConfigured,
  };
}
