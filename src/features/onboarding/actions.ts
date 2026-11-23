"use server";

import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { boards, products, workspaceMembers, workspaces } from "@/db/schema";
import { recordWorkspaceCreated } from "@/features/analytics/signup-funnel";
import { assertSameOriginAction } from "@/features/live/action-origin";
import { getSessionUser } from "@/lib/authz";
import { isUniqueViolation } from "@/lib/error-message";
import { validateSlug } from "@/lib/slug";
import {
  flattenIssues,
  onboardingSchema,
  type OnboardingResult,
} from "@/features/onboarding/schema";

/**
 * Create a workspace, its owner membership and the first product in a single
 * transaction. Either all three exist afterwards or none of them do — a
 * half-created workspace would leave the account unable to reach a dashboard.
 *
 * Authorization: only the *authenticated* user's own id is used as the owner.
 * A client-supplied user identifier is never accepted.
 */
export async function createWorkspaceWithProductAction(
  input: unknown,
): Promise<OnboardingResult> {
  await assertSameOriginAction();
  const user = await getSessionUser();
  if (!user) {
    return { ok: false, formError: "Your session has expired. Please sign in again." };
  }

  const parsed = onboardingSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: flattenIssues(parsed.error) };
  }

  const workspaceSlug = validateSlug(parsed.data.workspaceSlug);
  if (!workspaceSlug.ok) {
    return { ok: false, fieldErrors: { workspaceSlug: workspaceSlug.reason } };
  }

  const productSlug = validateSlug(parsed.data.productSlug);
  if (!productSlug.ok) {
    return { ok: false, fieldErrors: { productSlug: productSlug.reason } };
  }

  const workspaceName = parsed.data.workspaceName.trim();
  const productName = parsed.data.productName.trim();

  try {
    const created = await db.transaction(async (tx) => {
      const clash = await tx
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.slug, workspaceSlug.slug))
        .limit(1);

      if (clash.length > 0) {
        return { conflict: "workspaceSlug" as const };
      }

      const insertedWorkspace = await tx
        .insert(workspaces)
        .values({ name: workspaceName, slug: workspaceSlug.slug, createdBy: user.id })
        .returning({ id: workspaces.id, slug: workspaces.slug });

      const workspace = insertedWorkspace[0];
      if (!workspace) throw new Error("Workspace insert returned no row.");

      await tx
        .insert(workspaceMembers)
        .values({ workspaceId: workspace.id, userId: user.id, role: "owner" });

      const insertedProduct = await tx
        .insert(products)
        .values({ workspaceId: workspace.id, name: productName, slug: productSlug.slug })
        .returning({ id: products.id, slug: products.slug });

      const product = insertedProduct[0];
      if (!product) throw new Error("Product insert returned no row.");

      // Every product starts with one board so public feedback has a home and
      // the backfill invariant (a default board per product) holds for new data.
      await tx.insert(boards).values({
        productId: product.id,
        name: "Feedback",
        slug: "feedback",
        position: 0,
      });

      return {
        redirectTo: parsed.data.offerLifetime
          ? `/app/${workspace.slug}/settings#billing`
          : `/app/${workspace.slug}/${product.slug}`,
        workspaceId: workspace.id,
      };
    });

    if ("conflict" in created && created.conflict) {
      const fieldErrors: Record<string, string> = {};
      fieldErrors[created.conflict] = "That URL is already taken. Please choose another.";
      return { ok: false, fieldErrors };
    }

    if ("redirectTo" in created && created.redirectTo) {
      await recordWorkspaceCreated(created.workspaceId);
      return { ok: true, redirectTo: created.redirectTo };
    }

    return { ok: false, formError: "We could not create your workspace. Please try again." };
  } catch (error) {
    if (isUniqueViolation(error)) {
      const message =
        typeof error === "object" && error !== null && "message" in error
          ? String((error as { message?: unknown }).message ?? "")
          : "";

      const field = message.includes("workspaces_slug_unique")
        ? "workspaceSlug"
        : message.includes("products_workspace_slug_unique")
          ? "productSlug"
          : message.includes("workspace_members_workspace_user_unique")
            ? "workspaceName"
            : undefined;

      if (field) {
        const fieldErrors: Record<string, string> = {};
        fieldErrors[field] = "That value is already taken. Please choose another.";
        return { ok: false, fieldErrors };
      }
      return { ok: false, formError: "That workspace or product already exists." };
    }

    console.error("[onboarding] create failed:", error);
    return { ok: false, formError: "We could not create your workspace. Please try again." };
  }
}