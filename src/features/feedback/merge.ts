import "server-only";

import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import { db, type Database } from "@/db";
import { feedbackComments, feedbackPosts, feedbackVotes } from "@/db/schema/feedback";
import {
  feedbackAttachments,
  feedbackCustomerVotes,
  feedbackFollowers,
  feedbackInsights,
  feedbackMerges,
  feedbackReactions,
  feedbackTagLinks,
} from "@/db/schema/feedback-extensions";

/**
 * Merge and unmerge.
 *
 * A merge moves the duplicate's comments, attachments, votes, followers,
 * reactions and tags onto the canonical request, then closes the duplicate
 * with `mergedIntoId` so the team keeps an audit trail. Engagement
 * that already exists on the target is deleted from the source instead of
 * moved, because it is a genuine duplicate and must not be counted twice.
 *
 * `feedback_merges` records the ids that actually moved. Unmerging replays that
 * record in reverse; the deleted duplicates stay on the target, where the
 * customer's interaction already counted.
 */

export type MergeFailure = { ok: false; error: string };
export type MergeResult =
  | { ok: true; targetId: string; mergeId: string }
  | MergeFailure;
export type UnmergeResult =
  | { ok: true; postId: string }
  | MergeFailure;

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function mergeInto(
  tx: Transaction,
  input: {
    productId: string;
    sourceId: string;
    targetId: string;
    userId: string | null;
    automatic?: boolean;
  },
) {
  const now = new Date();

  const rows = await tx
    .select()
    .from(feedbackPosts)
    .where(
      and(
        eq(feedbackPosts.productId, input.productId),
        inArray(feedbackPosts.id, [input.sourceId, input.targetId]),
      ),
    );
  const source = rows.find((post) => post.id === input.sourceId) ?? null;
  const target = rows.find((post) => post.id === input.targetId) ?? null;
  if (!source || !target) {
    return { ok: false as const, error: "That feedback request no longer exists." };
  }
  if (source.id === target.id) {
    return { ok: false as const, error: "Choose a different request to merge into." };
  }
  if (source.mergedIntoId || target.mergedIntoId) {
    return {
      ok: false as const,
      error: "One of these requests has already been merged.",
    };
  }

  // Team votes.
  const [sourceVotes, targetVotes] = await Promise.all([
    tx
      .select({ id: feedbackVotes.id, voterId: feedbackVotes.voterId })
      .from(feedbackVotes)
      .where(eq(feedbackVotes.feedbackPostId, source.id)),
    tx
      .select({ voterId: feedbackVotes.voterId })
      .from(feedbackVotes)
      .where(eq(feedbackVotes.feedbackPostId, target.id)),
  ]);
  const duplicateVoters = new Set(targetVotes.map((vote) => vote.voterId));
  const duplicateVoteIds = sourceVotes
    .filter((vote) => duplicateVoters.has(vote.voterId))
    .map((vote) => vote.id);
  if (duplicateVoteIds.length > 0) {
    await tx.delete(feedbackVotes).where(inArray(feedbackVotes.id, duplicateVoteIds));
  }
  const movedVotes = await tx
    .update(feedbackVotes)
    .set({ feedbackPostId: target.id })
    .where(eq(feedbackVotes.feedbackPostId, source.id))
    .returning({ id: feedbackVotes.id });

  // Customer votes.
  const [sourceCustomerVotes, targetCustomerVotes] = await Promise.all([
    tx
      .select({ id: feedbackCustomerVotes.id, customerId: feedbackCustomerVotes.customerId })
      .from(feedbackCustomerVotes)
      .where(eq(feedbackCustomerVotes.feedbackPostId, source.id)),
    tx
      .select({ customerId: feedbackCustomerVotes.customerId })
      .from(feedbackCustomerVotes)
      .where(eq(feedbackCustomerVotes.feedbackPostId, target.id)),
  ]);
  const duplicateCustomers = new Set(targetCustomerVotes.map((vote) => vote.customerId));
  const duplicateCustomerVoteIds = sourceCustomerVotes
    .filter((vote) => duplicateCustomers.has(vote.customerId))
    .map((vote) => vote.id);
  if (duplicateCustomerVoteIds.length > 0) {
    await tx
      .delete(feedbackCustomerVotes)
      .where(inArray(feedbackCustomerVotes.id, duplicateCustomerVoteIds));
  }
  const movedCustomerVotes = await tx
    .update(feedbackCustomerVotes)
    .set({ feedbackPostId: target.id })
    .where(eq(feedbackCustomerVotes.feedbackPostId, source.id))
    .returning({ id: feedbackCustomerVotes.id });

  // Followers.
  const [sourceFollowers, targetFollowers] = await Promise.all([
    tx
      .select({ id: feedbackFollowers.id, customerId: feedbackFollowers.customerId })
      .from(feedbackFollowers)
      .where(eq(feedbackFollowers.feedbackPostId, source.id)),
    tx
      .select({ customerId: feedbackFollowers.customerId })
      .from(feedbackFollowers)
      .where(eq(feedbackFollowers.feedbackPostId, target.id)),
  ]);
  const followingCustomers = new Set(targetFollowers.map((row) => row.customerId));
  const duplicateFollowerIds = sourceFollowers
    .filter((row) => followingCustomers.has(row.customerId))
    .map((row) => row.id);
  if (duplicateFollowerIds.length > 0) {
    await tx.delete(feedbackFollowers).where(inArray(feedbackFollowers.id, duplicateFollowerIds));
  }
  const movedFollowers = await tx
    .update(feedbackFollowers)
    .set({ feedbackPostId: target.id })
    .where(eq(feedbackFollowers.feedbackPostId, source.id))
    .returning({ id: feedbackFollowers.id });

  // Post-level reactions. Comment reactions travel with their comment.
  const [sourceReactions, targetReactions] = await Promise.all([
    tx
      .select({
        id: feedbackReactions.id,
        customerId: feedbackReactions.customerId,
        kind: feedbackReactions.kind,
      })
      .from(feedbackReactions)
      .where(eq(feedbackReactions.feedbackPostId, source.id)),
    tx
      .select({ customerId: feedbackReactions.customerId, kind: feedbackReactions.kind })
      .from(feedbackReactions)
      .where(eq(feedbackReactions.feedbackPostId, target.id)),
  ]);
  const reactedOnTarget = new Set(
    targetReactions.map((row) => `${row.customerId}:${row.kind}`),
  );
  const duplicateReactionIds = sourceReactions
    .filter((row) => reactedOnTarget.has(`${row.customerId}:${row.kind}`))
    .map((row) => row.id);
  if (duplicateReactionIds.length > 0) {
    await tx.delete(feedbackReactions).where(inArray(feedbackReactions.id, duplicateReactionIds));
  }
  const movedReactions = await tx
    .update(feedbackReactions)
    .set({ feedbackPostId: target.id })
    .where(eq(feedbackReactions.feedbackPostId, source.id))
    .returning({ id: feedbackReactions.id });

  // Comments and post attachments move wholesale.
  const movedComments = await tx
    .update(feedbackComments)
    .set({ feedbackPostId: target.id })
    .where(eq(feedbackComments.feedbackPostId, source.id))
    .returning({ id: feedbackComments.id });

  const movedAttachments = await tx
    .update(feedbackAttachments)
    .set({ feedbackPostId: target.id })
    .where(eq(feedbackAttachments.feedbackPostId, source.id))
    .returning({ id: feedbackAttachments.id });

  // Evidence moves wholesale: the canonical request keeps every quote and its
  // source, which is the whole point of merging rather than deleting.
  const movedInsights = await tx
    .update(feedbackInsights)
    .set({ feedbackPostId: target.id })
    .where(eq(feedbackInsights.feedbackPostId, source.id))
    .returning({ id: feedbackInsights.id });

  // Board tags. A tag already on the target wins; unmerge restores only the
  // links this merge actually moved.
  const [sourceTags, targetTags] = await Promise.all([
    tx
      .select({ tagId: feedbackTagLinks.tagId })
      .from(feedbackTagLinks)
      .where(eq(feedbackTagLinks.feedbackPostId, source.id)),
    tx
      .select({ tagId: feedbackTagLinks.tagId })
      .from(feedbackTagLinks)
      .where(eq(feedbackTagLinks.feedbackPostId, target.id)),
  ]);
  const targetTagIds = new Set(targetTags.map((row) => row.tagId));
  const duplicateTagIds = sourceTags
    .map((row) => row.tagId)
    .filter((tagId) => targetTagIds.has(tagId));
  if (duplicateTagIds.length > 0) {
    await tx.delete(feedbackTagLinks).where(
      and(
        eq(feedbackTagLinks.feedbackPostId, source.id),
        inArray(feedbackTagLinks.tagId, duplicateTagIds),
      ),
    );
  }
  const movedTags = await tx
    .update(feedbackTagLinks)
    .set({ feedbackPostId: target.id })
    .where(eq(feedbackTagLinks.feedbackPostId, source.id))
    .returning({ tagId: feedbackTagLinks.tagId });

  // Imported vote totals have no voter rows to move, so they move as a number.
  const movedImportedVotes = source.importedVoteCount;

  await tx
    .update(feedbackPosts)
    .set({
      status: "closed",
      mergedIntoId: target.id,
      importedVoteCount: 0,
      updatedAt: now,
    })
    .where(and(eq(feedbackPosts.id, source.id), eq(feedbackPosts.productId, input.productId)));
  await tx
    .update(feedbackPosts)
    .set({
      importedVoteCount: target.importedVoteCount + movedImportedVotes,
      updatedAt: now,
    })
    .where(and(eq(feedbackPosts.id, target.id), eq(feedbackPosts.productId, input.productId)));

  const merge = await tx
    .insert(feedbackMerges)
    .values({
      productId: input.productId,
      sourcePostId: source.id,
      targetPostId: target.id,
      sourceStatus: source.status,
      movedCommentIds: movedComments.map((row) => row.id),
      movedAttachmentIds: movedAttachments.map((row) => row.id),
      movedVoteIds: movedVotes.map((row) => row.id),
      movedCustomerVoteIds: movedCustomerVotes.map((row) => row.id),
      movedReactionIds: movedReactions.map((row) => row.id),
      movedFollowerIds: movedFollowers.map((row) => row.id),
      movedTagIds: movedTags.map((row) => row.tagId),
      movedInsightIds: movedInsights.map((row) => row.id),
      movedImportedVotes,
      createdBy: input.userId,
      automatic: input.automatic ?? false,
    })
    .returning({ id: feedbackMerges.id });

  const mergeId = merge[0]?.id;
  if (!mergeId) throw new Error("Merge insert returned no row.");

  return { ok: true as const, targetId: target.id, mergeId };
}

