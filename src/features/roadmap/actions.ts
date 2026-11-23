"use server";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { boards, products, publicRoadmaps, roadmapBoards } from "@/db/schema";
import { authorizeProductAction } from "@/features/live/action-auth";
import type { ActionResult } from "@/features/live/action-result";
import { isUniqueViolation } from "@/lib/error-message";

import {
  firstRoadmapIssue,
  resolveRoadmapSlug,
  roadmapFormSchema,
} from "./schema";

/**
 * Product-level public surface switches.
 *
 * Feedback and the roadmap are independent: a team can publish a roadmap
 * while keeping request threads private, or keep the roadmap private while
 * feedback stays open. The public routers read these columns on every request,
 * so turning a surface off takes effect immediately.
 */

const inputSchema = z.object({
  workspaceSlug: z.string().min(1),
  productSlug: z.string().min(1),
  publicFeedbackEnabled: z.boolean(),
  publicRoadmapEnabled: z.boolean(),
  publicChangelogEnabled: z.boolean(),
  publicShippedCounterEnabled: z.boolean(),
});

export type PublicSurfacesInput = z.infer<typeof inputSchema>;

const roadmapTargetSchema = z.object({
  workspaceSlug: z.string().min(1),
  productSlug: z.string().min(1),
  roadmapId: z.uuid().nullable().optional(),
  form: roadmapFormSchema,
});

function roadmapRevalidate(workspaceSlug: string, productSlug: string): void {
  revalidatePath(`/app/${workspaceSlug}/${productSlug}`, "layout");
  revalidatePath(`/p/${workspaceSlug}/${productSlug}`, "layout");
}

async function validateRoadmapBoards(
  productId: string,
  boardIds: string[],
): Promise<{ ok: true; ids: string[] } | { ok: false; error: string }> {
  const ids = [...new Set(boardIds)];
  if (ids.length === 0) return { ok: true, ids: [] };

  const rows = await db
    .select({ id: boards.id })
    .from(boards)
    .where(
      and(
        eq(boards.productId, productId),
        eq(boards.visibility, "public"),
        isNull(boards.archivedAt),
        inArray(boards.id, ids),
      ),
    );
  if (rows.length !== ids.length) {
    return { ok: false, error: "Only live public boards can be added to a roadmap." };
  }
  return { ok: true, ids };
}

export async function saveRoadmapAction(
  input: unknown,
): Promise<ActionResult<{ roadmapId: string }>> {
  const parsed = roadmapTargetSchema.safeParse(input);
  if (!parsed.success) {
    const issue = firstRoadmapIssue(parsed.error);
    return { ok: false, error: issue.message, fieldErrors: issue.fieldErrors };
  }

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "settings:manage",
  );
  if ("error" in authorized) return authorized.error;
  const { product, workspace } = authorized.context;

  const slug = resolveRoadmapSlug(parsed.data.form);
  if (!slug.ok) {
    return { ok: false, error: slug.reason, fieldErrors: { slug: [slug.reason] } };
  }
  const boardCheck = await validateRoadmapBoards(product.id, parsed.data.form.boardIds);
  if (!boardCheck.ok) return { ok: false, error: boardCheck.error };

  const now = new Date();
  try {
    const roadmapId = await db.transaction(async (tx) => {
      let id = parsed.data.roadmapId ?? null;
      if (id) {
        const existing = await tx
          .select({ id: publicRoadmaps.id, publishedAt: publicRoadmaps.publishedAt })
          .from(publicRoadmaps)
          .where(
            and(eq(publicRoadmaps.id, id), eq(publicRoadmaps.productId, product.id)),
          )
          .limit(1);
        if (!existing[0]) throw new Error("ROADMAP_NOT_FOUND");

        await tx
          .update(publicRoadmaps)
          .set({
            name: parsed.data.form.name,
            slug: slug.slug,
            description: parsed.data.form.description.trim() || null,
            visibility: parsed.data.form.visibility,
            position: parsed.data.form.position,
            publishedAt: parsed.data.form.published
              ? (existing[0].publishedAt ?? now)
              : null,
            updatedAt: now,
          })
          .where(eq(publicRoadmaps.id, id));
      } else {
        const inserted = await tx
          .insert(publicRoadmaps)
          .values({
            workspaceId: workspace.id,
            productId: product.id,
            name: parsed.data.form.name,
            slug: slug.slug,
            description: parsed.data.form.description.trim() || null,
            visibility: parsed.data.form.visibility,
            position: parsed.data.form.position,
            publishedAt: parsed.data.form.published ? now : null,
            updatedAt: now,
          })
          .returning({ id: publicRoadmaps.id });
        id = inserted[0]?.id ?? null;
        if (!id) throw new Error("ROADMAP_NOT_CREATED");
      }

      await tx.delete(roadmapBoards).where(eq(roadmapBoards.roadmapId, id));
      if (boardCheck.ids.length > 0) {
        await tx.insert(roadmapBoards).values(
          boardCheck.ids.map((boardId) => ({
            roadmapId: id,
            boardId,
            productId: product.id,
          })),
        );
      }
      return id;
    });

    roadmapRevalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return { ok: true, data: { roadmapId } };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        ok: false,
        error: "That public URL is already used by another roadmap.",
        fieldErrors: { slug: ["That public URL is already used by another roadmap."] },
      };
    }
    if (error instanceof Error && error.message === "ROADMAP_NOT_FOUND") {
      return { ok: false, error: "That roadmap no longer exists." };
    }
    console.error("[roadmap] save failed", error);
    return { ok: false, error: "Could not save the roadmap. Please try again." };
  }
}

