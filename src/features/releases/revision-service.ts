import "server-only";

import { createHash } from "node:crypto";

import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { db, type Database } from "@/db";
import { user } from "@/db/schema/auth";
import { feedbackPosts } from "@/db/schema/feedback";
import {
  releaseAuthors,
  releaseRevisions,
  releaseTagLinks,
  releaseTags,
  releases,
} from "@/db/schema/releases";
import { workspaceMembers } from "@/db/schema/workspaces";
import { releaseFeedbackLinks } from "@/db/schema/roadmap";
import { cancellationReasons, releaseReasonLinks } from "@/db/schema/winback";
import { normalizeReleaseTranslations } from "@/features/i18n/content";
import type { ReleaseCover } from "@/types";

import {
  toRevisionCover,
  type ReleaseRevisionAction,
  type ReleaseRevisionSnapshot,
  type ReleaseRevisionView,
} from "./revision-types";
import { loadRelease, replaceLinks, replaceTaxonomy } from "./write-support";

/**
 * Revision capture and reads.
 *
 * Every write path calls `ensureInitialRevision` before touching the release
 * and `recordReleaseRevision` afterwards. The first call preserves the state
 * that existed before the feature (so the last published snapshot is never
 * lost); the second records the new state, deduplicated against the most
 * recent revision.
 */

export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

