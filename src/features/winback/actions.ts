"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { consumeRateLimit } from "@/features/customer-session/rate-limit";
import { recordWorkspaceAudit } from "@/features/data-controls/service";
import { sendWinbackCampaignTest } from "@/features/email/send";
import { checkWorkspaceFeature } from "@/features/entitlements/entitlements";
import { authorizeProductAction } from "@/features/live/action-auth";
import type { ActionResult } from "@/features/live/action-result";

import {
  approveCampaign,
  createCampaign,
  markRecipientReturned,
  pauseCampaign,
  rejectCampaign,
  resumeCampaign,
  sendCampaign,
  stopCampaign,
  submitCampaign,
  updateCampaign,
  type WinbackAudienceCounts,
} from "./service";
import { dismissSuggestion } from "./suggestions";

const targetSchema = z.object({
  workspaceSlug: z.string().min(1),
  productSlug: z.string().min(1),
});

const campaignFields = z.object({
  campaignId: z.uuid().optional(),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().min(10).max(5_000),
  releaseId: z.uuid().nullable().optional(),
  segmentId: z.uuid().nullable().optional(),
  messageB: z.string().trim().max(5_000).nullable().optional(),
  abTestPercent: z.number().int().min(0).max(100).optional(),
});

function revalidate(workspaceSlug: string, productSlug: string, campaignId?: string): void {
  revalidatePath(`/app/${workspaceSlug}/${productSlug}/winback`);
  if (campaignId) {
    revalidatePath(`/app/${workspaceSlug}/${productSlug}/winback/campaigns/${campaignId}`);
  }
}

async function featureAllowed(workspaceId: string): Promise<boolean> {
  const feature = await checkWorkspaceFeature(workspaceId, "winback");
  return feature.allowed;
}

export async function createCampaignAction(
  input: unknown,
): Promise<ActionResult<{ campaignId: string; audience: WinbackAudienceCounts }>> {
  const parsed = targetSchema
    .extend(campaignFields.shape)
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the campaign." };
  }

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "winback:manage",
  );
  if ("error" in authorized) return authorized.error;
  if (!(await featureAllowed(authorized.context.workspace.id))) {
    return { ok: false, error: "Win-back campaigns are not available on the current plan." };
  }

  const result = await createCampaign({
    workspaceId: authorized.context.workspace.id,
    productId: authorized.context.product.id,
    actorUserId: authorized.context.user.id,
    name: parsed.data.name,
    description: parsed.data.description,
    releaseId: parsed.data.releaseId ?? null,
    segmentId: parsed.data.segmentId ?? null,
    messageB: parsed.data.messageB ?? null,
    abTestPercent: parsed.data.abTestPercent ?? 0,
  });
  if (!result.ok) return result;

  revalidate(parsed.data.workspaceSlug, parsed.data.productSlug, result.campaignId);
  return {
    ok: true,
    data: { campaignId: result.campaignId, audience: result.audience },
  };
}

export async function updateCampaignAction(
  input: unknown,
): Promise<ActionResult<{ campaignId: string; audience: WinbackAudienceCounts }>> {
  const parsed = targetSchema
    .extend(campaignFields.shape)
    .extend({ campaignId: z.uuid() })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the campaign." };
  }

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "winback:manage",
  );
  if ("error" in authorized) return authorized.error;
  if (!(await featureAllowed(authorized.context.workspace.id))) {
    return { ok: false, error: "Win-back campaigns are not available on the current plan." };
  }

  const result = await updateCampaign({
    workspaceId: authorized.context.workspace.id,
    productId: authorized.context.product.id,
    campaignId: parsed.data.campaignId,
    name: parsed.data.name,
    description: parsed.data.description,
    releaseId: parsed.data.releaseId ?? null,
    segmentId: parsed.data.segmentId ?? null,
    messageB: parsed.data.messageB ?? null,
    abTestPercent: parsed.data.abTestPercent ?? 0,
  });
  if (!result.ok) return result;

  revalidate(parsed.data.workspaceSlug, parsed.data.productSlug, result.campaignId);
  return {
    ok: true,
    data: { campaignId: result.campaignId, audience: result.audience },
  };
}

async function campaignTransition(input: {
  data: { workspaceSlug: string; productSlug: string; campaignId: string };
  permission: "winback:manage" | "winback:approve";
}) {
  return authorizeProductAction(
    input.data.workspaceSlug,
    input.data.productSlug,
    input.permission,
  );
}

