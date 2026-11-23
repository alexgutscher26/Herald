"use server";

import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { feedbackPosts } from "@/db/schema/feedback";
import { authorizeProductAction } from "@/features/live/action-auth";
import type { ActionResult } from "@/features/live/action-result";

import { loadReleaseAudiencePreview } from "./audience";
import type {
  ReleaseAudiencePreview,
  ReleaseWinbackPreview,
} from "./audience-types";
import { loadReleaseWinbackPreview } from "./winback-preview";

const inputSchema = z.object({
  workspaceSlug: z.string().min(1),
  productSlug: z.string().min(1),
  linkedFeedbackIds: z.array(z.uuid()).max(200).default([]),
  tagSlugs: z.array(z.string().trim().min(1).max(80)).max(8).default([]),
  emailEnabled: z.boolean(),
});

/**
 * Preview the release email audience without writing anything.
 *
 * Linked request ids are validated against the authorized product before they
 * are used to explain the audience, so a guessed id cannot disclose another
 * product's followers.
 */
export async function previewReleaseAudienceAction(input: {
  workspaceSlug: string;
  productSlug: string;
  linkedFeedbackIds: string[];
  tagSlugs: string[];
  emailEnabled: boolean;
}): Promise<ActionResult<ReleaseAudiencePreview>> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Could not build the audience preview." };
  }
  const value = parsed.data;

  const authorized = await authorizeProductAction(
    value.workspaceSlug,
    value.productSlug,
    "release:read",
  );
  if ("error" in authorized) return authorized.error;
  const { product, workspace } = authorized.context;

  try {
    const linkedIds = [...new Set(value.linkedFeedbackIds)];
    if (linkedIds.length > 0) {
      const rows = await db
        .select({ id: feedbackPosts.id })
        .from(feedbackPosts)
        .where(
          and(
            eq(feedbackPosts.productId, product.id),
            inArray(feedbackPosts.id, linkedIds),
          ),
        );
      if (rows.length !== linkedIds.length) {
        return { ok: false, error: "A linked feedback request does not belong to this product." };
      }
    }

    const preview = await loadReleaseAudiencePreview({
      workspaceId: workspace.id,
      productId: product.id,
      linkedFeedbackIds: linkedIds,
      tagSlugs: [...new Set(value.tagSlugs)],
      emailEnabled: value.emailEnabled,
    });
    return { ok: true, data: preview };
  } catch (error) {
    console.error("[releases] audience preview failed", error);
    return { ok: false, error: "Could not build the audience preview." };
  }
}

const winbackInputSchema = z.object({
  workspaceSlug: z.string().min(1),
  productSlug: z.string().min(1),
  releaseId: z.uuid(),
});

/**
 * Explain the win-back match for a release in the publish review.
 *
 * Read-only: it reports the reasons linked in the editor, the cancelled
 * customers who recorded them and how many are contactable. Publishing never
 * sends a campaign; this only makes the existing match visible at the moment
 * somebody decides to publish.
 */
export async function previewReleaseWinbackAction(input: {
  workspaceSlug: string;
  productSlug: string;
  releaseId: string;
}): Promise<ActionResult<ReleaseWinbackPreview>> {
  const parsed = winbackInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Could not check the win-back match." };

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "release:read",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const preview = await loadReleaseWinbackPreview({
      workspaceId: authorized.context.workspace.id,
      productId: authorized.context.product.id,
      releaseId: parsed.data.releaseId,
    });
    return { ok: true, data: preview };
  } catch (error) {
    console.error("[releases] win-back preview failed", error);
    return { ok: false, error: "Could not check the win-back match." };
  }
}
