"use server";

import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { pushFeedbackStatusToIssueTracker } from "@/features/integrations/issue-service";
import { invalidateAllPublicReleases } from "@/features/public/payload-cache";
import { z } from "zod";

import { db } from "@/db";
import {
  releaseAuthors,
  releaseTagLinks,
  releases,
} from "@/db/schema/releases";
import { recordFirstRelease } from "@/features/analytics/signup-funnel";
import { normalizeReleaseTranslations } from "@/features/i18n/content";
import { authorizeProductAction } from "@/features/live/action-auth";
import type { ActionResult } from "@/features/live/action-result";
import { queueReleaseInAppNotifications } from "@/features/notifications/service";
import { createReleaseSuggestions } from "@/features/winback/suggestions";
import { validateSlug } from "@/lib/slug";
import type { ReleaseCategory } from "@/types";

import { coverInputSchema as coverSchema } from "./cover";
import { releaseTranslationsSchema } from "./release-schema";
import { socialImageKeySchema } from "./social-image";
import type {
  AutosaveReleaseInput,
  ReleaseMutationInput,
  ReleaseMutationResult,
  SaveReleaseInput,
} from "./action-types";
import {
  applyPublishedFeedbackEffects,
  queueReleaseDeliveries,
} from "./publish-effects";
import {
  ensureInitialRevision,
  loadReleaseSnapshot,
  recordReleaseRevision,
} from "./revision-service";
import { snapshotFromInput } from "./revision-types";
import { normalizeYouTubeUrl, youTubeVideoId } from "./youtube";
import {
  isUniqueViolation,
  loadRelease,
  replaceLinks,
  replaceTaxonomy,
  validateAuthors,
  validateLinkedRecords,
} from "./write-support";

/**
 * Release server actions.
 *
 * Every action:
 *   1. validates a serializable payload with Zod,
 *   2. resolves the product through `requireProductContext` (session +
 *      membership + permission),
 *   3. scopes every write by the authorized product/workspace id,
 *   4. returns a serializable result or error.
 *
 * Publishing is deliberately side-effect limited: it records pending
 * subscriber deliveries and marks linked feedback shipped. It never approves,
 * schedules or sends a win-back campaign.
 */

const releaseInputSchema = z
  .object({
    workspaceSlug: z.string().min(1),
    productSlug: z.string().min(1),
    releaseId: z.uuid().optional(),
    title: z.string().trim().min(3, "Give the release a title of at least 3 characters.").max(120),
    slug: z.string().superRefine((value, context) => {
      const result = validateSlug(value);
      if (!result.ok) context.addIssue({ code: "custom", message: result.reason });
    }),
    summary: z.string().trim().min(10, "Write a summary of at least 10 characters.").max(280),
    body: z.string().min(20, "The changelog body needs at least 20 characters."),
    translations: releaseTranslationsSchema,
    category: z.enum(["feature", "improvement", "fix"] satisfies ReleaseCategory[]),
    tagsText: z.string().max(400),
    authorIds: z
      .array(z.string().min(1))
      .max(20)
      .transform((ids) => [...new Set(ids)]),
    youtubeUrl: z
      .string()
      .trim()
      .max(500)
      .refine(
        (value) => value === "" || youTubeVideoId(value) !== null,
        "Use a YouTube watch, share, shorts or embed link.",
      ),
    cover: coverSchema,
    ogImageKey: socialImageKeySchema.nullable(),
    channels: z
      .object({
        publicChangelog: z.boolean(),
        inAppWidget: z.boolean(),
        subscriberEmail: z.boolean(),
      })
      .refine(
        (channels) =>
          channels.publicChangelog || channels.inAppWidget || channels.subscriberEmail,
        { message: "Choose at least one distribution channel." },
      ),
    linkedFeedbackIds: z.array(z.uuid()).max(200).transform((ids) => [...new Set(ids)]),
    linkedCancellationReasonIds: z
      .array(z.uuid())
      .max(200)
      .transform((ids) => [...new Set(ids)]),
    destination: z.enum(["draft", "publish", "schedule"]),
    scheduledFor: z.string().nullable(),
  })
  .superRefine((value, context) => {
    if (value.destination !== "schedule") return;
    if (!value.scheduledFor) {
      context.addIssue({
        code: "custom",
        path: ["scheduledFor"],
        message: "Choose a date and time before scheduling.",
      });
      return;
    }
    const scheduled = new Date(value.scheduledFor);
    if (Number.isNaN(scheduled.getTime())) {
      context.addIssue({
        code: "custom",
        path: ["scheduledFor"],
        message: "Choose a valid date and time.",
      });
      return;
    }
    if (scheduled.getTime() <= Date.now()) {
      context.addIssue({
        code: "custom",
        path: ["scheduledFor"],
        message: "The schedule must be in the future.",
      });
    }
  });

