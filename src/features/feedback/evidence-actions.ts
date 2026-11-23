"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { authorizeProductAction } from "@/features/live/action-auth";
import type { ActionResult } from "@/features/live/action-result";

import { addRequestContextLink, removeRequestContextLink } from "./context";
import { INSIGHT_SOURCES } from "./insight-rules";
import { addRequestInsight, deleteRequestInsight } from "./insights";

/**
 * Evidence and context actions.
 *
 * Both are `feedback:write`: attaching a quote or an article changes what the
 * team will cite later, even though neither is visible to customers. The
 * public page is revalidated because the demand counts on it change.
 */

const baseSchema = z.object({
  workspaceSlug: z.string().min(1),
  productSlug: z.string().min(1),
  postId: z.uuid("That feedback request id is not valid."),
});

const insightSourceSchema = z.enum(INSIGHT_SOURCES);

function revalidate(workspaceSlug: string, productSlug: string) {
  revalidatePath(`/app/${workspaceSlug}/${productSlug}`, "layout");
  revalidatePath(`/p/${workspaceSlug}/${productSlug}`, "layout");
}

export async function addInsightAction(input: {
  workspaceSlug: string;
  productSlug: string;
  postId: string;
  quote: string;
  source: string;
  authorLabel?: string | null;
  occurredAt?: string | null;
}): Promise<ActionResult<{ insightId: string }>> {
  const parsed = baseSchema
    .extend({
      quote: z.string().min(1, "Quote what the customer said."),
      source: insightSourceSchema,
      authorLabel: z.string().max(160).nullable().optional(),
      occurredAt: z.string().min(1).nullable().optional(),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the evidence." };
  }

  const occurredAt = parsed.data.occurredAt
    ? new Date(parsed.data.occurredAt)
    : null;
  if (occurredAt && Number.isNaN(occurredAt.getTime())) {
    return { ok: false, error: "That date is not valid." };
  }

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "feedback:write",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const result = await addRequestInsight({
      productId: authorized.context.product.id,
      postId: parsed.data.postId,
      quote: parsed.data.quote,
      source: parsed.data.source,
      authorLabel: parsed.data.authorLabel ?? null,
      occurredAt,
      createdBy: authorized.context.user.id,
    });
    if (!result.ok) return { ok: false, error: result.error };

    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return { ok: true, data: { insightId: result.insight.id } };
  } catch (error) {
    console.error("[evidence] insight add failed", error);
    return { ok: false, error: "Could not save that insight. Please try again." };
  }
}

export async function deleteInsightAction(input: {
  workspaceSlug: string;
  productSlug: string;
  postId: string;
  insightId: string;
}): Promise<ActionResult<{ deleted: true }>> {
  const parsed = baseSchema
    .extend({ insightId: z.uuid("That insight id is not valid.") })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "That insight id is not valid." };

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "feedback:write",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const result = await deleteRequestInsight({
      productId: authorized.context.product.id,
      postId: parsed.data.postId,
      insightId: parsed.data.insightId,
    });
    if (!result.ok) return { ok: false, error: result.error };

    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return { ok: true, data: { deleted: true } };
  } catch (error) {
    console.error("[evidence] insight delete failed", error);
    return { ok: false, error: "Could not remove that insight. Please try again." };
  }
}

export async function addContextLinkAction(input: {
  workspaceSlug: string;
  productSlug: string;
  postId: string;
  kind: "help_article" | "changelog";
  refId: string;
}): Promise<ActionResult<{ linkId: string; alreadyLinked: boolean }>> {
  const parsed = baseSchema
    .extend({
      kind: z.enum(["help_article", "changelog"]),
      refId: z.uuid("Choose an item to attach."),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Choose an item." };
  }

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "feedback:write",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const result = await addRequestContextLink({
      productId: authorized.context.product.id,
      postId: parsed.data.postId,
      kind: parsed.data.kind,
      refId: parsed.data.refId,
      createdBy: authorized.context.user.id,
    });
    if (!result.ok) return { ok: false, error: result.error };

    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return {
      ok: true,
      data: { linkId: result.linkId, alreadyLinked: result.alreadyLinked },
    };
  } catch (error) {
    console.error("[evidence] context add failed", error);
    return { ok: false, error: "Could not attach that context. Please try again." };
  }
}

export async function removeContextLinkAction(input: {
  workspaceSlug: string;
  productSlug: string;
  postId: string;
  linkId: string;
}): Promise<ActionResult<{ deleted: true }>> {
  const parsed = baseSchema
    .extend({ linkId: z.uuid("That context id is not valid.") })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "That context id is not valid." };

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "feedback:write",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const result = await removeRequestContextLink({
      productId: authorized.context.product.id,
      postId: parsed.data.postId,
      linkId: parsed.data.linkId,
    });
    if (!result.ok) return { ok: false, error: result.error };

    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return { ok: true, data: { deleted: true } };
  } catch (error) {
    console.error("[evidence] context remove failed", error);
    return { ok: false, error: "Could not remove that context. Please try again." };
  }
}
