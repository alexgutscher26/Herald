"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { authorizeProductAction } from "@/features/live/action-auth";

import { getSlackChannel } from "./client";
import {
  disconnectSlack,
  getSlackIntegration,
  saveSlackChannel,
} from "./service";

const targetSchema = z.object({
  workspaceSlug: z.string().min(1),
  productSlug: z.string().min(1),
  channel: z.string().min(3).max(400),
});

function pagePath(workspaceSlug: string, productSlug: string, query: string): string {
  return `/app/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(
    productSlug,
  )}/integrations?${query}`;
}

function failurePath(formData: FormData, error: string): string {
  const workspaceSlug = String(formData.get("workspaceSlug") ?? "");
  const productSlug = String(formData.get("productSlug") ?? "");
  return pagePath(workspaceSlug, productSlug, `error=${encodeURIComponent(error)}`);
}

export async function saveSlackChannelAction(formData: FormData): Promise<void> {
  const parsed = targetSchema.safeParse({
    workspaceSlug: formData.get("workspaceSlug"),
    productSlug: formData.get("productSlug"),
    channel: formData.get("channel"),
  });
  if (!parsed.success) redirect(failurePath(formData, "Choose a Slack channel."));

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "settings:manage",
  );
  if ("error" in authorized) redirect(failurePath(formData, authorized.error.error));

  const integration = await getSlackIntegration(authorized.context.product.id);
  if (!integration || !integration.active) {
    redirect(failurePath(formData, "Connect Slack before choosing a channel."));
  }

  const [channelId, encodedName] = parsed.data.channel.split(":", 2);
  if (!channelId) redirect(failurePath(formData, "Choose a Slack channel."));

  let channelName = encodedName ? decodeURIComponent(encodedName) : channelId;
  try {
    const channel = await getSlackChannel(integration.accessToken, channelId);
    channelName = channel.name;
  } catch {
    redirect(failurePath(formData, "That channel is not visible to the Slack app."));
  }

  const saved = await saveSlackChannel({
    productId: authorized.context.product.id,
    channelId,
    channelName,
  });
  if (!saved.ok) redirect(failurePath(formData, saved.error));

  revalidatePath(
    `/app/${parsed.data.workspaceSlug}/${parsed.data.productSlug}/integrations`,
  );
  redirect(
    pagePath(parsed.data.workspaceSlug, parsed.data.productSlug, "slack=channel_saved"),
  );
}

export async function disconnectSlackAction(formData: FormData): Promise<void> {
  const workspaceSlug = String(formData.get("workspaceSlug") ?? "");
  const productSlug = String(formData.get("productSlug") ?? "");
  const authorized = await authorizeProductAction(
    workspaceSlug,
    productSlug,
    "settings:manage",
  );
  if ("error" in authorized) redirect(failurePath(formData, authorized.error.error));

  await disconnectSlack(authorized.context.product.id);
  revalidatePath(`/app/${workspaceSlug}/${productSlug}/integrations`);
  redirect(pagePath(workspaceSlug, productSlug, "slack=disconnected"));
}