export async function mergeFeedbackRequests(input: {
  productId: string;
  sourceId: string;
  targetId: string;
  userId: string | null;
  /** True only when the duplicate mode, not a person, requested the merge. */
  automatic?: boolean;
}): Promise<MergeResult> {
  return db.transaction((tx) => mergeInto(tx, input));
}

/**
 * Reverse the newest active merge of a request.
 *
 * Rows this merge moved are moved back by id. Engagement that already existed
 * on the target before the merge stays there: it was a duplicate, not something
 * this merge created.
 */
export async function unmergeFeedbackRequest(input: {
  productId: string;
  sourceId: string;
}): Promise<UnmergeResult> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(feedbackMerges)
      .where(
        and(
          eq(feedbackMerges.productId, input.productId),
          eq(feedbackMerges.sourcePostId, input.sourceId),
          isNull(feedbackMerges.undoneAt),
        ),
      )
      .orderBy(desc(feedbackMerges.createdAt))
      .limit(1);

    const merge = rows[0];
    if (!merge) {
      return { ok: false as const, error: "This request has no active merge to undo." };
    }

    const posts = await tx
      .select()
      .from(feedbackPosts)
      .where(
        and(
          eq(feedbackPosts.productId, input.productId),
          eq(feedbackPosts.id, input.sourceId),
        ),
      )
      .limit(1);
    const source = posts[0];
    if (!source || source.mergedIntoId !== merge.targetPostId) {
      return { ok: false as const, error: "This request is no longer merged into that target." };
    }

    const targetId = merge.targetPostId;

    if (merge.movedImportedVotes > 0) {
      const targets = await tx
        .select({ importedVoteCount: feedbackPosts.importedVoteCount })
        .from(feedbackPosts)
        .where(eq(feedbackPosts.id, targetId))
        .limit(1);
      const targetImported = targets[0]?.importedVoteCount ?? 0;

      await tx
        .update(feedbackPosts)
        .set({ importedVoteCount: Math.max(0, targetImported - merge.movedImportedVotes) })
        .where(eq(feedbackPosts.id, targetId));
      await tx
        .update(feedbackPosts)
        .set({ importedVoteCount: merge.movedImportedVotes })
        .where(eq(feedbackPosts.id, source.id));
    }

    if (merge.movedCommentIds.length > 0) {
      await tx
        .update(feedbackComments)
        .set({ feedbackPostId: source.id })
        .where(
          and(
            eq(feedbackComments.feedbackPostId, targetId),
            inArray(feedbackComments.id, merge.movedCommentIds),
          ),
        );
    }

    if (merge.movedAttachmentIds.length > 0) {
      await tx
        .update(feedbackAttachments)
        .set({ feedbackPostId: source.id })
        .where(
          and(
            eq(feedbackAttachments.feedbackPostId, targetId),
            inArray(feedbackAttachments.id, merge.movedAttachmentIds),
          ),
        );
    }

    if (merge.movedVoteIds.length > 0) {
      await tx
        .update(feedbackVotes)
        .set({ feedbackPostId: source.id })
        .where(
          and(
            eq(feedbackVotes.feedbackPostId, targetId),
            inArray(feedbackVotes.id, merge.movedVoteIds),
          ),
        );
    }

    if (merge.movedCustomerVoteIds.length > 0) {
      await tx
        .update(feedbackCustomerVotes)
        .set({ feedbackPostId: source.id })
        .where(
          and(
            eq(feedbackCustomerVotes.feedbackPostId, targetId),
            inArray(feedbackCustomerVotes.id, merge.movedCustomerVoteIds),
          ),
        );
    }

    if (merge.movedFollowerIds.length > 0) {
      await tx
        .update(feedbackFollowers)
        .set({ feedbackPostId: source.id })
        .where(
          and(
            eq(feedbackFollowers.feedbackPostId, targetId),
            inArray(feedbackFollowers.id, merge.movedFollowerIds),
          ),
        );
    }

    if (merge.movedReactionIds.length > 0) {
      await tx
        .update(feedbackReactions)
        .set({ feedbackPostId: source.id })
        .where(
          and(
            eq(feedbackReactions.feedbackPostId, targetId),
            inArray(feedbackReactions.id, merge.movedReactionIds),
          ),
        );
    }

    if (merge.movedTagIds.length > 0) {
      await tx
        .insert(feedbackTagLinks)
        .values(
          merge.movedTagIds.map((tagId) => ({
            feedbackPostId: source.id,
            tagId,
            productId: input.productId,
          })),
        )
        .onConflictDoNothing();
      await tx.delete(feedbackTagLinks).where(
        and(
          eq(feedbackTagLinks.feedbackPostId, targetId),
          inArray(feedbackTagLinks.tagId, merge.movedTagIds),
        ),
      );
    }

    if (merge.movedInsightIds.length > 0) {
      await tx
        .update(feedbackInsights)
        .set({ feedbackPostId: source.id })
        .where(
          and(
            eq(feedbackInsights.feedbackPostId, targetId),
            inArray(feedbackInsights.id, merge.movedInsightIds),
          ),
        );
    }

    const now = new Date();
    await tx
      .update(feedbackPosts)
      .set({
        status: merge.sourceStatus,
        mergedIntoId: null,
        updatedAt: now,
      })
      .where(
        and(eq(feedbackPosts.id, source.id), eq(feedbackPosts.productId, input.productId)),
      );

    await tx
      .update(feedbackMerges)
      .set({ undoneAt: now })
      .where(eq(feedbackMerges.id, merge.id));

    return { ok: true as const, postId: source.id };
  });
}