const autosaveInputSchema = z.object({
  workspaceSlug: z.string().min(1),
  productSlug: z.string().min(1),
  releaseId: z.uuid().optional(),
  title: z.string().trim().min(1, "Add a title before autosaving.").max(120),
  slug: z.string().superRefine((value, context) => {
    const result = validateSlug(value);
    if (!result.ok) context.addIssue({ code: "custom", message: result.reason });
  }),
  summary: z.string().max(280),
  body: z.string().max(200_000),
  translations: releaseTranslationsSchema,
  category: z.enum(["feature", "improvement", "fix"] satisfies ReleaseCategory[]),
  tagsText: z.string().max(400),
  authorIds: z
    .array(z.string().min(1))
    .max(20)
    .transform((ids) => [...new Set(ids)]),
  youtubeUrl: z
    .string()
    .trim()
    .max(500)
    .refine((value) => value === "" || youTubeVideoId(value) !== null),
  cover: coverSchema,
  ogImageKey: socialImageKeySchema.nullable(),
  channels: z.object({
    publicChangelog: z.boolean(),
    inAppWidget: z.boolean(),
    subscriberEmail: z.boolean(),
  }),
  linkedFeedbackIds: z.array(z.uuid()).max(200).transform((ids) => [...new Set(ids)]),
  linkedCancellationReasonIds: z
    .array(z.uuid())
    .max(200)
    .transform((ids) => [...new Set(ids)]),
});

const mutationSchema = z.object({
  workspaceSlug: z.string().min(1),
  productSlug: z.string().min(1),
  releaseId: z.uuid("That release id is not valid."),
});

function fieldErrors(error: z.ZodError): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    result[key] = [...(result[key] ?? []), issue.message];
  }
  return result;
}

type ShippedRequest = { id: string; fromStatus: string };

/**
 * Push "shipped" to the issue tracker for requests a publication just shipped.
 * Runs after the publish transaction commits and never throws; a tracker outage
 * must not turn a successful publication into a failed action.
 */
async function pushShippedRequestsToTrackers(
  productId: string,
  shipped: ShippedRequest[],
): Promise<void> {
  for (const request of shipped.slice(0, 50)) {
    await pushFeedbackStatusToIssueTracker({
      productId,
      feedbackPostId: request.id,
      fromStatus: request.fromStatus,
      toStatus: "shipped",
    });
  }
}

function revalidate(workspaceSlug: string, productSlug: string) {
  revalidatePath(`/app/${workspaceSlug}/${productSlug}`, "layout");
  // The public changelog reads an immutable payload cache; a release write is
  // the only thing that can change it, so flush it here for every write path.
  invalidateAllPublicReleases();
}

