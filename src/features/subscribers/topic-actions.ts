"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { authorizeProductAction } from "@/features/live/action-auth";
import type { ActionResult } from "@/features/live/action-result";

import {
  createSubscriptionTopic,
  deleteSubscriptionTopic,
  setSubscriptionTopicActive,
} from "./subscription-topics";
import { firstTopicIssue, topicFormSchema } from "./topics";

const targetSchema = z.object({
  workspaceSlug: z.string().min(1),
  productSlug: z.string().min(1),
});

function revalidate(workspaceSlug: string, productSlug: string): void {
  revalidatePath(`/app/${workspaceSlug}/${productSlug}/subscribers`);
}

export async function createTopicAction(
  input: unknown,
): Promise<ActionResult<{ topicId: string }>> {
  const parsed = targetSchema
    .extend({ form: topicFormSchema })
    .safeParse(input);
  if (!parsed.success) {
    const issue = firstTopicIssue(parsed.error);
    return { ok: false, error: issue.message, fieldErrors: issue.fieldErrors };
  }

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "subscriber:write",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const result = await createSubscriptionTopic({
      productId: authorized.context.product.id,
      form: parsed.data.form,
    });
    if (!result.ok) return result;

    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return { ok: true, data: { topicId: result.topic.id } };
  } catch (error) {
    console.error("[subscribers] topic create failed", error);
    return { ok: false, error: "Could not create that topic. Please try again." };
  }
}

export async function setTopicActiveAction(
  input: unknown,
): Promise<ActionResult<{ topicId: string; active: boolean }>> {
  const parsed = targetSchema
    .extend({ topicId: z.uuid(), active: z.boolean() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "That topic is not valid." };

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "subscriber:write",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const updated = await setSubscriptionTopicActive({
      productId: authorized.context.product.id,
      topicId: parsed.data.topicId,
      active: parsed.data.active,
    });
    if (!updated) return { ok: false, error: "That topic no longer exists." };

    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return {
      ok: true,
      data: { topicId: parsed.data.topicId, active: parsed.data.active },
    };
  } catch (error) {
    console.error("[subscribers] topic status failed", error);
    return { ok: false, error: "Could not update that topic. Please try again." };
  }
}

export async function deleteTopicAction(
  input: unknown,
): Promise<ActionResult<{ topicId: string }>> {
  const parsed = targetSchema.extend({ topicId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "That topic is not valid." };

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "subscriber:write",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const deleted = await deleteSubscriptionTopic({
      productId: authorized.context.product.id,
      topicId: parsed.data.topicId,
    });
    if (!deleted) {
      return { ok: false, error: "Built-in topics cannot be deleted." };
    }

    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return { ok: true, data: { topicId: parsed.data.topicId } };
  } catch (error) {
    console.error("[subscribers] topic delete failed", error);
    return { ok: false, error: "Could not delete that topic. Please try again." };
  }
}
