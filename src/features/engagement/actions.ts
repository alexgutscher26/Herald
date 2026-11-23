"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { authorizeProductAction } from "@/features/live/action-auth";

import {
  createExperience,
  createOutboundMessage,
  createSurvey,
  deleteExperience,
  deleteOutboundMessage,
  deleteSurvey,
  resetExperienceDismissals,
  scheduleDueOutboundMessages,
  setExperienceStatus,
  setOutboundFrequencyCaps,
  setOutboundStatus,
  setSurveyStatus,
  updateExperience,
  updateOutboundCadence,
} from "./service";
import { createExperiencePreviewToken } from "./preview";

const PERMISSION = "settings:manage" as const;

function text(form: FormData, key: string, max = 4000): string {
  return String(form.get(key) ?? "").trim().slice(0, max);
}

function dateOrNull(value: string): Date | null {
  if (!value) return null;
  // datetime-local has no zone; the outbound form labels these fields as UTC.
  const date = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function back(path: string, error?: string): never {
  const suffix = error ? `?error=${encodeURIComponent(error)}` : "?saved=1";
  redirect(`${path}${suffix}`);
}

async function authorize(workspaceSlug: string, productSlug: string) {
  const result = await authorizeProductAction(workspaceSlug, productSlug, PERMISSION);
  if ("error" in result) {
    back(`/app/${workspaceSlug}/${productSlug}`, result.error.error);
  }
  return result.context;
}

function revalidate(workspaceSlug: string, productSlug: string) {
  revalidatePath(`/app/${workspaceSlug}/${productSlug}`, "layout");
  revalidatePath(`/p/${workspaceSlug}/${productSlug}`, "layout");
}

export async function createSurveyAction(formData: FormData): Promise<void> {
  const workspaceSlug = text(formData, "workspaceSlug");
  const productSlug = text(formData, "productSlug");
  const context = await authorize(workspaceSlug, productSlug);
  const result = await createSurvey({
    workspaceId: context.workspace.id,
    productId: context.product.id,
    name: text(formData, "name", 160),
    slug: text(formData, "slug", 80) || undefined,
    kind:
      text(formData, "kind") === "csat"
        ? "csat"
        : text(formData, "kind") === "custom"
          ? "custom"
          : "nps",
    questions: text(formData, "questions", 20_000),
    audience: text(formData, "audience", 20_000),
    suppressDays: Number.parseInt(text(formData, "suppressDays"), 10) || 0,
    status: formData.get("active") === "on" ? "active" : "draft",
    createdBy: context.user.id,
  });
  if (!result.ok) back(`/app/${workspaceSlug}/${productSlug}/surveys`, result.error);
  revalidate(workspaceSlug, productSlug);
  redirect(`/app/${workspaceSlug}/${productSlug}/surveys/${result.surveyId}`);
}

export async function setSurveyStatusAction(formData: FormData): Promise<void> {
  const workspaceSlug = text(formData, "workspaceSlug");
  const productSlug = text(formData, "productSlug");
  const context = await authorize(workspaceSlug, productSlug);
  const status = text(formData, "status");
  const result = await setSurveyStatus(
    context.product.id,
    text(formData, "surveyId"),
    status === "active" || status === "paused" ? status : "draft",
  );
  revalidate(workspaceSlug, productSlug);
  back(
    `/app/${workspaceSlug}/${productSlug}/surveys/${text(formData, "surveyId")}`,
    result.ok ? undefined : result.error,
  );
}

export async function deleteSurveyAction(formData: FormData): Promise<void> {
  const workspaceSlug = text(formData, "workspaceSlug");
  const productSlug = text(formData, "productSlug");
  const context = await authorize(workspaceSlug, productSlug);
  const result = await deleteSurvey(context.product.id, text(formData, "surveyId"));
  revalidate(workspaceSlug, productSlug);
  back(`/app/${workspaceSlug}/${productSlug}/surveys`, result.ok ? undefined : result.error);
}

export async function createExperienceAction(formData: FormData): Promise<void> {
  const workspaceSlug = text(formData, "workspaceSlug");
  const productSlug = text(formData, "productSlug");
  const context = await authorize(workspaceSlug, productSlug);
  const result = await createExperience({
    workspaceId: context.workspace.id,
    productId: context.product.id,
    name: text(formData, "name", 160),
    kind: text(formData, "kind") === "tour" ? "tour" : "banner",
    content: text(formData, "content", 30_000),
    audience: text(formData, "audience", 20_000),
    defaultLocale: text(formData, "defaultLocale") || "en",
    dismissDays: Number.parseInt(text(formData, "dismissDays"), 10) || 0,
    scheduleStart: dateOrNull(text(formData, "scheduleStart")),
    scheduleEnd: dateOrNull(text(formData, "scheduleEnd")),
    frequencyCap: Number.parseInt(text(formData, "frequencyCap"), 10) || 0,
    frequencyWindowDays:
      Number.parseInt(text(formData, "frequencyWindowDays"), 10) || 7,
    status: formData.get("active") === "on" ? "active" : "draft",
    createdBy: context.user.id,
  });
  revalidate(workspaceSlug, productSlug);
  back(
    `/app/${workspaceSlug}/${productSlug}/experiences`,
    result.ok ? undefined : result.error,
  );
}

export async function updateExperienceAction(formData: FormData): Promise<void> {
  const workspaceSlug = text(formData, "workspaceSlug");
  const productSlug = text(formData, "productSlug");
  const context = await authorize(workspaceSlug, productSlug);
  const result = await updateExperience({
    productId: context.product.id,
    experienceId: text(formData, "experienceId"),
    name: text(formData, "name", 160),
    content: text(formData, "content", 30_000),
    audience: text(formData, "audience", 20_000),
    defaultLocale: text(formData, "defaultLocale") || "en",
    dismissDays: Number.parseInt(text(formData, "dismissDays"), 10) || 0,
    scheduleStart: dateOrNull(text(formData, "scheduleStart")),
    scheduleEnd: dateOrNull(text(formData, "scheduleEnd")),
    frequencyCap: Number.parseInt(text(formData, "frequencyCap"), 10) || 0,
    frequencyWindowDays:
      Number.parseInt(text(formData, "frequencyWindowDays"), 10) || 7,
  });
  revalidate(workspaceSlug, productSlug);
  back(
    `/app/${workspaceSlug}/${productSlug}/experiences`,
    result.ok ? undefined : result.error,
  );
}

export async function previewExperienceAction(formData: FormData): Promise<void> {
  const workspaceSlug = text(formData, "workspaceSlug");
  const productSlug = text(formData, "productSlug");
  const context = await authorize(workspaceSlug, productSlug);
  const preview = await createExperiencePreviewToken(
    context.product.id,
    text(formData, "experienceId"),
  );
  if (!preview) {
    back(
      `/app/${workspaceSlug}/${productSlug}/experiences`,
      "Could not create a preview link.",
    );
  }
  redirect(`/preview/experiences/${preview.token}`);
}

export async function setExperienceStatusAction(formData: FormData): Promise<void> {
  const workspaceSlug = text(formData, "workspaceSlug");
  const productSlug = text(formData, "productSlug");
  const context = await authorize(workspaceSlug, productSlug);
  const status = text(formData, "status");
  const result = await setExperienceStatus(
    context.product.id,
    text(formData, "experienceId"),
    status === "active" || status === "paused" ? status : "draft",
  );
  revalidate(workspaceSlug, productSlug);
  back(
    `/app/${workspaceSlug}/${productSlug}/experiences`,
    result.ok ? undefined : result.error,
  );
}

export async function deleteExperienceAction(formData: FormData): Promise<void> {
  const workspaceSlug = text(formData, "workspaceSlug");
  const productSlug = text(formData, "productSlug");
  const context = await authorize(workspaceSlug, productSlug);
  const result = await deleteExperience(
    context.product.id,
    text(formData, "experienceId"),
  );
  revalidate(workspaceSlug, productSlug);
  back(
    `/app/${workspaceSlug}/${productSlug}/experiences`,
    result.ok ? undefined : result.error,
  );
}

export async function resetExperienceDismissalsAction(formData: FormData): Promise<void> {
  const workspaceSlug = text(formData, "workspaceSlug");
  const productSlug = text(formData, "productSlug");
  const context = await authorize(workspaceSlug, productSlug);
  const result = await resetExperienceDismissals(
    context.product.id,
    text(formData, "experienceId"),
  );
  revalidate(workspaceSlug, productSlug);
  back(
    `/app/${workspaceSlug}/${productSlug}/experiences`,
    result.ok ? undefined : result.error,
  );
}

export async function createOutboundMessageAction(formData: FormData): Promise<void> {
  const workspaceSlug = text(formData, "workspaceSlug");
  const productSlug = text(formData, "productSlug");
  const context = await authorize(workspaceSlug, productSlug);
  const result = await createOutboundMessage({
    workspaceId: context.workspace.id,
    productId: context.product.id,
    name: text(formData, "name", 160),
    channel: text(formData, "channel") === "email" ? "email" : "in_app",
    title: text(formData, "title", 200),
    body: text(formData, "body", 4000),
    translations: {
      es: {
        title: text(formData, "translationTitleEs", 200),
        body: text(formData, "translationBodyEs", 4000),
        ctaLabel: text(formData, "translationCtaLabelEs", 80),
      },
    },
    ctaLabel: text(formData, "ctaLabel", 80),
    ctaUrl: text(formData, "ctaUrl", 2000),
    audience: text(formData, "audience", 20_000),
    segmentId: text(formData, "segmentId") || null,
    scheduleStart: dateOrNull(text(formData, "scheduleStart")),
    scheduleEnd: dateOrNull(text(formData, "scheduleEnd")),
    windowStart: text(formData, "windowStart") || "00:00",
    windowEnd: text(formData, "windowEnd") || "23:59",
    timezone: text(formData, "timezone") || "UTC",
    recurrence:
      text(formData, "recurrence") === "daily"
        ? "daily"
        : text(formData, "recurrence") === "weekly"
          ? "weekly"
          : "one_shot",
    status: formData.get("active") === "on" ? "scheduled" : "draft",
    createdBy: context.user.id,
  });
  if (!result.ok) {
    back(`/app/${workspaceSlug}/${productSlug}/outbound`, result.error);
  }
  revalidate(workspaceSlug, productSlug);
  redirect(`/app/${workspaceSlug}/${productSlug}/outbound/${result.messageId}`);
}

export async function updateOutboundCadenceAction(formData: FormData): Promise<void> {
  const workspaceSlug = text(formData, "workspaceSlug");
  const productSlug = text(formData, "productSlug");
  const messageId = text(formData, "messageId");
  const context = await authorize(workspaceSlug, productSlug);
  const result = await updateOutboundCadence({
    productId: context.product.id,
    messageId,
    channel: text(formData, "channel") === "email" ? "email" : "in_app",
    recurrence:
      text(formData, "recurrence") === "daily"
        ? "daily"
        : text(formData, "recurrence") === "weekly"
          ? "weekly"
          : "one_shot",
    windowStart: text(formData, "windowStart") || "00:00",
    windowEnd: text(formData, "windowEnd") || "23:59",
    timezone: text(formData, "timezone") || "UTC",
    scheduleStart: dateOrNull(text(formData, "scheduleStart")),
    scheduleEnd: dateOrNull(text(formData, "scheduleEnd")),
  });
  revalidate(workspaceSlug, productSlug);
  back(
    `/app/${workspaceSlug}/${productSlug}/outbound/${messageId}`,
    result.ok ? undefined : result.error,
  );
}

export async function setOutboundFrequencyCapsAction(formData: FormData): Promise<void> {
  const workspaceSlug = text(formData, "workspaceSlug");
  const productSlug = text(formData, "productSlug");
  const context = await authorize(workspaceSlug, productSlug);
  const result = await setOutboundFrequencyCaps({
    workspaceId: context.workspace.id,
    cap: Number(text(formData, "cap")) || 0,
    windowDays: Number(text(formData, "windowDays")) || 7,
  });
  revalidate(workspaceSlug, productSlug);
  back(
    `/app/${workspaceSlug}/${productSlug}/outbound`,
    result.ok ? undefined : result.error,
  );
}

export async function setOutboundStatusAction(formData: FormData): Promise<void> {
  const workspaceSlug = text(formData, "workspaceSlug");
  const productSlug = text(formData, "productSlug");
  const context = await authorize(workspaceSlug, productSlug);
  const status = text(formData, "status");
  const allowed =
    status === "active" ||
    status === "paused" ||
    status === "completed" ||
    status === "scheduled" ||
    status === "draft";
  const result = await setOutboundStatus(
    context.product.id,
    text(formData, "messageId"),
    allowed ? status : "draft",
  );
  if (result.ok && status === "active") {
    await scheduleDueOutboundMessages().catch(() => undefined);
  }
  revalidate(workspaceSlug, productSlug);
  back(`/app/${workspaceSlug}/${productSlug}/outbound`, result.ok ? undefined : result.error);
}

export async function deleteOutboundMessageAction(formData: FormData): Promise<void> {
  const workspaceSlug = text(formData, "workspaceSlug");
  const productSlug = text(formData, "productSlug");
  const context = await authorize(workspaceSlug, productSlug);
  const result = await deleteOutboundMessage(
    context.product.id,
    text(formData, "messageId"),
  );
  revalidate(workspaceSlug, productSlug);
  back(`/app/${workspaceSlug}/${productSlug}/outbound`, result.ok ? undefined : result.error);
}