export async function saveReleaseAction(
  input: SaveReleaseInput,
): Promise<ActionResult<ReleaseMutationResult>> {
  const parsed = releaseInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted release fields.",
      fieldErrors: fieldErrors(parsed.error),
    };
  }
  const value = parsed.data;
  const translations = normalizeReleaseTranslations(value.translations);

  const authorized = await authorizeProductAction(
    value.workspaceSlug,
    value.productSlug,
    "release:write",
  );
  if ("error" in authorized) return authorized.error;
  const { context } = authorized;
  const { product, workspace, user } = context;

  const now = new Date();
  const status: "draft" | "scheduled" | "published" =
    value.destination === "publish"
      ? "published"
      : value.destination === "schedule"
        ? "scheduled"
        : "draft";
  const scheduledFor =
    status === "scheduled" && value.scheduledFor ? new Date(value.scheduledFor) : null;
  let shippedByPublish: ShippedRequest[] = [];

  try {
    const result = await db.transaction(async (tx) => {
      const existing = value.releaseId
        ? await loadRelease(tx, product.id, value.releaseId)
        : null;
      if (value.releaseId && !existing) {
        return { ok: false as const, error: "That release no longer exists." };
      }

      const conflict = await tx
        .select({ id: releases.id })
        .from(releases)
        .where(
          and(
            eq(releases.productId, product.id),
            eq(releases.slug, value.slug),
            existing ? ne(releases.id, existing.id) : undefined,
          ),
        )
        .limit(1);
      if (conflict[0]) {
        return {
          ok: false as const,
          error: "That slug is already used by another release in this product.",
          fieldErrors: { slug: ["That slug is already used by another release."] },
        };
      }

      const linkError = await validateLinkedRecords(
        tx,
        product.id,
        workspace.id,
        value.linkedFeedbackIds,
        value.linkedCancellationReasonIds,
      );
      if (linkError) return { ok: false as const, error: linkError };

      const authorError = await validateAuthors(tx, workspace.id, value.authorIds);
      if (authorError) return { ok: false as const, error: authorError };

      if (existing) {
        // Preserve the state before the first edit so a pre-publish diff has a
        // baseline even for releases created before revisions existed.
        await ensureInitialRevision(tx, { productId: product.id, releaseId: existing.id });
      }

      const wasPublished = existing?.status === "published";
      const publishedAt =
        status === "published" ? (existing?.publishedAt ?? now) : (existing?.publishedAt ?? null);

      const row = {
        productId: product.id,
        title: value.title,
        slug: value.slug,
        summary: value.summary,
        bodyMarkdown: value.body,
        translations,
        status,
        category: value.category,
        youtubeUrl: normalizeYouTubeUrl(value.youtubeUrl),
        cover: value.cover,
        ogImageKey: value.ogImageKey,
        channelPublicChangelog: value.channels.publicChangelog,
        channelInAppWidget: value.channels.inAppWidget,
        channelSubscriberEmail: value.channels.subscriberEmail,
        publishedAt,
        scheduledFor,
        authorId: value.authorIds[0] ?? existing?.authorId ?? user.id,
        updatedAt: now,
      } satisfies typeof releases.$inferInsert;

      let releaseId: string;
      if (existing) {
        const updated = await tx
          .update(releases)
          .set(row)
          .where(and(eq(releases.id, existing.id), eq(releases.productId, product.id)))
          .returning({ id: releases.id });
        if (!updated[0]) return { ok: false as const, error: "That release no longer exists." };
        releaseId = updated[0].id;
      } else {
        const inserted = await tx.insert(releases).values(row).returning({ id: releases.id });
        if (!inserted[0]) return { ok: false as const, error: "Could not create the release." };
        releaseId = inserted[0].id;
      }

      await replaceLinks(
        tx,
        product.id,
        releaseId,
        value.linkedFeedbackIds,
        value.linkedCancellationReasonIds,
      );
      await replaceTaxonomy(
        tx,
        product.id,
        releaseId,
        value.tagsText,
        value.authorIds,
      );

      if (status === "published" && !wasPublished) {
        shippedByPublish = await applyPublishedFeedbackEffects(tx, product.id, releaseId, now);
        await queueReleaseInAppNotifications(tx, {
          workspaceId: workspace.id,
          productId: product.id,
          releaseId,
        });
        if (value.channels.subscriberEmail) {
          await queueReleaseDeliveries(tx, {
            workspaceId: workspace.id,
            productId: product.id,
            releaseId,
          });
        }
      }

      await recordReleaseRevision(tx, {
        productId: product.id,
        releaseId,
        action:
          status === "published"
            ? wasPublished
              ? "update"
              : "publish"
            : status === "scheduled"
              ? "schedule"
              : "save",
        createdBy: user.id,
        snapshot: snapshotFromInput({
          title: value.title,
          slug: value.slug,
          summary: value.summary,
          body: value.body,
          translations,
          category: value.category,
          cover: value.cover,
          ogImageKey: value.ogImageKey,
          youtubeUrl: normalizeYouTubeUrl(value.youtubeUrl),
          channels: value.channels,
          tagsText: value.tagsText,
          authorIds: value.authorIds,
          linkedFeedbackIds: value.linkedFeedbackIds,
          linkedCancellationReasonIds: value.linkedCancellationReasonIds,
          status,
          scheduledFor,
          publishedAt,
        }),
      });

      return {
        ok: true as const,
        data: {
          releaseId,
          status,
        },
      };
    });

    if (result.ok && result.data.status === "published") {
      await pushShippedRequestsToTrackers(product.id, shippedByPublish);
      await recordFirstRelease(product.id);
    }
    if (result.ok) revalidate(value.workspaceSlug, value.productSlug);
    return result;
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        ok: false,
        error: "That slug is already used by another release in this product.",
        fieldErrors: { slug: ["That slug is already used by another release."] },
      };
    }
    console.error("[releases] save failed", error);
    return { ok: false, error: "Could not save the release. Please try again." };
  }
}

