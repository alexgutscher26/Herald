import "server-only";

import { and, eq, ne } from "drizzle-orm";

import { db } from "@/db";
import { releases } from "@/db/schema/releases";
import { normalizeReleaseTranslations } from "@/features/i18n/content";
import { invalidateAllPublicReleases } from "@/features/public/payload-cache";

import type {
  ReleaseDraftCreateInput,
  ReleaseDraftUpdateInput,
} from "./draft-schema";
import {
  ensureInitialRevision,
  loadReleaseSnapshot,
  recordReleaseRevision,
} from "./revision-service";
import { normalizeYouTubeUrl } from "./youtube";
import {
  isUniqueViolation,
  loadRelease,
  replaceCancellationLinks,
  replaceFeedbackLinks,
  replaceReleaseAuthors,
  replaceReleaseTags,
  validateAuthors,
  validateLinkedRecords,
} from "./write-support";

/**
 * Draft writes from the API.
 *
 * The API is session-authenticated today, like the other `/api/app` routes.
 * Every write is scoped to the product and workspace resolved from the URL,
 * and only `draft` rows may be updated. Publishing, scheduling, archiving and
 * restoring stay in the editor actions.
 */

export type DraftWriteContext = {
  workspaceId: string;
  productId: string;
  userId: string;
};

export type DraftWriteResult =
  | { ok: true; releaseId: string }
  | {
      ok: false;
      status: 400 | 404 | 409 | 500;
      error: string;
      fieldErrors?: Record<string, string[]>;
    };

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function tagsText(tags: string[] | undefined): string {
  return (tags ?? []).join(", ");
}

export async function createReleaseDraft(
  context: DraftWriteContext,
  input: ReleaseDraftCreateInput,
): Promise<DraftWriteResult> {
  const authorIds = dedupe(input.authorIds ?? [context.userId]);
  const now = new Date();

  try {
    const result = await db.transaction(async (tx) => {
      const conflict = await tx
        .select({ id: releases.id })
        .from(releases)
        .where(and(eq(releases.productId, context.productId), eq(releases.slug, input.slug)))
        .limit(1);
      if (conflict[0]) {
        return {
          ok: false as const,
          status: 409 as const,
          error: "That slug is already used by another release in this product.",
          fieldErrors: { slug: ["That slug is already used by another release."] },
        };
      }

      const linkError = await validateLinkedRecords(
        tx,
        context.productId,
        context.workspaceId,
        input.linkedFeedbackIds ?? [],
        input.linkedCancellationReasonIds ?? [],
      );
      if (linkError) return { ok: false as const, status: 400 as const, error: linkError };

      const authorError = await validateAuthors(tx, context.workspaceId, authorIds);
      if (authorError) return { ok: false as const, status: 400 as const, error: authorError };

      const inserted = await tx
        .insert(releases)
        .values({
          productId: context.productId,
          title: input.title,
          slug: input.slug,
          summary: input.summary ?? "",
          bodyMarkdown: input.body ?? "",
          translations: normalizeReleaseTranslations(input.translations),
          status: "draft",
          category: input.category ?? "feature",
          cover: input.cover ?? { kind: "preset", preset: "grid" },
          ogImageKey: input.ogImageKey ?? null,
          channelPublicChangelog: input.channels?.publicChangelog ?? true,
          channelInAppWidget: input.channels?.inAppWidget ?? true,
          channelSubscriberEmail: input.channels?.subscriberEmail ?? true,
          youtubeUrl: normalizeYouTubeUrl(input.youtubeUrl ?? null),
          authorId: authorIds[0] ?? context.userId,
          publishedAt: null,
          scheduledFor: null,
          updatedAt: now,
        })
        .returning({ id: releases.id });

      const releaseId = inserted[0]?.id;
      if (!releaseId) {
        return {
          ok: false as const,
          status: 500 as const,
          error: "Could not create the draft.",
        };
      }

      await replaceReleaseTags(tx, context.productId, releaseId, tagsText(input.tags));
      await replaceReleaseAuthors(tx, context.productId, releaseId, authorIds);
      await replaceFeedbackLinks(
        tx,
        context.productId,
        releaseId,
        input.linkedFeedbackIds ?? [],
      );
      await replaceCancellationLinks(
        tx,
        releaseId,
        input.linkedCancellationReasonIds ?? [],
      );

      const snapshot = await loadReleaseSnapshot(tx, context.productId, releaseId);
      if (snapshot) {
        await recordReleaseRevision(tx, {
          productId: context.productId,
          releaseId,
          action: "save",
          createdBy: context.userId,
          snapshot,
        });
      }

      return { ok: true as const, releaseId };
    });

    return result;
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        ok: false,
        status: 409,
        error: "That slug is already used by another release in this product.",
        fieldErrors: { slug: ["That slug is already used by another release."] },
      };
    }
    console.error("[releases] draft create failed", error);
    return { ok: false, status: 500, error: "Could not create the draft." };
  }
}

