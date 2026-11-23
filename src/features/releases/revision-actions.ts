"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { authorizeProductAction } from "@/features/live/action-auth";
import type { ActionResult } from "@/features/live/action-result";
import { invalidateAllPublicReleases } from "@/features/public/payload-cache";

import { listReleaseRevisions, restoreReleaseRevision } from "./revision-service";
import type { ReleaseRevisionSnapshot, ReleaseRevisionView } from "./revision-types";

const inputSchema = z.object({
  workspaceSlug: z.string().min(1),
  productSlug: z.string().min(1),
  releaseId: z.uuid("That release id is not valid."),
});

const restoreSchema = inputSchema.extend({
  revisionId: z.uuid("That revision id is not valid."),
});

/**
 * Read a release's history on demand.
 *
 * The dashboard snapshot deliberately stays small; revisions are loaded when
 * the history dialog opens. `release:read` is enough: every workspace role has
 * it, and the query is scoped to the authorized product.
 */
export async function listReleaseRevisionsAction(input: {
  workspaceSlug: string;
  productSlug: string;
  releaseId: string;
}): Promise<ActionResult<ReleaseRevisionView[]>> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "That release id is not valid." };
  }

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "release:read",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const revisions = await listReleaseRevisions(
      authorized.context.product.id,
      parsed.data.releaseId,
    );
    return { ok: true, data: revisions };
  } catch (error) {
    console.error("[releases] revision list failed", error);
    return { ok: false, error: "Could not load the revision history." };
  }
}

/** Restore one revision into the live release, preserving its publication state. */
export async function restoreReleaseRevisionAction(input: {
  workspaceSlug: string;
  productSlug: string;
  releaseId: string;
  revisionId: string;
}): Promise<ActionResult<ReleaseRevisionSnapshot>> {
  const parsed = restoreSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "That revision id is not valid." };
  }

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "release:write",
  );
  if ("error" in authorized) return authorized.error;

  try {
    const result = await restoreReleaseRevision({
      productId: authorized.context.product.id,
      workspaceId: authorized.context.workspace.id,
      releaseId: parsed.data.releaseId,
      revisionId: parsed.data.revisionId,
      userId: authorized.context.user.id,
    });
    if (!result.ok) return result;
    revalidatePath(
      `/app/${parsed.data.workspaceSlug}/${parsed.data.productSlug}`,
      "layout",
    );
    invalidateAllPublicReleases();
    return { ok: true, data: result.snapshot };
  } catch (error) {
    console.error("[releases] revision restore failed", error);
    return { ok: false, error: "Could not restore that revision." };
  }
}
