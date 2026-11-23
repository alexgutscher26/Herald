"use server";

import { authorizeProductAction } from "@/features/live/action-auth";
import type { ActionResult } from "@/features/live/action-result";

import { loadRequestBrief } from "./brief-service";

/**
 * Build one request brief for the dashboard.
 *
 * The product context is the authorization boundary: a member of product A
 * cannot ask for a brief from product B in the same workspace, even though both
 * live under one account.
 */
export async function getRequestBriefAction(input: {
  workspaceSlug: string;
  productSlug: string;
  postId: string;
}): Promise<ActionResult<{ title: string; markdown: string }>> {
  const authorized = await authorizeProductAction(
    input.workspaceSlug,
    input.productSlug,
    "feedback:read",
  );
  if ("error" in authorized) return authorized.error;
  const { workspace, product } = authorized.context;

  const brief = await loadRequestBrief({
    workspaceId: workspace.id,
    productId: product.id,
    requestId: input.postId,
  });
  if (!brief) return { ok: false, error: "That feedback request no longer exists." };

  return { ok: true, data: { title: brief.title, markdown: brief.markdown } };
}
