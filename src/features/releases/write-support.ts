import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { feedbackPosts } from "@/db/schema/feedback";
import {
  releaseAuthors,
  releaseTagLinks,
  releaseTags,
  releases,
} from "@/db/schema/releases";
import { releaseFeedbackLinks } from "@/db/schema/roadmap";
import { subscriptionTopics } from "@/db/schema/subscribers";
import { workspaceMembers } from "@/db/schema/workspaces";
import {
  cancellationReasons,
  releaseReasonLinks,
} from "@/db/schema/winback";

import { normalizeReleaseTags, parseReleaseTagText } from "./tags";
import { releaseTagTopicKey } from "@/features/subscribers/topics";

/**
 * Shared release write helpers.
 *
 * The editor actions and the draft API both need the same tenant checks and
 * replacement semantics. Keeping them here means a guessed feedback id,
 * cancellation reason or author fails the same way on every write path.
 */

export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function loadRelease(
  tx: Transaction,
  productId: string,
  releaseId: string,
) {
  const rows = await tx
    .select()
    .from(releases)
    .where(and(eq(releases.id, releaseId), eq(releases.productId, productId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function validateLinkedRecords(
  tx: Transaction,
  productId: string,
  workspaceId: string,
  feedbackIds: string[],
  reasonIds: string[],
): Promise<string | null> {
  if (feedbackIds.length > 0) {
    const rows = await tx
      .select({ id: feedbackPosts.id })
      .from(feedbackPosts)
      .where(and(eq(feedbackPosts.productId, productId), inArray(feedbackPosts.id, feedbackIds)));
    if (rows.length !== feedbackIds.length) {
      return "A linked feedback request does not belong to this product.";
    }
  }

  if (reasonIds.length > 0) {
    const rows = await tx
      .select({ id: cancellationReasons.id })
      .from(cancellationReasons)
      .where(
        and(
          eq(cancellationReasons.workspaceId, workspaceId),
          inArray(cancellationReasons.id, reasonIds),
        ),
      );
    if (rows.length !== reasonIds.length) {
      return "A linked cancellation reason does not belong to this workspace.";
    }
  }

  return null;
}

export async function validateAuthors(
  tx: Transaction,
  workspaceId: string,
  authorIds: string[],
): Promise<string | null> {
  if (authorIds.length === 0) return "Choose at least one author.";

  const rows = await tx
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        inArray(workspaceMembers.userId, authorIds),
      ),
    );

  return rows.length === authorIds.length
    ? null
    : "An author is not a member of this workspace.";
}

/** Replace the product-scoped tags attached to one release. */
export async function replaceReleaseTags(
  tx: Transaction,
  productId: string,
  releaseId: string,
  tagsText: string,
) {
  await tx.delete(releaseTagLinks).where(eq(releaseTagLinks.releaseId, releaseId));

  const tags = normalizeReleaseTags(parseReleaseTagText(tagsText));
  if (tags.length === 0) return;

  await tx
    .insert(releaseTags)
    .values(tags.map((tag) => ({ productId, name: tag.name, slug: tag.slug })))
    .onConflictDoNothing();

  // Each tag is also an opt-outable subscription topic. Existing preferences
  // survive a rename because the topic key is derived from the tag slug.
  await tx
    .insert(subscriptionTopics)
    .values(
      tags.map((tag, index) => ({
        productId,
        key: releaseTagTopicKey(tag.slug),
        name: `Tag: ${tag.name}`,
        description: `Updates tagged ${tag.name}.`,
        position: 100 + index,
      })),
    )
    .onConflictDoNothing();

  const stored = await tx
    .select({ id: releaseTags.id, slug: releaseTags.slug })
    .from(releaseTags)
    .where(
      and(
        eq(releaseTags.productId, productId),
        inArray(
          releaseTags.slug,
          tags.map((tag) => tag.slug),
        ),
      ),
    );

  const idBySlug = new Map(stored.map((tag) => [tag.slug, tag.id]));
  const links = tags.flatMap((tag) => {
    const tagId = idBySlug.get(tag.slug);
    return tagId ? [{ releaseId, tagId, productId }] : [];
  });

  if (links.length > 0) {
    await tx.insert(releaseTagLinks).values(links).onConflictDoNothing();
  }
}

/** Replace the ordered author credits on one release. */
export async function replaceReleaseAuthors(
  tx: Transaction,
  productId: string,
  releaseId: string,
  authorIds: string[],
) {
  await tx.delete(releaseAuthors).where(eq(releaseAuthors.releaseId, releaseId));
  if (authorIds.length === 0) return;

  await tx
    .insert(releaseAuthors)
    .values(
      authorIds.map((userId, position) => ({
        releaseId,
        productId,
        userId,
        position,
      })),
    )
    .onConflictDoNothing();
}

/** Replace both taxonomy sets, as the editor does on every save. */
export async function replaceTaxonomy(
  tx: Transaction,
  productId: string,
  releaseId: string,
  tagsText: string,
  authorIds: string[],
) {
  await replaceReleaseTags(tx, productId, releaseId, tagsText);
  await replaceReleaseAuthors(tx, productId, releaseId, authorIds);
}

/** Replace the “built from your feedback” links on one release. */
export async function replaceFeedbackLinks(
  tx: Transaction,
  productId: string,
  releaseId: string,
  feedbackIds: string[],
) {
  await tx.delete(releaseFeedbackLinks).where(eq(releaseFeedbackLinks.releaseId, releaseId));
  if (feedbackIds.length === 0) return;

  await tx
    .insert(releaseFeedbackLinks)
    .values(
      feedbackIds.map((feedbackPostId) => ({
        productId,
        releaseId,
        feedbackPostId,
      })),
    )
    .onConflictDoNothing();
}

/** Replace the win-back cancellation reasons a release addresses. */
export async function replaceCancellationLinks(
  tx: Transaction,
  releaseId: string,
  reasonIds: string[],
) {
  await tx.delete(releaseReasonLinks).where(eq(releaseReasonLinks.releaseId, releaseId));
  if (reasonIds.length === 0) return;

  await tx
    .insert(releaseReasonLinks)
    .values(reasonIds.map((cancellationReasonId) => ({ releaseId, cancellationReasonId })))
    .onConflictDoNothing();
}

/** Replace both link sets, as the editor does on every save. */
export async function replaceLinks(
  tx: Transaction,
  productId: string,
  releaseId: string,
  feedbackIds: string[],
  reasonIds: string[],
) {
  await replaceFeedbackLinks(tx, productId, releaseId, feedbackIds);
  await replaceCancellationLinks(tx, releaseId, reasonIds);
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}
