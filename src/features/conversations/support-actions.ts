"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireProductContext } from "@/lib/authz";

import { assertSameOriginAction } from "@/features/live/action-origin";

import {
  archiveIntakeQuestion,
  createIntakeQuestion,
  saveCsatSetting,
  saveSlaSetting,
} from "./support-settings";

/**
 * Support configuration actions.
 *
 * Every action re-checks `settings:manage` and resolves the product from the
 * authenticated context, never from the form. These are plain server actions so
 * the settings screen works without a client bundle.
 */

function settingsPath(workspaceSlug: string, productSlug: string): string {
  return `/app/${workspaceSlug}/${productSlug}/settings`;
}

function back(
  workspaceSlug: string,
  productSlug: string,
  params: { saved?: string; error?: string },
): never {
  const query = new URLSearchParams();
  if (params.saved) query.set("saved", params.saved);
  if (params.error) query.set("error", params.error);
  const suffix = query.toString();
  redirect(`${settingsPath(workspaceSlug, productSlug)}${suffix ? `?${suffix}` : ""}`);
}

export async function saveCsatAction(formData: FormData): Promise<void> {
  await assertSameOriginAction();
  const workspaceSlug = String(formData.get("workspaceSlug") ?? "");
  const productSlug = String(formData.get("productSlug") ?? "");
  const context = await requireProductContext(
    workspaceSlug,
    productSlug,
    "settings:manage",
  );

  await saveCsatSetting({
    productId: context.product.id,
    enabled: formData.get("csatEnabled") === "on",
  });

  revalidatePath(settingsPath(workspaceSlug, productSlug));
  return back(workspaceSlug, productSlug, { saved: "csat" });
}

export async function saveSlaAction(formData: FormData): Promise<void> {
  await assertSameOriginAction();
  const workspaceSlug = String(formData.get("workspaceSlug") ?? "");
  const productSlug = String(formData.get("productSlug") ?? "");
  const context = await requireProductContext(
    workspaceSlug,
    productSlug,
    "settings:manage",
  );

  const useBusinessHours = formData.get("useBusinessHours") === "on";
  const days = formData
    .getAll("slaDay")
    .map((day) => Number(day))
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  const start = String(formData.get("slaStart") ?? "09:00");
  const end = String(formData.get("slaEnd") ?? "17:00");

  const result = await saveSlaSetting({
    productId: context.product.id,
    enabled: formData.get("slaEnabled") === "on",
    firstResponseMinutes: Number(formData.get("slaFirstResponseMinutes") ?? 240),
    timezone: String(formData.get("slaTimezone") ?? "UTC").trim(),
    businessHours: useBusinessHours ? [{ days, start, end }] : null,
  });

  if (!result.ok) {
    return back(workspaceSlug, productSlug, { error: result.error });
  }

  revalidatePath(settingsPath(workspaceSlug, productSlug));
  return back(workspaceSlug, productSlug, { saved: "sla" });
}

export async function createIntakeQuestionAction(formData: FormData): Promise<void> {
  await assertSameOriginAction();
  const workspaceSlug = String(formData.get("workspaceSlug") ?? "");
  const productSlug = String(formData.get("productSlug") ?? "");
  const context = await requireProductContext(
    workspaceSlug,
    productSlug,
    "settings:manage",
  );

  const channelValue = String(formData.get("channel") ?? "widget");
  const channel =
    channelValue === "board" ? "board" : channelValue === "widget" ? "widget" : null;
  if (!channel) {
    return back(workspaceSlug, productSlug, {
      error: "Choose the widget or a board for this question.",
    });
  }

  const kindValue = String(formData.get("kind") ?? "text");
  const kind = kindValue === "select" ? "select" : "text";
  const options = String(formData.get("options") ?? "")
    .split(/[\n,]/)
    .map((option) => option.trim())
    .filter((option) => option !== "");

  const result = await createIntakeQuestion({
    productId: context.product.id,
    channel,
    boardId: channel === "board" ? String(formData.get("boardId") ?? "") || null : null,
    key: String(formData.get("key") ?? ""),
    label: String(formData.get("label") ?? ""),
    kind,
    options,
  });

  if (!result.ok) {
    return back(workspaceSlug, productSlug, { error: result.error });
  }

  revalidatePath(settingsPath(workspaceSlug, productSlug));
  return back(workspaceSlug, productSlug, { saved: "intake" });
}

export async function archiveIntakeQuestionAction(formData: FormData): Promise<void> {
  await assertSameOriginAction();
  const workspaceSlug = String(formData.get("workspaceSlug") ?? "");
  const productSlug = String(formData.get("productSlug") ?? "");
  const context = await requireProductContext(
    workspaceSlug,
    productSlug,
    "settings:manage",
  );

  const result = await archiveIntakeQuestion({
    productId: context.product.id,
    questionId: String(formData.get("questionId") ?? ""),
  });

  if (!result.ok) {
    return back(workspaceSlug, productSlug, { error: result.error });
  }

  revalidatePath(settingsPath(workspaceSlug, productSlug));
  return back(workspaceSlug, productSlug, { saved: "intake" });
}