/**
 * Quiet autosave for the editor.
 *
 * Unlike `saveReleaseAction`, this never changes publication state: a
 * published release stays published, a scheduled one keeps its time, and a new
 * entry becomes a private draft. Validation is deliberately looser for the
 * summary and body, because an autosave may run before the entry is finished.
 */
export async function autosaveReleaseAction(
  input: AutosaveReleaseInput,
): Promise<ActionResult<ReleaseMutationResult>> {
  const parsed = autosaveInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Could not autosave those fields.",
      fieldErrors: fieldErrors(parsed.error),
    };
  }
  const value = parsed.data;
  const translations = normalizeReleaseTranslations(value.translations);

  const authorized = await authorizeProductAction(
    value.workspaceSlug,
    value.productSlug,
    "release:write",
  );
  if ("error" in authorized) return authorized.error;
  const { context } = authorized;
  const { product, workspace, user } = context;
  const now = new Date();

  try {
    const result = await db.transaction(async (tx) => {
      const existing = value.releaseId
        ? await loadRelease(tx, product.id, value.releaseId)
        : null;
      if (value.releaseId && !existing) {
        return { ok: false as const, error: "That release no longer exists." };
      }
      if (existing?.status === "archived") {
        return { ok: false as const, error: "Archived releases are read-only." };
      }

      if (existing) {
        await ensureInitialRevision(tx, { productId: product.id, releaseId: existing.id });
      }

      const conflict = await tx
        .select({ id: releases.id })
        .from(releases)
        .where(
          and(
            eq(releases.productId, product.id),
            eq(releases.slug, value.slug),
            existing ? ne(releases.id, existing.id) : undefined,
          ),
        )
        .limit(1);
      if (conflict[0]) {
        return {
          ok: false as const,
          error: "That slug is already used by another release in this product.",
          fieldErrors: { slug: ["That slug is already used by another release."] },
        };
      }

      const linkError = await validateLinkedRecords(
        tx,
        product.id,
        workspace.id,
        value.linkedFeedbackIds,
        value.linkedCancellationReasonIds,
      );
      if (linkError) return { ok: false as const, error: linkError };

      const authorError = await validateAuthors(tx, workspace.id, value.authorIds);
      if (authorError) return { ok: false as const, error: authorError };

      const content = {
        title: value.title,
        slug: value.slug,
        summary: value.summary,
        bodyMarkdown: value.body,
        translations,
        category: value.category,
        cover: value.cover,
        ogImageKey: value.ogImageKey,
        youtubeUrl: normalizeYouTubeUrl(value.youtubeUrl),
        channelPublicChangelog: value.channels.publicChangelog,
        channelInAppWidget: value.channels.inAppWidget,
        channelSubscriberEmail: value.channels.subscriberEmail,
        authorId: value.authorIds[0] ?? existing?.authorId ?? user.id,
        updatedAt: now,
      };

      let releaseId: string;
      if (existing) {
        const updated = await tx
          .update(releases)
          .set(content)
          .where(and(eq(releases.id, existing.id), eq(releases.productId, product.id)))
          .returning({ id: releases.id });
        if (!updated[0]) return { ok: false as const, error: "That release no longer exists." };
        releaseId = updated[0].id;
      } else {
        const inserted = await tx
          .insert(releases)
          .values({
            ...content,
            productId: product.id,
            status: "draft",
            publishedAt: null,
            scheduledFor: null,
          })
          .returning({ id: releases.id });
        if (!inserted[0]) return { ok: false as const, error: "Could not create the draft." };
        releaseId = inserted[0].id;
      }

      await replaceLinks(
        tx,
        product.id,
        releaseId,
        value.linkedFeedbackIds,
        value.linkedCancellationReasonIds,
      );
      await replaceTaxonomy(tx, product.id, releaseId, value.tagsText, value.authorIds);

      const savedStatus = (existing?.status ?? "draft") as ReleaseMutationResult["status"];
      await recordReleaseRevision(tx, {
        productId: product.id,
        releaseId,
        action: "autosave",
        createdBy: user.id,
        snapshot: snapshotFromInput({
          title: value.title,
          slug: value.slug,
          summary: value.summary,
          body: value.body,
          translations,
          category: value.category,
          cover: value.cover,
          ogImageKey: value.ogImageKey,
          youtubeUrl: normalizeYouTubeUrl(value.youtubeUrl),
          channels: value.channels,
          tagsText: value.tagsText,
          authorIds: value.authorIds,
          linkedFeedbackIds: value.linkedFeedbackIds,
          linkedCancellationReasonIds: value.linkedCancellationReasonIds,
          status: savedStatus,
          scheduledFor: existing?.scheduledFor ?? null,
          publishedAt: existing?.publishedAt ?? null,
        }),
      });

      return {
        ok: true as const,
        data: {
          releaseId,
          status: savedStatus,
        },
      };
    });

    if (result.ok) revalidate(value.workspaceSlug, value.productSlug);
    return result;
  } catch (error) {
    console.error("[releases] autosave failed", error);
    return { ok: false, error: "Could not autosave the release." };
  }
}

