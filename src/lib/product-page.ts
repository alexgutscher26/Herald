import "server-only";

import {
  requireProductContext,
  type ProductContext,
} from "@/lib/authz";
import type { Permission } from "@/lib/permissions";

/**
 * Resolve the repeated page preamble in one place.
 *
 * Dashboard pages that read `[workspaceSlug]/[productSlug]` all authenticate,
 * resolve membership and product, enforce the page permission and turn an
 * unknown tenant into a 404. Keeping that order in one helper means a page
 * cannot forget the permission or resolve the product before the membership.
 *
 * Extra route params (`feedbackId`, `releaseId`, …) stay in the caller; the
 * helper returns them untouched.
 */
export async function resolveProductPage<
  T extends { workspaceSlug: string; productSlug: string },
>(
  params: Promise<T>,
  permission: Permission,
): Promise<{
  params: T;
  workspaceSlug: string;
  productSlug: string;
  context: ProductContext;
}> {
  const resolved = await params;
  const context = await requireProductContext(
    resolved.workspaceSlug,
    resolved.productSlug,
    permission,
  );
  return {
    params: resolved,
    workspaceSlug: resolved.workspaceSlug,
    productSlug: resolved.productSlug,
    context,
  };
}
