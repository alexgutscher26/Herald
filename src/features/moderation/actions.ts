"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { authorizeProductAction } from "@/features/live/action-auth";
import type { ActionResult } from "@/features/live/action-result";

import { applyModerationAction, retryReviewChecks, setCustomerBan } from "./service";
import type { ModerationAction } from "./types";

/**
 * Moderation server actions.
 *
 * Each action authenticates, checks `moderation:manage`, and resolves the
 * review inside the authorized product. Revalidation covers the dashboard
 * queue and the product's public pages, so a decision is visible immediately
 * in both places.
 */

const banSchema = z.object({
  workspaceSlug: z.string().min(1),
  productSlug: z.string().min(1),
  customerId: z.uuid("That customer id is not valid."),
  banned: z.boolean(),
});

const decisionSchema = z.object({
  workspaceSlug: z.string().min(1),
  productSlug: z.string().min(1),
  reviewId: z.uuid("That review id is not valid."),
  action: z.enum(["approve", "publish", "keep", "keep_hidden", "delete"]),
});

function revalidateModeration(workspaceSlug: string, productSlug: string): void {
  revalidatePath(`/app/${workspaceSlug}/${productSlug}/moderation`);
  revalidatePath(`/p/${workspaceSlug}/${productSlug}`, "layout");
}

export async function moderateReviewAction(input: {
  workspaceSlug: string;
  productSlug: string;
  reviewId: string;
  action: ModerationAction;
}): Promise<ActionResult<{ status: "approved" | "rejected" | "deleted" }>> {
  const parsed = decisionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Choose a moderation action.",
    };
  }

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "moderation:manage",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const result = await applyModerationAction({
      reviewId: parsed.data.reviewId,
      productId: authorized.context.product.id,
      userId: authorized.context.user.id,
      action: parsed.data.action,
    });

    if (!result.ok) return result;

    revalidateModeration(
      parsed.data.workspaceSlug,
      parsed.data.productSlug,
    );
    return { ok: true, data: { status: result.status } };
  } catch (error) {
    console.error("[moderation] decision failed", error);
    return { ok: false, error: "Could not save that decision. Please try again." };
  }
}

export async function retryModerationChecksAction(input: {
  workspaceSlug: string;
  productSlug: string;
  reviewId: string;
}): Promise<ActionResult<{ reasons: string[]; checkedAt: string | null }>> {
  const parsed = z
    .object({
      workspaceSlug: z.string().min(1),
      productSlug: z.string().min(1),
      reviewId: z.uuid("That review id is not valid."),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "That review id is not valid." };
  }

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "moderation:manage",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const result = await retryReviewChecks({
      reviewId: parsed.data.reviewId,
      productId: authorized.context.product.id,
    });
    if (!result.ok) return result;

    revalidateModeration(
      parsed.data.workspaceSlug,
      parsed.data.productSlug,
    );
    return {
      ok: true,
      data: {
        reasons: result.reasons,
        checkedAt: result.checks.checkedAt ?? null,
      },
    };
  } catch (error) {
    console.error("[moderation] retry failed", error);
    return { ok: false, error: "Could not re-run the checks. Please try again." };
  }
}

export async function setCustomerBanAction(input: {
  workspaceSlug: string;
  productSlug: string;
  customerId: string;
  banned: boolean;
}): Promise<ActionResult<{ banned: boolean }>> {
  const parsed = banSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That customer id is not valid." };
  }

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "moderation:manage",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const result = await setCustomerBan({
      workspaceId: authorized.context.workspace.id,
      customerId: parsed.data.customerId,
      banned: parsed.data.banned,
    });
    if (!result.ok) return result;

    revalidateModeration(parsed.data.workspaceSlug, parsed.data.productSlug);
    return { ok: true, data: { banned: result.banned } };
  } catch (error) {
    console.error("[moderation] customer ban failed", error);
    return { ok: false, error: "Could not update that customer. Please try again." };
  }
}