export async function publishReleaseAction(
  input: ReleaseMutationInput,
): Promise<ActionResult<ReleaseMutationResult>> {
  const parsed = mutationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That release id is not valid." };

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "release:write",
  );
  if ("error" in authorized) return authorized.error;
  const { context } = authorized;
  const { product, user, workspace } = context;
  const now = new Date();
  let shippedByPublish: ShippedRequest[] = [];

  try {
    const result = await db.transaction(async (tx) => {
      const existing = await loadRelease(tx, product.id, parsed.data.releaseId);
      if (!existing) return { ok: false as const, error: "That release no longer exists." };
      if (existing.status === "archived") {
        return {
          ok: false as const,
          error: "Restore this release from the archive before publishing it.",
        };
      }

      await ensureInitialRevision(tx, { productId: product.id, releaseId: existing.id });
      const wasPublished = existing.status === "published";
      if (!wasPublished) {
        await tx
          .update(releases)
          .set({ status: "published", publishedAt: existing.publishedAt ?? now, scheduledFor: null, updatedAt: now })
          .where(and(eq(releases.id, existing.id), eq(releases.productId, product.id)));

        shippedByPublish = await applyPublishedFeedbackEffects(tx, product.id, existing.id, now);
        await queueReleaseInAppNotifications(tx, {
          workspaceId: workspace.id,
          productId: product.id,
          releaseId: existing.id,
        });
        if (existing.channelSubscriberEmail) {
          await queueReleaseDeliveries(tx, {
            workspaceId: workspace.id,
            productId: product.id,
            releaseId: existing.id,
          });
        }
        await createReleaseSuggestions(tx, {
          workspaceId: workspace.id,
          productId: product.id,
          releaseId: existing.id,
        });
      }

      const snapshot = await loadReleaseSnapshot(tx, product.id, existing.id);
      if (snapshot) {
        await recordReleaseRevision(tx, {
          productId: product.id,
          releaseId: existing.id,
          action: wasPublished ? "update" : "publish",
          createdBy: user.id,
          snapshot,
        });
      }

      return {
        ok: true as const,
        data: {
          releaseId: existing.id,
          status: "published" as ReleaseMutationResult["status"],
        },
      };
    });

    if (result.ok) {
      await pushShippedRequestsToTrackers(product.id, shippedByPublish);
      await recordFirstRelease(product.id);
    }
    if (result.ok) revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return result;
  } catch (error) {
    console.error("[releases] publish failed", error);
    return { ok: false, error: "Could not publish the release. Please try again." };
  }
}

