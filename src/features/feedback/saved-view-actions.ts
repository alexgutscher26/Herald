"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { authorizeProductAction } from "@/features/live/action-auth";
import type { ActionResult } from "@/features/live/action-result";
import type { FeedbackSavedView } from "@/types";

import type {
  DeleteFeedbackViewInput,
  SaveFeedbackViewInput,
} from "./action-types";
import { normalizeViewFilters } from "./saved-view-filters";
import { deleteFeedbackView, saveFeedbackView } from "./saved-views";

/**
 * Saved inbox views.
 *
 * A view is private to its creator and scoped to the authorized product. The
 * unique (product, user, name) index makes saving an existing name an update,
 * so the button in the inbox behaves predictably instead of failing on a
 * duplicate.
 */

const baseSchema = z.object({
  workspaceSlug: z.string().min(1),
  productSlug: z.string().min(1),
});

const filtersSchema = z.object({
  search: z.string().trim().max(120).default(""),
  status: z
    .enum(["all", "new", "under_review", "planned", "in_progress", "shipped", "closed"])
    .default("all"),
  category: z
    .enum(["all", "feature_request", "bug", "improvement", "question"])
    .default("all"),
  sort: z
    .enum([
      "newest",
      "oldest",
      "votes",
      "priority",
      "impact",
      "value_effort",
      "requester_weight",
      "revenue",
    ])
    .default("newest"),
  customFieldSort: z
    .object({
      key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
      direction: z.enum(["asc", "desc"]),
    })
    .nullable()
    .optional(),
  customFields: z.record(z.string(), z.string()).optional(),
  minScore: z.number().int().min(1).max(100).nullable().optional(),
  segment: z
    .object({
      key: z.string().trim().min(1).max(64),
      value: z.string().trim().min(1).max(200),
    })
    .nullable()
    .optional(),
  assignee: z.string().trim().max(120).default("all"),
  stale: z
    .enum(["all", "no_reply_7d", "planned_stale_30d"])
    .default("all"),
});

function revalidate(workspaceSlug: string, productSlug: string): void {
  revalidatePath(`/app/${workspaceSlug}/${productSlug}`, "layout");
}

export async function saveFeedbackViewAction(
  input: SaveFeedbackViewInput,
): Promise<ActionResult<{ view: FeedbackSavedView }>> {
  const parsed = baseSchema
    .extend({
      name: z
        .string()
        .trim()
        .min(1, "Name this view.")
        .max(40, "Keep view names to 40 characters or fewer."),
      filters: filtersSchema,
    })
    .safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Check the view name and filters.",
    };
  }

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "feedback:read",
  );
  if ("error" in authorized) return authorized.error;
  const { product, user } = authorized.context;

  try {
    const view = await saveFeedbackView({
      productId: product.id,
      userId: user.id,
      name: parsed.data.name,
      filters: normalizeViewFilters(parsed.data.filters),
    });

    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return { ok: true, data: { view } };
  } catch (error) {
    console.error("[feedback] save view failed", error);
    return { ok: false, error: "Could not save that view. Please try again." };
  }
}

export async function deleteFeedbackViewAction(
  input: DeleteFeedbackViewInput,
): Promise<ActionResult<{ viewId: string }>> {
  const parsed = baseSchema
    .extend({ viewId: z.uuid("That saved view id is not valid.") })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "That saved view id is not valid." };

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "feedback:read",
  );
  if ("error" in authorized) return authorized.error;
  const { product, user } = authorized.context;

  try {
    const deleted = await deleteFeedbackView({
      productId: product.id,
      userId: user.id,
      viewId: parsed.data.viewId,
    });

    if (!deleted) return { ok: false, error: "That saved view no longer exists." };

    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return { ok: true, data: { viewId: parsed.data.viewId } };
  } catch (error) {
    console.error("[feedback] delete view failed", error);
    return { ok: false, error: "Could not delete that view. Please try again." };
  }
}
