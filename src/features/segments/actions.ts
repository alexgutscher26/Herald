"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { authorizeProductAction } from "@/features/live/action-auth";
import type { ActionResult } from "@/features/live/action-result";

import { createSegment, deleteSegment } from "./service";

const targetSchema = z.object({
  workspaceSlug: z.string().min(1),
  productSlug: z.string().min(1),
});

export async function createSegmentAction(input: {
  workspaceSlug: string;
  productSlug: string;
  name: string;
  description: string;
  rules: unknown;
}): Promise<ActionResult<{ segmentId: string }>> {
  const parsed = targetSchema
    .extend({
      name: z.string().trim().min(2).max(120),
      description: z.string().trim().max(500),
      rules: z.unknown(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Name the segment and add a rule." };

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "settings:manage",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const result = await createSegment({
      workspaceId: authorized.context.workspace.id,
      productId: authorized.context.product.id,
      name: parsed.data.name,
      description: parsed.data.description,
      rules: parsed.data.rules,
      createdBy: authorized.context.user.id,
    });
    if (!result.ok) return result;

    revalidatePath(
      `/app/${parsed.data.workspaceSlug}/${parsed.data.productSlug}/segments`,
    );
    revalidatePath(
      `/app/${parsed.data.workspaceSlug}/${parsed.data.productSlug}/outbound`,
    );
    revalidatePath(`/app/${parsed.data.workspaceSlug}/${parsed.data.productSlug}/winback`);
    return { ok: true, data: { segmentId: result.segmentId } };
  } catch (error) {
    console.error("[segments] create failed", error);
    return { ok: false, error: "Could not save the segment. Please try again." };
  }
}

export async function deleteSegmentAction(input: {
  workspaceSlug: string;
  productSlug: string;
  segmentId: string;
}): Promise<ActionResult<{ deleted: true }>> {
  const parsed = targetSchema.extend({ segmentId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a valid segment." };

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "settings:manage",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const deleted = await deleteSegment({
      workspaceId: authorized.context.workspace.id,
      productId: authorized.context.product.id,
      segmentId: parsed.data.segmentId,
    });
    if (!deleted.ok) return deleted;

    revalidatePath(
      `/app/${parsed.data.workspaceSlug}/${parsed.data.productSlug}/segments`,
    );
    revalidatePath(
      `/app/${parsed.data.workspaceSlug}/${parsed.data.productSlug}/outbound`,
    );
    revalidatePath(`/app/${parsed.data.workspaceSlug}/${parsed.data.productSlug}/winback`);
    return { ok: true, data: { deleted: true } };
  } catch (error) {
    console.error("[segments] delete failed", error);
    return { ok: false, error: "Could not delete the segment. Please try again." };
  }
}
