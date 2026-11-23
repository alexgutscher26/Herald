"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  AiNotConfiguredError,
  AiProviderError,
} from "@/features/ai/provider";
import { hasFeature, toPlanId } from "@/features/entitlements/plans";
import { authorizeProductAction } from "@/features/live/action-auth";
import type { ActionResult } from "@/features/live/action-result";

import type {
  AiDraftCandidate,
  AiDraftCreateInput,
  AiDraftRewriteInput,
  AiDraftRewriteOutput,
} from "./action-types";
import {
  createAiDraft,
  listAiDraftCandidates,
  MAX_AI_DRAFT_REQUESTS,
  rewriteAiDraft,
} from "./ai-draft";
import { AiDraftFormatError } from "./ai-draft-prompt";

/**
 * AI drafting is an authoring aid, never a publisher.
 *
 * The actions require `release:write` and the AI plan feature, and the write
 * path (`createAiDraft` → `createReleaseDraft`) only creates drafts. There is
 * no call to publish, schedule, queue notifications or send email here.
 */

const contextSchema = z.object({
  workspaceSlug: z.string().min(1),
  productSlug: z.string().min(1),
});

const createSchema = contextSchema.extend({
  feedbackIds: z
    .array(z.uuid())
    .min(1, "Choose at least one completed request.")
    .max(MAX_AI_DRAFT_REQUESTS)
    .transform((ids) => [...new Set(ids)]),
  focus: z.string().trim().max(500),
});

const rewriteSchema = contextSchema.extend({
  releaseId: z.uuid("That release id is not valid."),
  focus: z.string().trim().max(500),
});

function aiPlanFailure(plan: string): ActionResult<never> | null {
  return hasFeature(toPlanId(plan), "ai")
    ? null
    : { ok: false, error: "AI drafting is available on the Pro plan." };
}

export async function listAiDraftCandidatesAction(input: {
  workspaceSlug: string;
  productSlug: string;
}): Promise<ActionResult<AiDraftCandidate[]>> {
  const parsed = contextSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That product is not valid." };

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "release:write",
  );
  if ("error" in authorized) return authorized.error;

  const planFailure = aiPlanFailure(authorized.context.workspace.plan);
  if (planFailure) return planFailure;

  const candidates = await listAiDraftCandidates(authorized.context.product.id);
  return { ok: true, data: candidates };
}

export async function createAiDraftAction(
  input: AiDraftCreateInput,
): Promise<ActionResult<{ releaseId: string }>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    const message =
      parsed.error.issues[0]?.message ?? "Check the selected completed requests.";
    return { ok: false, error: message };
  }
  const value = parsed.data;

  const authorized = await authorizeProductAction(
    value.workspaceSlug,
    value.productSlug,
    "release:write",
  );
  if ("error" in authorized) return authorized.error;

  const { context } = authorized;
  const planFailure = aiPlanFailure(context.workspace.plan);
  if (planFailure) return planFailure;

  try {
    const result = await createAiDraft(
      {
        workspaceId: context.workspace.id,
        productId: context.product.id,
        userId: context.user.id,
        productName: context.product.name,
        productDescription: context.product.description ?? "",
      },
      { feedbackIds: value.feedbackIds, focus: value.focus },
    );

    if (!result.ok) return { ok: false, error: result.error };

    revalidatePath(
      `/app/${value.workspaceSlug}/${value.productSlug}`,
      "layout",
    );
    return { ok: true, data: { releaseId: result.releaseId } };
  } catch (error) {
    if (error instanceof AiNotConfiguredError || error instanceof AiProviderError) {
      return { ok: false, error: error.message };
    }
    if (error instanceof AiDraftFormatError) {
      return { ok: false, error: error.message };
    }

    console.error("[releases] AI draft failed", error);
    return { ok: false, error: "Could not generate a draft. Please try again." };
  }
}

export async function rewriteAiDraftAction(
  input: AiDraftRewriteInput,
): Promise<ActionResult<AiDraftRewriteOutput>> {
  const parsed = rewriteSchema.safeParse(input);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Check the draft and try again.";
    return { ok: false, error: message };
  }
  const value = parsed.data;

  const authorized = await authorizeProductAction(
    value.workspaceSlug,
    value.productSlug,
    "release:write",
  );
  if ("error" in authorized) return authorized.error;

  const { context } = authorized;
  const planFailure = aiPlanFailure(context.workspace.plan);
  if (planFailure) return planFailure;

  try {
    const result = await rewriteAiDraft(
      {
        workspaceId: context.workspace.id,
        productId: context.product.id,
        userId: context.user.id,
        productName: context.product.name,
        productDescription: context.product.description ?? "",
      },
      { releaseId: value.releaseId, focus: value.focus },
    );

    if (!result.ok) return { ok: false, error: result.error };

    revalidatePath(`/app/${value.workspaceSlug}/${value.productSlug}`, "layout");
    return {
      ok: true,
      data: {
        releaseId: result.releaseId,
        title: result.content.title,
        summary: result.content.summary,
        body: result.content.body,
        category: result.content.category,
        tags: result.content.tags,
      },
    };
  } catch (error) {
    if (error instanceof AiNotConfiguredError || error instanceof AiProviderError) {
      return { ok: false, error: error.message };
    }
    if (error instanceof AiDraftFormatError) {
      return { ok: false, error: error.message };
    }

    console.error("[releases] AI rewrite failed", error);
    return { ok: false, error: "Could not rewrite the draft. Please try again." };
  }
}
