import "server-only";

import { db } from "@/db";
import { boards, products } from "@/db/schema";
import { checkWorkspaceLimit } from "@/features/entitlements/entitlements";
import { planDefinition } from "@/features/entitlements/plans";
import { billingSettingsPath } from "@/features/billing/links";
import { isUniqueViolation } from "@/lib/error-message";

/**
 * Product creation for an already-authorized workspace.
 *
 * The plan allowance is checked here, not in the form: the Free plan includes
 * one product, Indie five and Professional unlimited, and a hand-crafted request
 * must hit the same gate as the button. A product and its default `feedback`
 * board are written in one transaction, because a product without a board has
 * no public feedback home and breaks the "one default board per product"
 * invariant the backfill reconciler enforces.
 *
 * Authorization is the caller's job: `createProductAction` resolves the
 * workspace through `requireWorkspaceContext` with `product:create` first.
 */

export type CreatedProduct = {
  id: string;
  name: string;
  slug: string;
};

export type CreateProductResult =
  | { ok: true; product: CreatedProduct }
  | {
      ok: false;
      error: string;
      billingUrl?: string;
      fieldErrors?: Record<string, string[]>;
    };

const SLUG_CONFLICT = "That product URL is already used in this workspace.";

export async function createProductForWorkspace(input: {
  workspaceId: string;
  workspaceSlug: string;
  name: string;
  slug: string;
}): Promise<CreateProductResult> {
  const allowance = await checkWorkspaceLimit(input.workspaceId, "products");
  if (!allowance.allowed) {
    const plan = planDefinition(allowance.plan);
    const limit = allowance.limit ?? 0;
    return {
      ok: false,
      error: `The ${plan.name} plan allows ${limit} product${limit === 1 ? "" : "s"}. Upgrade to add another.`,
      billingUrl: billingSettingsPath(input.workspaceSlug),
    };
  }

  try {
    const created = await db.transaction(async (tx) => {
      const rows = await tx
        .insert(products)
        .values({
          workspaceId: input.workspaceId,
          name: input.name,
          slug: input.slug,
        })
        .returning({ id: products.id, name: products.name, slug: products.slug });

      const product = rows[0];
      if (!product) throw new Error("Product insert returned no row.");

      await tx.insert(boards).values({
        productId: product.id,
        name: "Feedback",
        slug: "feedback",
        position: 0,
      });

      return product;
    });

    return { ok: true, product: created };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: SLUG_CONFLICT, fieldErrors: { slug: [SLUG_CONFLICT] } };
    }
    console.error("[products] create failed", error);
    return { ok: false, error: "Could not create the product. Please try again." };
  }
}