export async function archiveReleaseAction(
  input: ReleaseMutationInput,
): Promise<ActionResult<ReleaseMutationResult>> {
  return setReleaseStatus(input, "archived");
}

export async function restoreReleaseAction(
  input: ReleaseMutationInput,
): Promise<ActionResult<ReleaseMutationResult>> {
  const parsed = mutationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That release id is not valid." };

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "release:write",
  );
  if ("error" in authorized) return authorized.error;
  const { product } = authorized.context;

  try {
    const result = await db.transaction(async (tx) => {
      const existing = await loadRelease(tx, product.id, parsed.data.releaseId);
      if (!existing) return { ok: false as const, error: "That release no longer exists." };
      await ensureInitialRevision(tx, { productId: product.id, releaseId: existing.id });
      const status: ReleaseMutationResult["status"] = existing.publishedAt
        ? "published"
        : "draft";
      await tx
        .update(releases)
        .set({ status, updatedAt: new Date() })
        .where(and(eq(releases.id, existing.id), eq(releases.productId, product.id)));
      const snapshot = await loadReleaseSnapshot(tx, product.id, existing.id);
      if (snapshot) {
        await recordReleaseRevision(tx, {
          productId: product.id,
          releaseId: existing.id,
          action: "restore",
          createdBy: authorized.context.user.id,
          snapshot,
        });
      }
      return { ok: true as const, data: { releaseId: existing.id, status } };
    });
    if (result.ok) revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return result;
  } catch (error) {
    console.error("[releases] restore failed", error);
    return { ok: false, error: "Could not restore the release. Please try again." };
  }
}

async function setReleaseStatus(
  input: ReleaseMutationInput,
  status: "archived",
): Promise<ActionResult<ReleaseMutationResult>> {
  const parsed = mutationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That release id is not valid." };

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "release:write",
  );
  if ("error" in authorized) return authorized.error;
  const { product } = authorized.context;

  try {
    const result = await db.transaction(async (tx) => {
      const existing = await loadRelease(tx, product.id, parsed.data.releaseId);
      if (!existing) return { ok: false as const, error: "That release no longer exists." };
      await ensureInitialRevision(tx, { productId: product.id, releaseId: existing.id });
      await tx
        .update(releases)
        .set({ status, updatedAt: new Date() })
        .where(and(eq(releases.id, existing.id), eq(releases.productId, product.id)));
      const snapshot = await loadReleaseSnapshot(tx, product.id, existing.id);
      if (snapshot) {
        await recordReleaseRevision(tx, {
          productId: product.id,
          releaseId: existing.id,
          action: "archive",
          createdBy: authorized.context.user.id,
          snapshot,
        });
      }
      return { ok: true as const, data: { releaseId: existing.id, status } };
    });
    if (result.ok) revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return result;
  } catch (error) {
    console.error("[releases] status change failed", error);
    return { ok: false, error: `Could not ${status === "archived" ? "archive" : "update"} the release.` };
  }
}