export async function updateReleaseDraft(
  context: DraftWriteContext,
  releaseId: string,
  input: ReleaseDraftUpdateInput,
): Promise<DraftWriteResult> {
  const authorIds =
    input.authorIds === undefined ? undefined : dedupe(input.authorIds);

  try {
    const result = await db.transaction(async (tx) => {
      const existing = await loadRelease(tx, context.productId, releaseId);
      if (!existing) {
        return { ok: false as const, status: 404 as const, error: "Release not found." };
      }
      if (existing.status !== "draft") {
        return {
          ok: false as const,
          status: 409 as const,
          error: "Only drafts can be updated through the API. Publish from the editor.",
        };
      }

      const title = input.title ?? existing.title;
      const slug = input.slug ?? existing.slug;

      const conflict = await tx
        .select({ id: releases.id })
        .from(releases)
        .where(
          and(
            eq(releases.productId, context.productId),
            eq(releases.slug, slug),
            ne(releases.id, existing.id),
          ),
        )
        .limit(1);
      if (conflict[0]) {
        return {
          ok: false as const,
          status: 409 as const,
          error: "That slug is already used by another release in this product.",
          fieldErrors: { slug: ["That slug is already used by another release."] },
        };
      }

      if (input.linkedFeedbackIds !== undefined || input.linkedCancellationReasonIds !== undefined) {
        const linkError = await validateLinkedRecords(
          tx,
          context.productId,
          context.workspaceId,
          input.linkedFeedbackIds ?? [],
          input.linkedCancellationReasonIds ?? [],
        );
        if (linkError) return { ok: false as const, status: 400 as const, error: linkError };
      }

      if (authorIds !== undefined) {
        const authorError = await validateAuthors(tx, context.workspaceId, authorIds);
        if (authorError) return { ok: false as const, status: 400 as const, error: authorError };
      }

      await ensureInitialRevision(tx, {
        productId: context.productId,
        releaseId: existing.id,
      });

      const updated = await tx
        .update(releases)
        .set({
          title,
          slug,
          summary: input.summary ?? existing.summary,
          bodyMarkdown: input.body ?? existing.bodyMarkdown,
          translations:
            input.translations === undefined
              ? existing.translations
              : normalizeReleaseTranslations(input.translations),
          category: input.category ?? existing.category,
          cover: input.cover ?? existing.cover,
          ogImageKey:
            input.ogImageKey === undefined ? existing.ogImageKey : input.ogImageKey,
          channelPublicChangelog:
            input.channels?.publicChangelog ?? existing.channelPublicChangelog,
          channelInAppWidget:
            input.channels?.inAppWidget ?? existing.channelInAppWidget,
          channelSubscriberEmail:
            input.channels?.subscriberEmail ?? existing.channelSubscriberEmail,
          youtubeUrl:
            input.youtubeUrl === undefined
              ? existing.youtubeUrl
              : normalizeYouTubeUrl(input.youtubeUrl),
          authorId: authorIds?.[0] ?? existing.authorId ?? context.userId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(releases.id, existing.id),
            eq(releases.productId, context.productId),
            eq(releases.status, "draft"),
          ),
        )
        .returning({ id: releases.id });

      if (!updated[0]) {
        return {
          ok: false as const,
          status: 409 as const,
          error: "Only drafts can be updated through the API.",
        };
      }

      if (input.tags !== undefined) {
        await replaceReleaseTags(tx, context.productId, existing.id, tagsText(input.tags));
      }
      if (authorIds !== undefined) {
        await replaceReleaseAuthors(tx, context.productId, existing.id, authorIds);
      }
      if (input.linkedFeedbackIds !== undefined) {
        await replaceFeedbackLinks(
          tx,
          context.productId,
          existing.id,
          input.linkedFeedbackIds,
        );
      }
      if (input.linkedCancellationReasonIds !== undefined) {
        await replaceCancellationLinks(
          tx,
          existing.id,
          input.linkedCancellationReasonIds,
        );
      }

      const snapshot = await loadReleaseSnapshot(tx, context.productId, existing.id);
      if (snapshot) {
        await recordReleaseRevision(tx, {
          productId: context.productId,
          releaseId: existing.id,
          action: "save",
          createdBy: context.userId,
          snapshot,
        });
      }

      return { ok: true as const, releaseId: existing.id };
    });

    if (result.ok) invalidateAllPublicReleases();
    return result;
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        ok: false,
        status: 409,
        error: "That slug is already used by another release in this product.",
        fieldErrors: { slug: ["That slug is already used by another release."] },
      };
    }
    console.error("[releases] draft update failed", error);
    return { ok: false, status: 500, error: "Could not update the draft." };
  }
}