export async function submitCampaignAction(
  input: unknown,
): Promise<ActionResult<{ submitted: true }>> {
  const parsed = targetSchema
    .extend({ campaignId: z.uuid() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a valid campaign." };
  const authorized = await campaignTransition({
    data: parsed.data,
    permission: "winback:manage",
  });
  if ("error" in authorized) return authorized.error;
  if (!(await featureAllowed(authorized.context.workspace.id))) {
    return { ok: false, error: "Win-back campaigns are not available on the current plan." };
  }

  const result = await submitCampaign({
    workspaceId: authorized.context.workspace.id,
    productId: authorized.context.product.id,
    campaignId: parsed.data.campaignId,
  });
  if (!result.ok) return result;
  revalidate(parsed.data.workspaceSlug, parsed.data.productSlug, parsed.data.campaignId);
  return { ok: true, data: { submitted: true } };
}

export async function approveCampaignAction(
  input: unknown,
): Promise<ActionResult<{ approved: true }>> {
  const parsed = targetSchema
    .extend({ campaignId: z.uuid() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a valid campaign." };
  const authorized = await campaignTransition({
    data: parsed.data,
    permission: "winback:approve",
  });
  if ("error" in authorized) return authorized.error;
  if (!(await featureAllowed(authorized.context.workspace.id))) {
    return { ok: false, error: "Win-back campaigns are not available on the current plan." };
  }

  const result = await approveCampaign({
    workspaceId: authorized.context.workspace.id,
    productId: authorized.context.product.id,
    campaignId: parsed.data.campaignId,
    actorUserId: authorized.context.user.id,
  });
  if (!result.ok) return result;
  revalidate(parsed.data.workspaceSlug, parsed.data.productSlug, parsed.data.campaignId);
  return { ok: true, data: { approved: true } };
}

export async function rejectCampaignAction(
  input: unknown,
): Promise<ActionResult<{ rejected: true }>> {
  const parsed = targetSchema
    .extend({ campaignId: z.uuid() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a valid campaign." };
  const authorized = await campaignTransition({
    data: parsed.data,
    permission: "winback:approve",
  });
  if ("error" in authorized) return authorized.error;
  if (!(await featureAllowed(authorized.context.workspace.id))) {
    return { ok: false, error: "Win-back campaigns are not available on the current plan." };
  }

  const result = await rejectCampaign({
    workspaceId: authorized.context.workspace.id,
    productId: authorized.context.product.id,
    campaignId: parsed.data.campaignId,
  });
  if (!result.ok) return result;
  revalidate(parsed.data.workspaceSlug, parsed.data.productSlug, parsed.data.campaignId);
  return { ok: true, data: { rejected: true } };
}

export async function sendCampaignAction(
  input: unknown,
): Promise<ActionResult<{ queued: number; excluded: number; phase: "canary" | "remaining" }>> {
  const parsed = targetSchema
    .extend({ campaignId: z.uuid(), canary: z.boolean().optional() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a valid campaign." };
  const authorized = await campaignTransition({
    data: parsed.data,
    permission: "winback:manage",
  });
  if ("error" in authorized) return authorized.error;
  if (!(await featureAllowed(authorized.context.workspace.id))) {
    return { ok: false, error: "Win-back campaigns are not available on the current plan." };
  }

  const result = await sendCampaign({
    workspaceId: authorized.context.workspace.id,
    productId: authorized.context.product.id,
    campaignId: parsed.data.campaignId,
    canary: parsed.data.canary,
  });
  if (!result.ok) return result;
  revalidate(parsed.data.workspaceSlug, parsed.data.productSlug, parsed.data.campaignId);
  return {
    ok: true,
    data: { queued: result.queued, excluded: result.excluded, phase: result.phase },
  };
}

export async function stopCampaignAction(
  input: unknown,
): Promise<ActionResult<{ stopped: true }>> {
  const parsed = targetSchema
    .extend({ campaignId: z.uuid() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a valid campaign." };
  const authorized = await campaignTransition({
    data: parsed.data,
    permission: "winback:approve",
  });
  if ("error" in authorized) return authorized.error;
  if (!(await featureAllowed(authorized.context.workspace.id))) {
    return { ok: false, error: "Win-back campaigns are not available on the current plan." };
  }

  const result = await stopCampaign({
    workspaceId: authorized.context.workspace.id,
    productId: authorized.context.product.id,
    campaignId: parsed.data.campaignId,
    actorUserId: authorized.context.user.id,
  });
  if (!result.ok) return result;
  await recordWorkspaceAudit({
    workspaceId: authorized.context.workspace.id,
    actorUserId: authorized.context.user.id,
    action: "winback.campaign_stopped",
    targetType: "winback_campaign",
    targetId: parsed.data.campaignId,
  });
  revalidate(parsed.data.workspaceSlug, parsed.data.productSlug, parsed.data.campaignId);
  return { ok: true, data: { stopped: true } };
}

export async function pauseCampaignAction(
  input: unknown,
): Promise<ActionResult<{ paused: true }>> {
  const parsed = targetSchema
    .extend({ campaignId: z.uuid() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a valid campaign." };
  const authorized = await campaignTransition({
    data: parsed.data,
    permission: "winback:approve",
  });
  if ("error" in authorized) return authorized.error;
  if (!(await featureAllowed(authorized.context.workspace.id))) {
    return { ok: false, error: "Win-back campaigns are not available on the current plan." };
  }

  const result = await pauseCampaign({
    workspaceId: authorized.context.workspace.id,
    productId: authorized.context.product.id,
    campaignId: parsed.data.campaignId,
    actorUserId: authorized.context.user.id,
  });
  if (!result.ok) return result;
  await recordWorkspaceAudit({
    workspaceId: authorized.context.workspace.id,
    actorUserId: authorized.context.user.id,
    action: "winback.campaign_paused",
    targetType: "winback_campaign",
    targetId: parsed.data.campaignId,
  });
  revalidate(parsed.data.workspaceSlug, parsed.data.productSlug, parsed.data.campaignId);
  return { ok: true, data: { paused: true } };
}

export async function resumeCampaignAction(
  input: unknown,
): Promise<ActionResult<{ resumed: true }>> {
  const parsed = targetSchema
    .extend({ campaignId: z.uuid() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a valid campaign." };
  const authorized = await campaignTransition({
    data: parsed.data,
    permission: "winback:approve",
  });
  if ("error" in authorized) return authorized.error;
  if (!(await featureAllowed(authorized.context.workspace.id))) {
    return { ok: false, error: "Win-back campaigns are not available on the current plan." };
  }

  const result = await resumeCampaign({
    workspaceId: authorized.context.workspace.id,
    productId: authorized.context.product.id,
    campaignId: parsed.data.campaignId,
  });
  if (!result.ok) return result;
  await recordWorkspaceAudit({
    workspaceId: authorized.context.workspace.id,
    actorUserId: authorized.context.user.id,
    action: "winback.campaign_resumed",
    targetType: "winback_campaign",
    targetId: parsed.data.campaignId,
  });
  revalidate(parsed.data.workspaceSlug, parsed.data.productSlug, parsed.data.campaignId);
  return { ok: true, data: { resumed: true } };
}

export async function dismissSuggestionAction(
  input: unknown,
): Promise<ActionResult<{ dismissed: true }>> {
  const parsed = targetSchema
    .extend({ suggestionId: z.uuid() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a valid suggestion." };
  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "winback:manage",
  );
  if ("error" in authorized) return authorized.error;
  if (!(await featureAllowed(authorized.context.workspace.id))) {
    return { ok: false, error: "Win-back campaigns are not available on the current plan." };
  }

  const result = await dismissSuggestion({
    workspaceId: authorized.context.workspace.id,
    productId: authorized.context.product.id,
    suggestionId: parsed.data.suggestionId,
    actorUserId: authorized.context.user.id,
  });
  if (!result.ok) return result;
  revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
  return { ok: true, data: { dismissed: true } };
}

export async function sendCampaignTestAction(
  input: unknown,
): Promise<ActionResult<{ providerMessageId: string }>> {
  const parsed = targetSchema
    .extend({ campaignId: z.uuid(), to: z.string().trim().min(3).max(254) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Enter a valid test email address." };
  const authorized = await campaignTransition({
    data: parsed.data,
    permission: "winback:manage",
  });
  if ("error" in authorized) return authorized.error;
  if (!(await featureAllowed(authorized.context.workspace.id))) {
    return { ok: false, error: "Win-back campaigns are not available on the current plan." };
  }

  const limit = await consumeRateLimit({
    bucket: `winback-test:${authorized.context.user.id}`,
    limit: 5,
    windowSeconds: 60,
  });
  if (!limit.allowed) {
    return { ok: false, error: "Too many test sends. Please try again in a minute." };
  }

  try {
    const result = await sendWinbackCampaignTest({
      workspaceId: authorized.context.workspace.id,
      productId: authorized.context.product.id,
      campaignId: parsed.data.campaignId,
      to: parsed.data.to,
    });
    if (!result.ok) return { ok: false, error: result.error };

    await recordWorkspaceAudit({
      workspaceId: authorized.context.workspace.id,
      actorUserId: authorized.context.user.id,
      action: "winback.campaign_test_sent",
      targetType: "winback_campaign",
      targetId: parsed.data.campaignId,
    });
    return { ok: true, data: { providerMessageId: result.providerMessageId } };
  } catch (error) {
    console.error("[winback] test send failed", error);
    return { ok: false, error: "Could not send the test email. Please try again." };
  }
}

export async function markRecipientReturnedAction(
  input: unknown,
): Promise<ActionResult<{ returned: true }>> {
  const parsed = targetSchema
    .extend({
      campaignId: z.uuid(),
      recipientId: z.uuid(),
      basis: z.enum(["inferred", "confirmed"]),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a valid recipient." };
  const authorized = await campaignTransition({
    data: parsed.data,
    permission: "winback:manage",
  });
  if ("error" in authorized) return authorized.error;
  if (!(await featureAllowed(authorized.context.workspace.id))) {
    return { ok: false, error: "Win-back campaigns are not available on the current plan." };
  }

  const result = await markRecipientReturned({
    workspaceId: authorized.context.workspace.id,
    productId: authorized.context.product.id,
    campaignId: parsed.data.campaignId,
    recipientId: parsed.data.recipientId,
    basis: parsed.data.basis,
  });
  if (!result.ok) return result;
  revalidate(parsed.data.workspaceSlug, parsed.data.productSlug, parsed.data.campaignId);
  return { ok: true, data: { returned: true } };
}
