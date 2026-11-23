"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { products } from "@/db/schema/workspaces";
import { recordWorkspaceAudit } from "@/features/data-controls/service";
import { authorizeProductAction } from "@/features/live/action-auth";
import { authorizeWorkspaceAction } from "@/features/live/workspace-action-auth";
import type { ActionResult } from "@/features/live/action-result";
import { validateSlug } from "@/lib/slug";

import { productDetailsSchema } from "./schema";
import { createProductForWorkspace } from "./service";

const createProductSchema = z.object({
  workspaceSlug: z.string().min(1),
  name: z
    .string()
    .trim()
    .min(2, "Use at least two characters.")
    .max(80, "Keep the name under 80 characters."),
  slug: z.string().trim().min(1, "Product URL is required."),
});

/**
 * Create a product inside an authorized workspace.
 *
 * The permission (`product:create`) and the plan allowance are both checked on
 * the server; the form only mirrors them. The new product's default feedback
 * board is created in the same transaction as the product.
 */
export async function createProductAction(input: {
  workspaceSlug: string;
  name: string;
  slug: string;
}): Promise<ActionResult<{ productId: string; productSlug: string; redirectTo: string }>> {
  const parsed = createProductSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Check the product details.",
      fieldErrors,
    };
  }

  const authorized = await authorizeWorkspaceAction(
    parsed.data.workspaceSlug,
    "product:create",
  );
  if ("error" in authorized) return authorized.error;

  const slug = validateSlug(parsed.data.slug);
  if (!slug.ok) {
    return { ok: false, error: slug.reason, fieldErrors: { slug: [slug.reason] } };
  }

  const result = await createProductForWorkspace({
    workspaceId: authorized.context.workspace.id,
    workspaceSlug: parsed.data.workspaceSlug,
    name: parsed.data.name,
    slug: slug.slug,
  });
  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      ...(result.billingUrl ? { billingUrl: result.billingUrl } : {}),
      ...(result.fieldErrors ? { fieldErrors: result.fieldErrors } : {}),
    };
  }

  await recordWorkspaceAudit({
    workspaceId: authorized.context.workspace.id,
    actorUserId: authorized.context.user.id,
    action: "product.created",
    targetType: "product",
    targetId: result.product.id,
    metadata: { name: result.product.name, slug: result.product.slug },
  });

  const redirectTo = `/app/${encodeURIComponent(parsed.data.workspaceSlug)}/${encodeURIComponent(result.product.slug)}`;
  revalidatePath(`/app/${encodeURIComponent(parsed.data.workspaceSlug)}`, "layout");
  revalidatePath(`/app/${encodeURIComponent(parsed.data.workspaceSlug)}/settings`);

  return {
    ok: true,
    data: {
      productId: result.product.id,
      productSlug: result.product.slug,
      redirectTo,
    },
  };
}

export async function saveProductDetailsAction(input: {
  workspaceSlug: string;
  productSlug: string;
  description: string;
}): Promise<ActionResult<{ description: string }>> {
  const parsed = productDetailsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error:
        parsed.error.issues[0]?.message ?? "Check the product description.",
    };
  }

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "settings:manage",
  );
  if ("error" in authorized) return authorized.error;

  const rows = await db
    .update(products)
    .set({
      description: parsed.data.description === "" ? null : parsed.data.description,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(products.id, authorized.context.product.id),
        eq(products.workspaceId, authorized.context.workspace.id),
      ),
    )
    .returning({ description: products.description });

  const row = rows[0];
  if (!row) return { ok: false, error: "Could not save the product details." };

  revalidatePath(
    `/app/${parsed.data.workspaceSlug}/${parsed.data.productSlug}/settings`,
  );
  revalidatePath(
    `/app/${parsed.data.workspaceSlug}/${parsed.data.productSlug}`,
    "layout",
  );
  revalidatePath("/p", "layout");

  return { ok: true, data: { description: row.description ?? "" } };
}
