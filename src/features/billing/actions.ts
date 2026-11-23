"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { recordWorkspaceAudit } from "@/features/data-controls/service";
import type { ActionResult } from "@/features/live/action-result";
import { authorizeWorkspaceAction } from "@/features/live/workspace-action-auth";

import { startLifetimeCheckout } from "./lifetime";
import {
  changePlan,
  extendWorkspaceTrial,
  previewPlanChange,
  recordBillingChurnFeedback,
  startBillingPortal,
  startCheckout,
  type PlanChangePreview,
} from "./service";

const intervalSchema = z.enum(["monthly", "annual"]).default("monthly");

const checkoutSchema = z.object({
  workspaceSlug: z.string().min(1),
  plan: z.enum(["starter", "pro"]),
  interval: intervalSchema,
});

export async function startCheckoutAction(input: {
  workspaceSlug: string;
  plan: "starter" | "pro";
  interval?: "monthly" | "annual";
}): Promise<ActionResult<{ url: string }>> {
  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a paid plan." };

  const authorized = await authorizeWorkspaceAction(
    parsed.data.workspaceSlug,
    "workspace:update",
  );
  if ("error" in authorized) return authorized.error;
  if (authorized.context.role !== "owner") {
    return { ok: false, error: "Only a workspace owner can start a subscription." };
  }

  const { context } = authorized;
  if (!context.user.email) {
    return { ok: false, error: "Your account needs an email address for billing." };
  }

  const result = await startCheckout({
    workspaceId: context.workspace.id,
    workspaceSlug: context.workspace.slug,
    workspaceName: context.workspace.name,
    email: context.user.email,
    plan: parsed.data.plan,
    interval: parsed.data.interval,
  });
  if (!result.ok) return result;

  return { ok: true, data: { url: result.url } };
}

