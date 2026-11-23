import "server-only";

import { db } from "@/db";
import { aiUsageEvents } from "@/db/schema/observability";
import { currentRequestId } from "@/lib/observability/context";
import { getAiPricing } from "@/lib/observability/config";
import { logEvent, serializeError } from "@/lib/logger";

/**
 * Record one completed AI call.
 *
 * Only token counts, model and feature are stored. Prompts, completions and
 * customer text never reach this table, so the cost dashboard cannot become a
 * second copy of support conversations.
 *
 * Cost is in micro-dollars: tokens multiplied by the configured dollars per
 * million tokens is already a micro-dollar amount. The write is best-effort;
 * losing a cost row must never fail the feature that used AI.
 */
export async function recordAiUsage(input: {
  model: string;
  promptTokens: number;
  completionTokens: number;
  feature?: string | undefined;
  workspaceId?: string | null | undefined;
  productId?: string | null | undefined;
  requestId?: string | null | undefined;
}): Promise<void> {
  const promptTokens = Math.max(0, Math.trunc(input.promptTokens));
  const completionTokens = Math.max(0, Math.trunc(input.completionTokens));
  if (promptTokens === 0 && completionTokens === 0) return;

  const pricing = getAiPricing();
  const estimatedCostMicros = Math.round(
    promptTokens * pricing.inputUsdPerMTok +
      completionTokens * pricing.outputUsdPerMTok,
  );

  try {
    await db.insert(aiUsageEvents).values({
      workspaceId: input.workspaceId ?? null,
      productId: input.productId ?? null,
      feature: (input.feature ?? "ai").slice(0, 60),
      model: input.model.slice(0, 120),
      promptTokens,
      completionTokens,
      estimatedCostMicros,
      requestId: input.requestId ?? currentRequestId(),
    });
  } catch (error) {
    logEvent("warn", "ai.usage_record_failed", {
      model: input.model,
      error: serializeError(error),
    });
  }
}
