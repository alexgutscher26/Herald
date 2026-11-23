"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  ensureProductEmailSettings,
  saveProductEmailSettings,
} from "@/features/email/inbound";
import { requireProductContext } from "@/lib/authz";

import { assertSameOriginAction } from "@/features/live/action-origin";

import { normalizeSchedule } from "./schedule";
import { saveOperatorSettings } from "./service";

/**
 * Support settings actions.
 *
 * Both are gated by `settings:manage`, resolve the product/workspace from the
 * authenticated context (never from the form) and redirect back with a short
 * status. The forms are plain server-rendered HTML, so the settings page works
 * without a client bundle.
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

export async function saveInboundEmailAction(formData: FormData): Promise<void> {
  await assertSameOriginAction();
  const workspaceSlug = String(formData.get("workspaceSlug") ?? "");
  const productSlug = String(formData.get("productSlug") ?? "");
  const context = await requireProductContext(
    workspaceSlug,
    productSlug,
    "settings:manage",
  );

  await ensureProductEmailSettings(context.product.id);

  const result = await saveProductEmailSettings({
    productId: context.product.id,
    enabled: formData.get("enabled") === "on",
    displayName: String(formData.get("displayName") ?? ""),
    regenerate: formData.get("regenerate") === "on",
  });

  if (!result.ok) return back(workspaceSlug, productSlug, { error: result.error });

  revalidatePath(settingsPath(workspaceSlug, productSlug));
  return back(workspaceSlug, productSlug, { saved: "email" });
}

export async function saveOperatorAction(formData: FormData): Promise<void> {
  await assertSameOriginAction();
  const workspaceSlug = String(formData.get("workspaceSlug") ?? "");
  const productSlug = String(formData.get("productSlug") ?? "");
  const context = await requireProductContext(
    workspaceSlug,
    productSlug,
    "settings:manage",
  );

  const userId = String(formData.get("userId") ?? "");
  const timezone = String(formData.get("timezone") ?? "").trim();
  const useSchedule = formData.get("useSchedule") === "on";
  const start = String(formData.get("start") ?? "09:00");
  const end = String(formData.get("end") ?? "17:00");
  const days = formData
    .getAll("days")
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6);

  let schedule: unknown = null;
  if (useSchedule) {
    const parsed = normalizeSchedule([{ days, start, end }]);
    if (!parsed.ok) return back(workspaceSlug, productSlug, { error: parsed.error });
    schedule = parsed.schedule;
  }

  const result = await saveOperatorSettings({
    workspaceId: context.workspace.id,
    userId,
    timezone,
    schedule,
    availableWhileUsing: formData.get("availableWhileUsing") === "on",
    appearOffline: formData.get("appearOffline") === "on",
    notifyEmail: formData.get("notifyEmail") === "on",
    notifyInApp: formData.get("notifyInApp") === "on",
    notifyNewConversations: formData.get("notifyNewConversations") === "on",
    notifyReplies: formData.get("notifyReplies") === "on",
    awayReplyEnabled: formData.get("awayReplyEnabled") === "on",
    awayReplyBody: String(formData.get("awayReplyBody") ?? ""),
  });

  if (!result.ok) return back(workspaceSlug, productSlug, { error: result.error });

  revalidatePath(settingsPath(workspaceSlug, productSlug));
  return back(workspaceSlug, productSlug, { saved: "operator" });
}