export async function startLifetimeCheckoutAction(input: {
  workspaceSlug: string;
}): Promise<ActionResult<{ url: string }>> {
  const parsed = z.object({ workspaceSlug: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the workspace." };

  const authorized = await authorizeWorkspaceAction(
    parsed.data.workspaceSlug,
    "workspace:update",
  );
  if ("error" in authorized) return authorized.error;

  const { context } = authorized;
  if (context.role !== "owner") {
    return { ok: false, error: "Only the workspace owner can buy Founding Lifetime." };
  }
  if (!context.user.email) {
    return { ok: false, error: "Your account needs an email address for billing." };
  }

  const result = await startLifetimeCheckout({
    workspaceId: context.workspace.id,
    workspaceSlug: context.workspace.slug,
    workspaceName: context.workspace.name,
    purchaserUserId: context.user.id,
    email: context.user.email,
  });
  if (!result.ok) return result;

  return { ok: true, data: { url: result.url } };
}

export async function openBillingPortalAction(input: {
  workspaceSlug: string;
}): Promise<ActionResult<{ url: string }>> {
  const parsed = z.object({ workspaceSlug: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the workspace." };

  const authorized = await authorizeWorkspaceAction(
    parsed.data.workspaceSlug,
    "workspace:update",
  );
  if ("error" in authorized) return authorized.error;
  if (authorized.context.role !== "owner") {
    return { ok: false, error: "Only a workspace owner can manage billing." };
  }

  const result = await startBillingPortal({
    workspaceId: authorized.context.workspace.id,
    workspaceSlug: authorized.context.workspace.slug,
  });
  if (!result.ok) return result;

  return { ok: true, data: { url: result.url } };
}

const planChangeSchema = z.object({
  workspaceSlug: z.string().min(1),
  plan: z.enum(["starter", "pro"]),
  interval: intervalSchema,
});

export async function previewPlanChangeAction(input: {
  workspaceSlug: string;
  plan: "starter" | "pro";
  interval?: "monthly" | "annual";
}): Promise<ActionResult<{ preview: PlanChangePreview }>> {
  const parsed = planChangeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a plan and billing period." };

  const authorized = await authorizeWorkspaceAction(
    parsed.data.workspaceSlug,
    "workspace:update",
  );
  if ("error" in authorized) return authorized.error;
  if (authorized.context.role !== "owner") {
    return { ok: false, error: "Only a workspace owner can change the plan." };
  }

  const result = await previewPlanChange({
    workspaceId: authorized.context.workspace.id,
    plan: parsed.data.plan,
    interval: parsed.data.interval,
  });
  if (!result.ok) return result;
  return { ok: true, data: { preview: result.preview } };
}

export async function changePlanAction(input: {
  workspaceSlug: string;
  plan: "starter" | "pro";
  interval?: "monthly" | "annual";
}): Promise<ActionResult<{ plan: "starter" | "pro"; interval: "monthly" | "annual" }>> {
  const parsed = planChangeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a plan and billing period." };

  const authorized = await authorizeWorkspaceAction(
    parsed.data.workspaceSlug,
    "workspace:update",
  );
  if ("error" in authorized) return authorized.error;
  if (authorized.context.role !== "owner") {
    return { ok: false, error: "Only a workspace owner can change the plan." };
  }

  const result = await changePlan({
    workspaceId: authorized.context.workspace.id,
    plan: parsed.data.plan,
    interval: parsed.data.interval,
  });
  if (!result.ok) return result;

  await recordWorkspaceAudit({
    workspaceId: authorized.context.workspace.id,
    actorUserId: authorized.context.user.id,
    action: "billing.plan_change_requested",
    targetType: "workspace",
    targetId: authorized.context.workspace.id,
    metadata: { plan: result.plan, interval: result.interval },
  });
  revalidatePath(`/app/${encodeURIComponent(parsed.data.workspaceSlug)}/settings`);
  return { ok: true, data: { plan: result.plan, interval: result.interval } };
}

export async function extendTrialAction(input: {
  workspaceSlug: string;
  days?: number;
}): Promise<ActionResult<{ trialEndsAt: string }>> {
  const parsed = z
    .object({
      workspaceSlug: z.string().min(1),
      days: z.number().int().min(1).max(30).default(7),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose between 1 and 30 days." };

  const authorized = await authorizeWorkspaceAction(
    parsed.data.workspaceSlug,
    "workspace:update",
  );
  if ("error" in authorized) return authorized.error;
  if (authorized.context.role !== "owner") {
    return { ok: false, error: "Only a workspace owner can extend a trial." };
  }

  const result = await extendWorkspaceTrial({
    workspaceId: authorized.context.workspace.id,
    days: parsed.data.days,
  });
  if (!result.ok) return result;

  await recordWorkspaceAudit({
    workspaceId: authorized.context.workspace.id,
    actorUserId: authorized.context.user.id,
    action: "billing.trial_extended",
    targetType: "workspace",
    targetId: authorized.context.workspace.id,
    metadata: {
      days: parsed.data.days,
      previousTrialEndsAt: result.previousTrialEndsAt,
      trialEndsAt: result.trialEndsAt,
    },
  });
  revalidatePath(`/app/${encodeURIComponent(parsed.data.workspaceSlug)}/settings`);
  return { ok: true, data: { trialEndsAt: result.trialEndsAt } };
}

const feedbackSchema = z.object({
  workspaceSlug: z.string().min(1),
  kind: z.enum(["cancellation", "refund"]).default("cancellation"),
  reason: z.string().trim().min(1, "Choose a reason.").max(300),
  details: z.string().trim().max(2_000).optional(),
  contactConsent: z.boolean().default(false),
});

export async function recordBillingFeedbackAction(input: {
  workspaceSlug: string;
  kind?: "cancellation" | "refund";
  reason: string;
  details?: string;
  contactConsent?: boolean;
}): Promise<ActionResult<{ id: string }>> {
  const parsed = feedbackSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the feedback." };
  }

  const authorized = await authorizeWorkspaceAction(
    parsed.data.workspaceSlug,
    "workspace:update",
  );
  if ("error" in authorized) return authorized.error;
  if (authorized.context.role !== "owner") {
    return { ok: false, error: "Only a workspace owner can submit billing feedback." };
  }

  const result = await recordBillingChurnFeedback({
    workspaceId: authorized.context.workspace.id,
    userId: authorized.context.user.id,
    kind: parsed.data.kind,
    reason: parsed.data.reason,
    details: parsed.data.details ?? null,
    contactConsent: parsed.data.contactConsent,
  });
  if (!result.ok) return result;

  await recordWorkspaceAudit({
    workspaceId: authorized.context.workspace.id,
    actorUserId: authorized.context.user.id,
    action: "billing.feedback_recorded",
    targetType: "workspace",
    targetId: authorized.context.workspace.id,
    metadata: {
      kind: parsed.data.kind,
      reason: parsed.data.reason,
      contactConsent: parsed.data.contactConsent,
    },
  });
  return { ok: true, data: { id: result.id } };
}
