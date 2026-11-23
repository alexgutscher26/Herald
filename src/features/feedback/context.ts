import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  feedbackContextLinks,
  feedbackPosts,
} from "@/db/schema";
import { helpArticles } from "@/db/schema/help";
import { releases } from "@/db/schema/releases";

/**
 * Help-center article and changelog context for a request.
 *
 * A context link answers "what should someone read before deciding?", so it
 * never counts as demand: only `feedback_insights` feeds the "N customers
 * asked for this" line. `ref_id` is polymorphic, which is why every write and
 * read verifies the target belongs to the same product as the request.
 */

export type AddContextLinkInput = {
  productId: string;
  postId: string;
  kind: "help_article" | "changelog";
  refId: string;
  createdBy?: string | null;
};

export type AddContextLinkResult =
  | { ok: true; linkId: string; alreadyLinked: boolean }
  | { ok: false; error: string };

export async function addRequestContextLink(
  input: AddContextLinkInput,
): Promise<AddContextLinkResult> {
  const post = await db
    .select({ id: feedbackPosts.id })
    .from(feedbackPosts)
    .where(
      and(
        eq(feedbackPosts.id, input.postId),
        eq(feedbackPosts.productId, input.productId),
      ),
    )
    .limit(1);
  if (!post[0]) {
    return { ok: false, error: "That request no longer exists." };
  }

  if (input.kind === "help_article") {
    const article = await db
      .select({ id: helpArticles.id })
      .from(helpArticles)
      .where(
        and(
          eq(helpArticles.id, input.refId),
          eq(helpArticles.productId, input.productId),
        ),
      )
      .limit(1);
    if (!article[0]) {
      return { ok: false, error: "Choose an article from this product." };
    }
  } else {
    const release = await db
      .select({ id: releases.id })
      .from(releases)
      .where(
        and(
          eq(releases.id, input.refId),
          eq(releases.productId, input.productId),
        ),
      )
      .limit(1);
    if (!release[0]) {
      return { ok: false, error: "Choose a changelog entry from this product." };
    }
  }

  const existing = await db
    .select({ id: feedbackContextLinks.id })
    .from(feedbackContextLinks)
    .where(
      and(
        eq(feedbackContextLinks.productId, input.productId),
        eq(feedbackContextLinks.feedbackPostId, input.postId),
        eq(feedbackContextLinks.kind, input.kind),
        eq(feedbackContextLinks.refId, input.refId),
      ),
    )
    .limit(1);
  if (existing[0]) {
    return { ok: true, linkId: existing[0].id, alreadyLinked: true };
  }

  const inserted = await db
    .insert(feedbackContextLinks)
    .values({
      productId: input.productId,
      feedbackPostId: input.postId,
      kind: input.kind,
      refId: input.refId,
      createdBy: input.createdBy ?? null,
    })
    .returning({ id: feedbackContextLinks.id });

  const link = inserted[0];
  if (!link) return { ok: false, error: "Could not attach that context." };
  return { ok: true, linkId: link.id, alreadyLinked: false };
}

/** Scoped by product and request, so a foreign link id removes nothing. */
export async function removeRequestContextLink(input: {
  productId: string;
  postId: string;
  linkId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const removed = await db
    .delete(feedbackContextLinks)
    .where(
      and(
        eq(feedbackContextLinks.id, input.linkId),
        eq(feedbackContextLinks.feedbackPostId, input.postId),
        eq(feedbackContextLinks.productId, input.productId),
      ),
    )
    .returning({ id: feedbackContextLinks.id });

  if (!removed[0]) {
    return { ok: false, error: "That context link no longer exists." };
  }
  return { ok: true };
}
