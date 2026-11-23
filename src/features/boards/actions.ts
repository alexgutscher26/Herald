"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { boards } from "@/db/schema";
import { findBoardForProduct } from "@/db/queries/boards";
import {
  checkBoardLimit,
  getWorkspacePlan,
} from "@/features/entitlements/entitlements";
import { authorizeProductAction } from "@/features/live/action-auth";
import type { ActionResult } from "@/features/live/action-result";
import { hasFeature, planDefinition, type PlanId } from "@/features/entitlements/plans";
import { limitFailure } from "@/features/billing/links";

import {
  boardFormSchema,
  firstBoardIssue,
  resolveBoardSlug,
  type BoardFormInput,
} from "./schema";

/**
 * Board management writes.
 *
 * Each action authenticates, checks `settings:manage`, resolves the board
 * inside the authorized product, and only then mutates. The public URL is a
 * unique key per product, so a conflict is reported as a field error rather
 * than a 500.
 */

const targetSchema = z.object({
  workspaceSlug: z.string().min(1),
  productSlug: z.string().min(1),
  boardId: z.uuid("That board id is not valid."),
});

const SLUG_CONFLICT = "That public URL is already used by another board in this product.";

type BoardActionInput = BoardFormInput & {
  workspaceSlug: string;
  productSlug: string;
};

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

function revalidateProduct(workspaceSlug: string, productSlug: string): void {
  revalidatePath(`/app/${workspaceSlug}/${productSlug}`, "layout");
}

/**
 * Plan gates for board options.
 *
 * These are re-checked on the server for every write, so a hand-crafted
 * request cannot enable guest posting or make a board private on a plan that
 * does not include them. Existing boards that lose the entitlement are left
 * unchanged; the public resolver treats guest posting as off.
 */
function featureFailure(
  plan: PlanId,
  workspaceSlug: string,
  input: { visibility: "public" | "private"; guestPosting: boolean },
): { ok: false; error: string; billingUrl: string; fieldErrors?: Record<string, string[]> } | null {
  if (input.visibility === "private" && !hasFeature(plan, "privateBoards")) {
    const message = `Private boards are not included in the ${planDefinition(plan).name} plan.`;
    return limitFailure(message, workspaceSlug, { visibility: [message] });
  }
  if (input.guestPosting && !hasFeature(plan, "guestPosting")) {
    const message = `Guest posting is not included in the ${planDefinition(plan).name} plan.`;
    return limitFailure(message, workspaceSlug, { guestPosting: [message] });
  }
  return null;
}

async function boardLimitFailure(
  productId: string,
  workspaceSlug: string,
): Promise<{ ok: false; error: string; billingUrl: string } | null> {
  const check = await checkBoardLimit(productId, 1);
  if (check.allowed) return null;

  const plan = planDefinition(check.plan);
  return limitFailure(
    `The ${plan.name} plan allows ${check.limit ?? 0} boards per product. Archive a board or upgrade to add another.`,
    workspaceSlug,
  );
}

export async function createBoardAction(
  input: BoardActionInput,
): Promise<ActionResult<{ boardId: string }>> {
  const parsed = boardFormSchema.safeParse(input);
  if (!parsed.success) {
    const issue = firstBoardIssue(parsed.error);
    return { ok: false, error: issue.message, fieldErrors: issue.fieldErrors };
  }

  const authorized = await authorizeProductAction(
    input.workspaceSlug,
    input.productSlug,
    "settings:manage",
  );
  if ("error" in authorized) return authorized.error;
  const { product } = authorized.context;

  const limit = await boardLimitFailure(product.id, input.workspaceSlug);
  if (limit) return limit;

  const plan = await getWorkspacePlan(authorized.context.workspace.id);
  const feature = featureFailure(plan, input.workspaceSlug, parsed.data);
  if (feature) return feature;

  const slug = resolveBoardSlug(parsed.data);
  if (!slug.ok) {
    return { ok: false, error: slug.reason, fieldErrors: { slug: [slug.reason] } };
  }

  try {
    const rows = await db
      .insert(boards)
      .values({
        productId: product.id,
        name: parsed.data.name,
        slug: slug.slug,
        description: parsed.data.description === "" ? null : parsed.data.description,
        icon: parsed.data.icon === "" ? null : parsed.data.icon,
        color: parsed.data.color === "" ? null : parsed.data.color,
        position: parsed.data.position,
        visibility: parsed.data.visibility,
        guestPosting: parsed.data.guestPosting,
        settings: {
          moderation: {
            requireApproval: parsed.data.requireApproval,
            comments: parsed.data.comments,
            blockSensitiveInfo: parsed.data.blockSensitiveInfo,
          },
        },
      })
      .returning({ id: boards.id });

    const board = rows[0];
    if (!board) return { ok: false, error: "Could not create the board. Please try again." };

    revalidateProduct(input.workspaceSlug, input.productSlug);
    return { ok: true, data: { boardId: board.id } };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: SLUG_CONFLICT, fieldErrors: { slug: [SLUG_CONFLICT] } };
    }
    console.error("[boards] create failed", error);
    return { ok: false, error: "Could not create the board. Please try again." };
  }
}

