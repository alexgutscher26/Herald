"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { authorizeProductAction } from "@/features/live/action-auth";
import type { ActionResult } from "@/features/live/action-result";

import { createTag, deleteTag, replacePostTags } from "./tags";

/**
 * Manual tag actions.
 *
 * Authorization and revalidation live here; the database rules live in
 * `tags.ts`, which is also what the integration tests exercise directly.
 */

const baseSchema = z.object({
  workspaceSlug: z.string().min(1),
  productSlug: z.string().min(1),
});

const nameSchema = z
  .string()
  .trim()
  .min(1, "Enter a tag name.")
  .max(32, "Keep tag names to 32 characters or fewer.");

const colorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex colour, for example #4f46e5.")
  .nullable();

function revalidate(workspaceSlug: string, productSlug: string) {
  revalidatePath(`/app/${workspaceSlug}/${productSlug}`, "layout");
  revalidatePath(`/p/${workspaceSlug}/${productSlug}`, "layout");
}

export async function createBoardTagAction(input: {
  workspaceSlug: string;
  productSlug: string;
  boardId: string;
  name: string;
  color: string | null;
}): Promise<ActionResult<{ tagId: string }>> {
  const parsed = baseSchema
    .extend({
      boardId: z.uuid("That board id is not valid."),
      name: nameSchema,
      color: colorSchema,
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Enter a tag." };
  }

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "feedback:write",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const result = await createTag({
      productId: authorized.context.product.id,
      boardId: parsed.data.boardId,
      name: parsed.data.name,
      color: parsed.data.color,
    });
    if (!result.ok) return result;

    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return { ok: true, data: result.data };
  } catch (error) {
    console.error("[tags] create failed", error);
    return { ok: false, error: "Could not create that tag. Please try again." };
  }
}

export async function deleteBoardTagAction(input: {
  workspaceSlug: string;
  productSlug: string;
  tagId: string;
}): Promise<ActionResult<{ deleted: true }>> {
  const parsed = baseSchema.extend({ tagId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "That tag id is not valid." };

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "feedback:write",
  );
  if ("error" in authorized) return authorized.error;

  const result = await deleteTag({
    productId: authorized.context.product.id,
    tagId: parsed.data.tagId,
  });
  if (!result.ok) return result;

  revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
  return { ok: true, data: result.data };
}

export async function setPostTagsAction(input: {
  workspaceSlug: string;
  productSlug: string;
  postId: string;
  tagIds: string[];
}): Promise<ActionResult<{ tagIds: string[] }>> {
  const parsed = baseSchema
    .extend({
      postId: z.uuid("That feedback request id is not valid."),
      tagIds: z.array(z.uuid()).max(10, "A request can carry at most ten tags."),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Choose tags." };
  }

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "feedback:write",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const result = await replacePostTags({
      productId: authorized.context.product.id,
      postId: parsed.data.postId,
      tagIds: parsed.data.tagIds,
    });
    if (!result.ok) return result;

    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return { ok: true, data: result.data };
  } catch (error) {
    console.error("[tags] assignment failed", error);
    return { ok: false, error: "Could not save tags. Please try again." };
  }
}
