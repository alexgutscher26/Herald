import "server-only";

import { and, count, eq } from "drizzle-orm";

import { db } from "@/db";
import { releaseReactions, releases } from "@/db/schema";

import type { PublicReactionKind } from "./types";

export type ReleaseReactionResult =
  | { ok: true; reacted: boolean; count: number }
  | { ok: false; status: 404; error: string };

/**
 * Add or remove one reaction on a published public changelog entry.
 *
 * The release is looked up inside the resolved product and public-channel
 * predicates, so a draft, scheduled, archived or private entry is the same 404
 * as a missing one. The unique index keeps a repeated reaction idempotent.
 */
export async function setReleaseReaction(input: {
  productId: string;
  releaseId: string;
  customerId: string;
  kind: PublicReactionKind;
  reacted: boolean;
}): Promise<ReleaseReactionResult> {
  const rows = await db
    .select({ id: releases.id })
    .from(releases)
    .where(
      and(
        eq(releases.id, input.releaseId),
        eq(releases.productId, input.productId),
        eq(releases.status, "published"),
        eq(releases.channelPublicChangelog, true),
      ),
    )
    .limit(1);
  if (!rows[0]) return { ok: false, status: 404, error: "Update not found." };

  if (input.reacted) {
    await db
      .insert(releaseReactions)
      .values({
        productId: input.productId,
        releaseId: input.releaseId,
        customerId: input.customerId,
        kind: input.kind,
      })
      .onConflictDoNothing();
  } else {
    await db
      .delete(releaseReactions)
      .where(
        and(
          eq(releaseReactions.releaseId, input.releaseId),
          eq(releaseReactions.customerId, input.customerId),
          eq(releaseReactions.kind, input.kind),
        ),
      );
  }

  const totals = await db
    .select({ value: count() })
    .from(releaseReactions)
    .where(
      and(
        eq(releaseReactions.releaseId, input.releaseId),
        eq(releaseReactions.kind, input.kind),
      ),
    );

  return { ok: true, reacted: input.reacted, count: totals[0]?.value ?? 0 };
}