/** Stable hash: object keys are fixed and id lists are order-insensitive. */
export function releaseRevisionHash(snapshot: ReleaseRevisionSnapshot): string {
  const canonical = {
    title: snapshot.title,
    slug: snapshot.slug,
    summary: snapshot.summary,
    body: snapshot.body,
    translations: snapshot.translations,
    category: snapshot.category,
    cover: snapshot.cover,
    ogImageKey: snapshot.ogImageKey,
    youtubeUrl: snapshot.youtubeUrl,
    channels: {
      publicChangelog: snapshot.channels.publicChangelog,
      inAppWidget: snapshot.channels.inAppWidget,
      subscriberEmail: snapshot.channels.subscriberEmail,
    },
    // Tag order and casing do not change the stored set; author order is the
    // byline and must keep its meaning.
    tags: [
      ...new Set(snapshot.tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean)),
    ].sort(),
    authorIds: snapshot.authorIds,
    linkedFeedbackIds: [...snapshot.linkedFeedbackIds].sort(),
    linkedCancellationReasonIds: [...snapshot.linkedCancellationReasonIds].sort(),
    status: snapshot.status,
    scheduledFor: snapshot.scheduledFor,
    publishedAt: snapshot.publishedAt,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function revisionValues(
  productId: string,
  releaseId: string,
  action: ReleaseRevisionAction,
  snapshot: ReleaseRevisionSnapshot,
  createdBy: string | null,
  createdAt?: Date,
) {
  return {
    productId,
    releaseId,
    action,
    status: snapshot.status,
    title: snapshot.title,
    slug: snapshot.slug,
    summary: snapshot.summary,
    bodyMarkdown: snapshot.body,
    translations: snapshot.translations,
    category: snapshot.category,
    cover: snapshot.cover,
    ogImageKey: snapshot.ogImageKey,
    youtubeUrl: snapshot.youtubeUrl,
    channels: snapshot.channels,
    tags: snapshot.tags,
    authorIds: snapshot.authorIds,
    linkedFeedbackIds: snapshot.linkedFeedbackIds,
    linkedCancellationReasonIds: snapshot.linkedCancellationReasonIds,
    scheduledFor: snapshot.scheduledFor ? new Date(snapshot.scheduledFor) : null,
    publishedAt: snapshot.publishedAt ? new Date(snapshot.publishedAt) : null,
    contentHash: releaseRevisionHash(snapshot),
    createdBy,
    ...(createdAt ? { createdAt } : {}),
  } satisfies typeof releaseRevisions.$inferInsert;
}

/** Load the release's current database state as a revision snapshot. */
export async function loadReleaseSnapshot(
  tx: Transaction,
  productId: string,
  releaseId: string,
): Promise<ReleaseRevisionSnapshot | null> {
  const rows = await tx
    .select()
    .from(releases)
    .where(and(eq(releases.id, releaseId), eq(releases.productId, productId)))
    .limit(1);
  const release = rows[0];
  if (!release) return null;

  // Sequential rather than Promise.all: a transaction owns one connection, and
  // pg 9 removes support for concurrent queries on it.
  const tagRows = await tx
    .select({ name: releaseTags.name })
    .from(releaseTagLinks)
    .innerJoin(releaseTags, eq(releaseTagLinks.tagId, releaseTags.id))
    .where(eq(releaseTagLinks.releaseId, releaseId))
    .orderBy(asc(releaseTags.name));
  const authorRows = await tx
    .select({ userId: releaseAuthors.userId })
    .from(releaseAuthors)
    .where(eq(releaseAuthors.releaseId, releaseId))
    .orderBy(asc(releaseAuthors.position));
  const feedbackRows = await tx
    .select({ feedbackPostId: releaseFeedbackLinks.feedbackPostId })
    .from(releaseFeedbackLinks)
    .where(eq(releaseFeedbackLinks.releaseId, releaseId));
  const reasonRows = await tx
    .select({ cancellationReasonId: releaseReasonLinks.cancellationReasonId })
    .from(releaseReasonLinks)
    .where(eq(releaseReasonLinks.releaseId, releaseId));

  return {
    title: release.title,
    slug: release.slug,
    summary: release.summary ?? "",
    body: release.bodyMarkdown ?? "",
    translations: release.translations,
    category: release.category,
    cover: toRevisionCover(release.cover),
    ogImageKey: release.ogImageKey,
    youtubeUrl: release.youtubeUrl,
    channels: {
      publicChangelog: release.channelPublicChangelog,
      inAppWidget: release.channelInAppWidget,
      subscriberEmail: release.channelSubscriberEmail,
    },
    tags: tagRows.map((row) => row.name),
    authorIds: authorRows.map((row) => row.userId),
    linkedFeedbackIds: feedbackRows.map((row) => row.feedbackPostId),
    linkedCancellationReasonIds: reasonRows.map((row) => row.cancellationReasonId),
    status: release.status,
    scheduledFor: iso(release.scheduledFor),
    publishedAt: iso(release.publishedAt),
  };
}

/**
 * Record the state that existed before the first edit of an existing release.
 *
 * Without this, the first autosave would overwrite the last published content
 * and the pre-publish diff would compare the new draft with itself.
 */
export async function ensureInitialRevision(
  tx: Transaction,
  input: { productId: string; releaseId: string },
): Promise<boolean> {
  const existing = await tx
    .select({ id: releaseRevisions.id })
    .from(releaseRevisions)
    .where(eq(releaseRevisions.releaseId, input.releaseId))
    .limit(1);
  if (existing[0]) return false;

  const snapshot = await loadReleaseSnapshot(tx, input.productId, input.releaseId);
  if (!snapshot) return false;

  const dates = await tx
    .select({ authorId: releases.authorId, updatedAt: releases.updatedAt })
    .from(releases)
    .where(eq(releases.id, input.releaseId))
    .limit(1);
  const row = dates[0];

  await tx.insert(releaseRevisions).values(
    revisionValues(
      input.productId,
      input.releaseId,
      "save",
      snapshot,
      row?.authorId ?? null,
      row?.updatedAt,
    ),
  );
  return true;
}

/**
 * Record the release's new state. Returns false when the previous revision
 * already describes the same content/status/schedule, which is the common case
 * for a no-op autosave or a repeated publish request.
 */
export async function recordReleaseRevision(
  tx: Transaction,
  input: {
    productId: string;
    releaseId: string;
    action: ReleaseRevisionAction;
    snapshot: ReleaseRevisionSnapshot;
    createdBy: string | null;
  },
): Promise<boolean> {
  const latest = await tx
    .select({
      id: releaseRevisions.id,
      action: releaseRevisions.action,
      contentHash: releaseRevisions.contentHash,
      status: releaseRevisions.status,
      scheduledFor: releaseRevisions.scheduledFor,
      createdBy: releaseRevisions.createdBy,
      createdAt: releaseRevisions.createdAt,
    })
    .from(releaseRevisions)
    .where(eq(releaseRevisions.releaseId, input.releaseId))
    .orderBy(desc(releaseRevisions.sequence))
    .limit(1);

  const row = latest[0];
  const hash = releaseRevisionHash(input.snapshot);
  if (
    row &&
    row.contentHash === hash &&
    row.status === input.snapshot.status &&
    iso(row.scheduledFor) === input.snapshot.scheduledFor
  ) {
    return false;
  }

  const now = new Date();
  const AUTOSAVE_WINDOW_MS = 15 * 60 * 1000;
  if (
    row &&
    input.action === "autosave" &&
    row.action === "autosave" &&
    row.createdBy === input.createdBy &&
    now.getTime() - row.createdAt.getTime() <= AUTOSAVE_WINDOW_MS
  ) {
    // One editing session produces one history entry, not one per pause.
    await tx
      .update(releaseRevisions)
      .set(
        revisionValues(
          input.productId,
          input.releaseId,
          input.action,
          input.snapshot,
          input.createdBy,
          now,
        ),
      )
      .where(eq(releaseRevisions.id, row.id));
    return true;
  }

  await tx
    .insert(releaseRevisions)
    .values(
      revisionValues(
        input.productId,
        input.releaseId,
        input.action,
        input.snapshot,
        input.createdBy,
      ),
    );
  return true;
}

/** Newest first, bounded. Only the product's own release is readable. */
export async function listReleaseRevisions(
  productId: string,
  releaseId: string,
  limit = 40,
): Promise<ReleaseRevisionView[]> {
  const rows = await db
    .select({
      revision: releaseRevisions,
      createdByName: user.name,
    })
    .from(releaseRevisions)
    .leftJoin(user, eq(releaseRevisions.createdBy, user.id))
    .where(
      and(
        eq(releaseRevisions.productId, productId),
        eq(releaseRevisions.releaseId, releaseId),
      ),
    )
    .orderBy(desc(releaseRevisions.sequence))
    .limit(Math.min(Math.max(Math.trunc(limit), 1), 100));

  return rows.map(({ revision, createdByName }) => ({
    id: revision.id,
    action: revision.action,
    createdById: revision.createdBy,
    createdByName: createdByName ?? null,
    createdAt: revision.createdAt.toISOString(),
    title: revision.title,
    slug: revision.slug,
    summary: revision.summary,
    body: revision.bodyMarkdown,
    translations: revision.translations,
    category: revision.category,
    cover: revision.cover,
    ogImageKey: revision.ogImageKey,
    youtubeUrl: revision.youtubeUrl,
    channels: revision.channels,
    tags: revision.tags,
    authorIds: revision.authorIds,
    linkedFeedbackIds: revision.linkedFeedbackIds,
    linkedCancellationReasonIds: revision.linkedCancellationReasonIds,
    status: revision.status,
    scheduledFor: iso(revision.scheduledFor),
    publishedAt: iso(revision.publishedAt),
  }));
}

/** Restore one historical revision's editable content into the live row. */
export async function restoreReleaseRevision(input: {
  productId: string;
  workspaceId: string;
  releaseId: string;
  revisionId: string;
  userId: string;
}): Promise<
  { ok: true; snapshot: ReleaseRevisionSnapshot } | { ok: false; error: string }
> {
  return db.transaction(async (tx) => {
    const revisionRows = await tx
      .select()
      .from(releaseRevisions)
      .where(
        and(
          eq(releaseRevisions.id, input.revisionId),
          eq(releaseRevisions.releaseId, input.releaseId),
          eq(releaseRevisions.productId, input.productId),
        ),
      )
      .limit(1);
    const revision = revisionRows[0];
    if (!revision) return { ok: false as const, error: "That revision no longer exists." };

    const existing = await loadRelease(tx, input.productId, input.releaseId);
    if (!existing) return { ok: false as const, error: "That release no longer exists." };

    if (revision.slug !== existing.slug) {
      const conflict = await tx
        .select({ id: releases.id })
        .from(releases)
        .where(
          and(
            eq(releases.productId, input.productId),
            eq(releases.slug, revision.slug),
          ),
        )
        .limit(1);
      if (conflict[0] && conflict[0].id !== existing.id) {
        return {
          ok: false as const,
          error: "That revision's slug is now used by another release. Change this release's slug, then restore again.",
        };
      }
    }

    await ensureInitialRevision(tx, {
      productId: input.productId,
      releaseId: input.releaseId,
    });

    const authorRows = revision.authorIds.length
      ? await tx
          .select({ userId: workspaceMembers.userId })
          .from(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.workspaceId, input.workspaceId),
              inArray(workspaceMembers.userId, revision.authorIds),
            ),
          )
      : [];
    const validAuthors = new Set(authorRows.map((row) => row.userId));
    const authorIds = revision.authorIds.filter((id) => validAuthors.has(id));
    if (authorIds.length === 0) {
      authorIds.push(existing.authorId ?? input.userId);
    }

    const feedbackRows = revision.linkedFeedbackIds.length
      ? await tx
          .select({ id: feedbackPosts.id })
          .from(feedbackPosts)
          .where(
            and(
              eq(feedbackPosts.productId, input.productId),
              inArray(feedbackPosts.id, revision.linkedFeedbackIds),
            ),
          )
      : [];
    const validFeedback = new Set(feedbackRows.map((row) => row.id));

    const reasonRows = revision.linkedCancellationReasonIds.length
      ? await tx
          .select({ id: cancellationReasons.id })
          .from(cancellationReasons)
          .where(
            and(
              eq(cancellationReasons.workspaceId, input.workspaceId),
              inArray(cancellationReasons.id, revision.linkedCancellationReasonIds),
            ),
          )
      : [];
    const validReasons = new Set(reasonRows.map((row) => row.id));

    // A revision keeps only a fingerprint for a custom cover. The image bytes
    // stay in storage, so keep the live custom cover rather than guessing a key.
    const cover: ReleaseCover =
      revision.cover.kind === "custom"
        ? existing.cover
        : revision.cover.kind === "preset"
          ? { kind: "preset", preset: revision.cover.preset }
          : { kind: "none" };

    await tx
      .update(releases)
      .set({
        title: revision.title,
        slug: revision.slug,
        summary: revision.summary,
        bodyMarkdown: revision.bodyMarkdown,
        translations: normalizeReleaseTranslations(revision.translations),
        category: revision.category,
        cover,
        ogImageKey: revision.ogImageKey,
        youtubeUrl: revision.youtubeUrl,
        channelPublicChangelog: revision.channels.publicChangelog,
        channelInAppWidget: revision.channels.inAppWidget,
        channelSubscriberEmail: revision.channels.subscriberEmail,
        authorId: authorIds[0] ?? existing.authorId ?? input.userId,
        updatedAt: new Date(),
      })
      .where(
        and(eq(releases.id, existing.id), eq(releases.productId, input.productId)),
      );

    await replaceTaxonomy(
      tx,
      input.productId,
      existing.id,
      revision.tags.join(", "),
      authorIds,
    );
    await replaceLinks(
      tx,
      input.productId,
      existing.id,
      revision.linkedFeedbackIds.filter((id) => validFeedback.has(id)),
      revision.linkedCancellationReasonIds.filter((id) => validReasons.has(id)),
    );

    const snapshot = await loadReleaseSnapshot(tx, input.productId, existing.id);
    if (!snapshot) return { ok: false as const, error: "Could not restore the revision." };

    await recordReleaseRevision(tx, {
      productId: input.productId,
      releaseId: existing.id,
      action: "restore",
      createdBy: input.userId,
      snapshot,
    });
    return { ok: true as const, snapshot };
  });
}