export async function setRoadmapPublishedAction(
  input: unknown,
): Promise<ActionResult<{ roadmapId: string; published: boolean }>> {
  const parsed = z
    .object({
      workspaceSlug: z.string().min(1),
      productSlug: z.string().min(1),
      roadmapId: z.uuid(),
      published: z.boolean(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "That roadmap is not valid." };

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "settings:manage",
  );
  if ("error" in authorized) return authorized.error;

  const rows = await db
    .update(publicRoadmaps)
    .set({
      publishedAt: parsed.data.published ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(publicRoadmaps.id, parsed.data.roadmapId),
        eq(publicRoadmaps.productId, authorized.context.product.id),
      ),
    )
    .returning({ id: publicRoadmaps.id });
  if (!rows[0]) return { ok: false, error: "That roadmap no longer exists." };

  roadmapRevalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
  return {
    ok: true,
    data: { roadmapId: rows[0].id, published: parsed.data.published },
  };
}

export async function deleteRoadmapAction(
  input: unknown,
): Promise<ActionResult<{ roadmapId: string }>> {
  const parsed = z
    .object({
      workspaceSlug: z.string().min(1),
      productSlug: z.string().min(1),
      roadmapId: z.uuid(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "That roadmap is not valid." };

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "settings:manage",
  );
  if ("error" in authorized) return authorized.error;

  const rows = await db
    .delete(publicRoadmaps)
    .where(
      and(
        eq(publicRoadmaps.id, parsed.data.roadmapId),
        eq(publicRoadmaps.productId, authorized.context.product.id),
      ),
    )
    .returning({ id: publicRoadmaps.id });
  if (!rows[0]) return { ok: false, error: "That roadmap no longer exists." };

  roadmapRevalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
  return { ok: true, data: { roadmapId: rows[0].id } };
}

export async function updatePublicSurfacesAction(
  input: PublicSurfacesInput,
): Promise<
  ActionResult<{
    publicFeedbackEnabled: boolean;
    publicRoadmapEnabled: boolean;
    publicChangelogEnabled: boolean;
    publicShippedCounterEnabled: boolean;
  }>
> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Those visibility values are not valid." };

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "settings:manage",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const rows = await db
      .update(products)
      .set({
        publicFeedbackEnabled: parsed.data.publicFeedbackEnabled,
        publicRoadmapEnabled: parsed.data.publicRoadmapEnabled,
        publicChangelogEnabled: parsed.data.publicChangelogEnabled,
        publicShippedCounterEnabled: parsed.data.publicShippedCounterEnabled,
        updatedAt: new Date(),
      })
      .where(eq(products.id, authorized.context.product.id))
      .returning({
        publicFeedbackEnabled: products.publicFeedbackEnabled,
        publicRoadmapEnabled: products.publicRoadmapEnabled,
        publicChangelogEnabled: products.publicChangelogEnabled,
        publicShippedCounterEnabled: products.publicShippedCounterEnabled,
      });

    const row = rows[0];
    if (!row) return { ok: false, error: "That product no longer exists." };

    revalidatePath(
      `/app/${parsed.data.workspaceSlug}/${parsed.data.productSlug}`,
      "layout",
    );
    return { ok: true, data: row };
  } catch (error) {
    console.error("[roadmap] public surface update failed", error);
    return { ok: false, error: "Could not save the public visibility. Please try again." };
  }
}