export async function duplicateReleaseAction(
  input: ReleaseMutationInput,
): Promise<ActionResult<{ releaseId: string }>> {
  const parsed = mutationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That release id is not valid." };

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "release:write",
  );
  if ("error" in authorized) return authorized.error;
  const { context } = authorized;
  const { product, user } = context;

  try {
    const result = await db.transaction(async (tx) => {
      const source = await loadRelease(tx, product.id, parsed.data.releaseId);
      if (!source) return { ok: false as const, error: "That release no longer exists." };

      const baseSlug = validateSlug(`${source.slug}-copy`).ok
        ? `${source.slug}-copy`
        : `${source.slug.slice(0, 43)}-copy`;
      let candidate = baseSlug;
      let counter = 2;
      while (true) {
        const conflict = await tx
          .select({ id: releases.id })
          .from(releases)
          .where(and(eq(releases.productId, product.id), eq(releases.slug, candidate)))
          .limit(1);
        if (!conflict[0]) break;
        candidate = `${baseSlug.slice(0, 43)}-${counter}`;
        counter += 1;
      }

      const inserted = await tx
        .insert(releases)
        .values({
          productId: product.id,
          title: `${source.title} (copy)`,
          slug: candidate,
          summary: source.summary,
          bodyMarkdown: source.bodyMarkdown,
          translations: source.translations,
          status: "draft",
          category: source.category,
          cover: source.cover,
          ogImageKey: source.ogImageKey,
          youtubeUrl: source.youtubeUrl,
          channelPublicChangelog: source.channelPublicChangelog,
          channelInAppWidget: source.channelInAppWidget,
          channelSubscriberEmail: source.channelSubscriberEmail,
          authorId: source.authorId ?? user.id,
          publishedAt: null,
          scheduledFor: null,
        })
        .returning({ id: releases.id });

      if (!inserted[0]) return { ok: false as const, error: "Could not duplicate the release." };
      const copyId = inserted[0].id;

      const [tagRows, authorRows] = await Promise.all([
        tx
          .select({ tagId: releaseTagLinks.tagId })
          .from(releaseTagLinks)
          .where(eq(releaseTagLinks.releaseId, source.id)),
        tx
          .select({ userId: releaseAuthors.userId, position: releaseAuthors.position })
          .from(releaseAuthors)
          .where(eq(releaseAuthors.releaseId, source.id)),
      ]);

      if (tagRows.length > 0) {
        await tx
          .insert(releaseTagLinks)
          .values(tagRows.map((row) => ({ releaseId: copyId, tagId: row.tagId, productId: product.id })))
          .onConflictDoNothing();
      }
      if (authorRows.length > 0) {
        await tx
          .insert(releaseAuthors)
          .values(
            authorRows.map((row) => ({
              releaseId: copyId,
              productId: product.id,
              userId: row.userId,
              position: row.position,
            })),
          )
          .onConflictDoNothing();
      }

      const snapshot = await loadReleaseSnapshot(tx, product.id, copyId);
      if (snapshot) {
        await recordReleaseRevision(tx, {
          productId: product.id,
          releaseId: copyId,
          action: "save",
          createdBy: user.id,
          snapshot,
        });
      }

      return { ok: true as const, data: { releaseId: copyId } };
    });

    if (result.ok) revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return result;
  } catch (error) {
    console.error("[releases] duplicate failed", error);
    return { ok: false, error: "Could not duplicate the release. Please try again." };
  }
}
