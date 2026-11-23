import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { products } from "@/db/schema/workspaces";
import { getWorkspacePlan } from "@/features/entitlements/entitlements";
import {
  hasFeature,
  isJunoModelAllowed,
  type PlanId,
} from "@/features/entitlements/plans";
import { getAiConfig } from "@/lib/env";

/**
 * The one plan/model gate for every Juno AI path.
 *
 * Settings and answers enforce the same rule where they already load the
 * workspace plan; evaluation, tag suggestions and the public submission
 * assistant ask this module, so a downgrade cannot leave a paid model or an
 * AI-only feature reachable through another entry point.
 */

export type JunoModelAccess = {
  allowed: boolean;
  plan: PlanId;
  configuredModel: string | null;
  reason: "ok" | "missing_product" | "plan" | "model";
};

export async function getJunoModelAccess(input: {
  productId: string;
  selectedModel: string | null;
}): Promise<JunoModelAccess> {
  const rows = await db
    .select({ workspaceId: products.workspaceId })
    .from(products)
    .where(eq(products.id, input.productId))
    .limit(1);
  const workspaceId = rows[0]?.workspaceId;
  if (!workspaceId) {
    return {
      allowed: false,
      plan: "free",
      configuredModel: null,
      reason: "missing_product",
    };
  }

  const plan = await getWorkspacePlan(workspaceId);
  const configuredModel = getAiConfig()?.AI_MODEL ?? null;
  if (!hasFeature(plan, "ai")) {
    return { allowed: false, plan, configuredModel, reason: "plan" };
  }
  if (!isJunoModelAllowed(plan, configuredModel, input.selectedModel)) {
    return { allowed: false, plan, configuredModel, reason: "model" };
  }
  return { allowed: true, plan, configuredModel, reason: "ok" };
}
