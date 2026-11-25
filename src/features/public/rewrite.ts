import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { junoSettings } from "@/db/schema/knowledge";
import { generateAiText } from "@/features/ai/provider";
import { getJunoModelAccess } from "@/features/juno/access";
import { checkBudget, recordAiUsage } from "@/features/juno/budget";
import { getAiConfig } from "@/lib/env";
import { logEvent, serializeError } from "@/lib/logger";

import {
  buildRewritePrompt,
  parseRewriteResponse,
  type SubmissionRewrite,
} from "./rewrite-prompt";

/**
 * Public submission assistant.
 *
 * It is available only when the product has enabled it and the deployment has
 * an AI provider. Every call is budget-checked and recorded, and the provider
 * output is parsed into the exact shape the form renders. A malformed answer is
 * an error, never partially applied.
 */

export async function submissionAssistantAvailable(
  productId: string,
): Promise<boolean> {
  if (!getAiConfig()) return false;
  const rows = await db
    .select({
      enabled: junoSettings.enabled,
      assistant: junoSettings.submissionAssistantEnabled,
      model: junoSettings.model,
    })
    .from(junoSettings)
    .where(eq(junoSettings.productId, productId))
    .limit(1);
  const row = rows[0];
  if (!row?.enabled || !row.assistant) return false;

  // The assistant is a Mira model call, so the workspace plan and the
  // configured allowlist apply here too — not only to chat answers.
  return (await getJunoModelAccess({ productId, selectedModel: row.model })).allowed;
}

export async function rewriteSubmission(input: {
  productId: string;
  productName: string;
  title: string;
  body: string;
  now?: Date;
  generate?: typeof generateAiText;
}): Promise<
  | { ok: true; rewrite: SubmissionRewrite }
  | { ok: false; status: number; error: string }
> {
  if (!(await submissionAssistantAvailable(input.productId))) {
    return { ok: false, status: 404, error: "The writing assistant is not enabled." };
  }

  const now = input.now ?? new Date();
  const budget = await checkBudget({
    productId: input.productId,
    costCents: 1,
    now,
  });
  if (!budget.allowed) {
    return {
      ok: false,
      status: 429,
      error: "The writing assistant has reached today's limit. You can still submit as written.",
    };
  }

  const generate = input.generate ?? generateAiText;
  const prompt = buildRewritePrompt({
    productName: input.productName,
    title: input.title,
    body: input.body,
  });

  let raw: string;
  try {
    raw = await generate({
      system: prompt.system,
      prompt: prompt.prompt,
      temperature: 0.2,
      maxTokens: 1_200,
    });
  } catch (error) {
    logEvent("error", "submission.rewrite_failed", { error: serializeError(error) });
    return {
      ok: false,
      status: 503,
      error: "The writing assistant is unavailable. You can still submit as written.",
    };
  }

  try {
    const rewrite = parseRewriteResponse(raw);
    await db.transaction(async (tx) => {
      await recordAiUsage(tx, {
        productId: input.productId,
        now,
        costCents: 1,
        dailyLimitCents: budget.limitCents,
      });
    });
    return { ok: true, rewrite };
  } catch (error) {
    logEvent("warn", "submission.rewrite_format", { error: serializeError(error) });
    return {
      ok: false,
      status: 502,
      error: "The writing assistant returned an unusable suggestion. You can still submit as written.",
    };
  }
}
