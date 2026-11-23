"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireProductContext } from "@/lib/authz";

import { assertSameOriginAction } from "@/features/live/action-origin";

import {
  createConversationMacro,
  deleteConversationMacro,
  isMacroStatus,
} from "./macros";

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

export async function createConversationMacroAction(formData: FormData): Promise<void> {
  await assertSameOriginAction();
  const workspaceSlug = String(formData.get("workspaceSlug") ?? "");
  const productSlug = String(formData.get("productSlug") ?? "");
  const context = await requireProductContext(
    workspaceSlug,
    productSlug,
    "settings:manage",
  );

  const statusValue = String(formData.get("status") ?? "");
  const result = await createConversationMacro({
    productId: context.product.id,
    workspaceId: context.workspace.id,
    name: String(formData.get("name") ?? ""),
    replyBody: String(formData.get("replyBody") ?? ""),
    tagName: String(formData.get("tagName") ?? ""),
    status: isMacroStatus(statusValue) ? statusValue : null,
    assigneeId: String(formData.get("assigneeId") ?? "") || null,
  });

  if (!result.ok) {
    return back(workspaceSlug, productSlug, { error: result.error });
  }
  revalidatePath(settingsPath(workspaceSlug, productSlug));
  return back(workspaceSlug, productSlug, { saved: "macro" });
}

export async function deleteConversationMacroAction(formData: FormData): Promise<void> {
  await assertSameOriginAction();
  const workspaceSlug = String(formData.get("workspaceSlug") ?? "");
  const productSlug = String(formData.get("productSlug") ?? "");
  const context = await requireProductContext(
    workspaceSlug,
    productSlug,
    "settings:manage",
  );

  await deleteConversationMacro({
    productId: context.product.id,
    macroId: String(formData.get("macroId") ?? ""),
  });
  revalidatePath(settingsPath(workspaceSlug, productSlug));
  return back(workspaceSlug, productSlug, { saved: "macro" });
}