export async function updateBoardAction(
  input: BoardActionInput & { boardId: string },
): Promise<ActionResult<{ boardId: string }>> {
  const parsed = boardFormSchema.safeParse(input);
  if (!parsed.success) {
    const issue = firstBoardIssue(parsed.error);
    return { ok: false, error: issue.message, fieldErrors: issue.fieldErrors };
  }

  const authorized = await authorizeProductAction(
    input.workspaceSlug,
    input.productSlug,
    "settings:manage",
  );
  if ("error" in authorized) return authorized.error;
  const { product } = authorized.context;

  const id = z.uuid().safeParse(input.boardId);
  if (!id.success) return { ok: false, error: "That board id is not valid." };

  const existing = await findBoardForProduct(product.id, id.data);
  if (!existing) return { ok: false, error: "That board no longer exists." };

  // A downgrade can leave a product over its board allowance. Existing boards
  // stay readable and can be archived, but their configuration is read-only
  // until the product is back inside the plan.
  const allowance = await checkBoardLimit(product.id, 1);
  if (allowance.limit !== null && allowance.current > allowance.limit) {
    return limitFailure(
      `This product has ${allowance.current} boards but the ${planDefinition(allowance.plan).name} plan allows ${allowance.limit}. Archive a board before changing board settings.`,
      input.workspaceSlug,
    );
  }

  const plan = await getWorkspacePlan(authorized.context.workspace.id);
  const feature = featureFailure(plan, input.workspaceSlug, parsed.data);
  if (feature) return feature;

  const slug = resolveBoardSlug(parsed.data);
  if (!slug.ok) {
    return { ok: false, error: slug.reason, fieldErrors: { slug: [slug.reason] } };
  }

  try {
    const rows = await db
      .update(boards)
      .set({
        name: parsed.data.name,
        slug: slug.slug,
        description: parsed.data.description === "" ? null : parsed.data.description,
        icon: parsed.data.icon === "" ? null : parsed.data.icon,
        color: parsed.data.color === "" ? null : parsed.data.color,
        position: parsed.data.position,
        visibility: parsed.data.visibility,
        guestPosting: parsed.data.guestPosting,
        settings: {
          moderation: {
            requireApproval: parsed.data.requireApproval,
            comments: parsed.data.comments,
            blockSensitiveInfo: parsed.data.blockSensitiveInfo,
          },
        },
        updatedAt: new Date(),
      })
      .where(eq(boards.id, existing.id))
      .returning({ id: boards.id });

    if (!rows[0]) return { ok: false, error: "That board no longer exists." };

    revalidateProduct(input.workspaceSlug, input.productSlug);
    return { ok: true, data: { boardId: rows[0].id } };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: SLUG_CONFLICT, fieldErrors: { slug: [SLUG_CONFLICT] } };
    }
    console.error("[boards] update failed", error);
    return { ok: false, error: "Could not save the board. Please try again." };
  }
}

export async function archiveBoardAction(input: {
  workspaceSlug: string;
  productSlug: string;
  boardId: string;
}): Promise<ActionResult<{ boardId: string }>> {
  const parsed = targetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That board id is not valid." };

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "settings:manage",
  );
  if ("error" in authorized) return authorized.error;
  const { product } = authorized.context;

  const existing = await findBoardForProduct(product.id, parsed.data.boardId);
  if (!existing) return { ok: false, error: "That board no longer exists." };
  if (existing.archivedAt) return { ok: true, data: { boardId: existing.id } };

  try {
    await db
      .update(boards)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(boards.id, existing.id));

    revalidateProduct(parsed.data.workspaceSlug, parsed.data.productSlug);
    return { ok: true, data: { boardId: existing.id } };
  } catch (error) {
    console.error("[boards] archive failed", error);
    return { ok: false, error: "Could not archive the board. Please try again." };
  }
}

export async function restoreBoardAction(input: {
  workspaceSlug: string;
  productSlug: string;
  boardId: string;
}): Promise<ActionResult<{ boardId: string }>> {
  const parsed = targetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That board id is not valid." };

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "settings:manage",
  );
  if ("error" in authorized) return authorized.error;
  const { product } = authorized.context;

  const existing = await findBoardForProduct(product.id, parsed.data.boardId);
  if (!existing) return { ok: false, error: "That board no longer exists." };
  if (!existing.archivedAt) return { ok: true, data: { boardId: existing.id } };

  const limit = await boardLimitFailure(product.id, input.workspaceSlug);
  if (limit) return limit;

  try {
    await db
      .update(boards)
      .set({ archivedAt: null, updatedAt: new Date() })
      .where(eq(boards.id, existing.id));

    revalidateProduct(parsed.data.workspaceSlug, parsed.data.productSlug);
    return { ok: true, data: { boardId: existing.id } };
  } catch (error) {
    console.error("[boards] restore failed", error);
    return { ok: false, error: "Could not restore the board. Please try again." };
  }
}
