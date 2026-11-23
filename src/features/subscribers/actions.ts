"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { recordWorkspaceAudit } from "@/features/data-controls/service";
import { SUPPRESSION_REASONS } from "@/features/email/suppression-csv";
import { suppressEmail } from "@/features/email/suppressions";
import { authorizeProductAction } from "@/features/live/action-auth";
import type { ActionResult } from "@/features/live/action-result";
import { authorizeWorkspaceAction } from "@/features/live/workspace-action-auth";

import { sendSubscriberConfirmation } from "./confirmation";
import {
  addSubscriber,
  eraseSubscriber,
  removeSuppressions,
  setSubscriberStatus,
  syncFollowersToSubscribers,
} from "./service";

const targetSchema = z.object({
  workspaceSlug: z.string().min(1),
  productSlug: z.string().min(1),
});

const emailSchema = z.string().trim().min(3).max(254);

function revalidate(workspaceSlug: string, productSlug: string): void {
  revalidatePath(`/app/${workspaceSlug}/${productSlug}`, "layout");
}

export async function addSubscriberAction(input: unknown): Promise<
  ActionResult<{
    subscriberId: string;
    requiresConfirmation: boolean;
    confirmationError: string | null;
  }>
> {
  const parsed = targetSchema
    .extend({ email: emailSchema, name: z.string().trim().max(120).optional() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Enter a valid email address." };

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "subscriber:write",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const result = await addSubscriber({
      productId: authorized.context.product.id,
      email: parsed.data.email,
      name: parsed.data.name ?? null,
      doubleOptIn: authorized.context.workspace.doubleOptIn,
    });
    if (!result.ok) return result;

    let confirmationError: string | null = null;
    if (result.requiresConfirmation) {
      const sent = await sendSubscriberConfirmation({
        workspaceId: authorized.context.workspace.id,
        productId: authorized.context.product.id,
        subscriberId: result.id,
      });
      if (!sent.ok) confirmationError = sent.error;
    }

    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return {
      ok: true,
      data: {
        subscriberId: result.id,
        requiresConfirmation: result.requiresConfirmation,
        confirmationError,
      },
    };
  } catch (error) {
    console.error("[subscribers] add failed", error);
    return { ok: false, error: "Could not add that subscriber. Please try again." };
  }
}

export async function setSubscriberStatusAction(
  input: unknown,
): Promise<ActionResult<{ subscriberId: string; status: "pending" | "active" | "unsubscribed" }>> {
  const parsed = targetSchema
    .extend({
      subscriberId: z.uuid(),
      status: z.enum(["pending", "active", "unsubscribed"]),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a valid subscription status." };

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "subscriber:write",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const updated = await setSubscriberStatus({
      productId: authorized.context.product.id,
      subscriberId: parsed.data.subscriberId,
      status: parsed.data.status,
    });
    if (!updated) return { ok: false, error: "That subscriber no longer exists." };

    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return {
      ok: true,
      data: { subscriberId: parsed.data.subscriberId, status: parsed.data.status },
    };
  } catch (error) {
    console.error("[subscribers] status failed", error);
    return { ok: false, error: "Could not update that subscriber. Please try again." };
  }
}

export async function syncFollowersAction(
  input: unknown,
): Promise<ActionResult<{ followers: number; created: number; linked: number }>> {
  const parsed = targetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That product is not valid." };

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "subscriber:write",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const result = await syncFollowersToSubscribers({
      workspaceId: authorized.context.workspace.id,
      productId: authorized.context.product.id,
    });
    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return { ok: true, data: result };
  } catch (error) {
    console.error("[subscribers] follower sync failed", error);
    return { ok: false, error: "Could not sync followers. Please try again." };
  }
}

export async function sendSubscriberConfirmationAction(input: unknown): Promise<
  ActionResult<{ sent: boolean; skipped: string | null }>
> {
  const parsed = targetSchema
    .extend({ subscriberId: z.uuid() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a valid subscriber." };

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "subscriber:write",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const result = await sendSubscriberConfirmation({
      workspaceId: authorized.context.workspace.id,
      productId: authorized.context.product.id,
      subscriberId: parsed.data.subscriberId,
    });
    if (!result.ok) return { ok: false, error: result.error };

    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return { ok: true, data: { sent: !result.skipped, skipped: result.skipped ?? null } };
  } catch (error) {
    console.error("[subscribers] confirmation failed", error);
    return { ok: false, error: "Could not send the confirmation email. Please try again." };
  }
}

/**
 * Erase a subscriber and the public customer linked to them. Owner-only,
 * matching the workspace-level customer erasure control.
 */
export async function eraseSubscriberAction(input: unknown): Promise<
  ActionResult<{ erased: true; customerErased: boolean }>
> {
  const parsed = z
    .object({ workspaceSlug: z.string().min(1), subscriberId: z.uuid() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a valid subscriber." };

  const authorized = await authorizeWorkspaceAction(
    parsed.data.workspaceSlug,
    "workspace:delete",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const result = await eraseSubscriber({
      workspaceId: authorized.context.workspace.id,
      subscriberId: parsed.data.subscriberId,
    });
    if (!result.erased) return { ok: false, error: "That subscriber no longer exists." };

    await recordWorkspaceAudit({
      workspaceId: authorized.context.workspace.id,
      actorUserId: authorized.context.user.id,
      action: "subscriber.data_erased",
      targetType: "subscriber",
      targetId: parsed.data.subscriberId,
      metadata: { customerErased: result.customerErased },
    });

    revalidatePath(`/app/${parsed.data.workspaceSlug}`, "layout");
    return { ok: true, data: { erased: true, customerErased: result.customerErased } };
  } catch (error) {
    console.error("[subscribers] erasure failed", error);
    return { ok: false, error: "Could not erase that subscriber. Please try again." };
  }
}

export async function suppressEmailAction(
  input: unknown,
): Promise<ActionResult<{ email: string }>> {
  const parsed = targetSchema
    .extend({
      email: emailSchema,
      note: z.string().trim().max(500).optional(),
      reason: z.enum(SUPPRESSION_REASONS).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Enter a valid email address." };

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "subscriber:write",
  );
  if ("error" in authorized) return authorized.error;

  try {
    await suppressEmail({
      workspaceId: authorized.context.workspace.id,
      email: parsed.data.email,
      reason: parsed.data.reason ?? "manual",
      note: parsed.data.note ?? null,
      createdBy: authorized.context.user.id,
    });
    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return { ok: true, data: { email: parsed.data.email } };
  } catch (error) {
    console.error("[subscribers] suppression failed", error);
    return { ok: false, error: "Could not suppress that address. Please try again." };
  }
}

export async function removeSuppressionsAction(
  input: unknown,
): Promise<ActionResult<{ removed: number }>> {
  const parsed = targetSchema
    .extend({ ids: z.array(z.uuid()).min(1).max(100) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose at least one address." };

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "subscriber:write",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const removed = await removeSuppressions({
      workspaceId: authorized.context.workspace.id,
      ids: parsed.data.ids,
    });
    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return { ok: true, data: { removed } };
  } catch (error) {
    console.error("[subscribers] unsuppress failed", error);
    return { ok: false, error: "Could not remove those suppressions. Please try again." };
  }
}
