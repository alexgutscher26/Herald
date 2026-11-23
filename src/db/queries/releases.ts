import "server-only";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { feedbackPosts } from "@/db/schema/feedback";
import {
  releaseAuthors,
  releaseTagLinks,
  releaseTags,
  releases,
} from "@/db/schema/releases";
import { user } from "@/db/schema/auth";
import { releaseReasonLinks } from "@/db/schema/winback";
import { coverImageUrl } from "@/features/releases/cover-url";
import type { ReleaseTranslations } from "@/features/i18n/content";
import { releaseFeedbackLinks } from "@/db/schema/roadmap";
import { subscribers } from "@/db/schema/subscribers";
import type {
  ReleaseCategory,
  ReleaseCover,
  ReleaseSocialImage,
  ReleaseStatus,
} from "@/types";

/**
 * Release reads.
 *
 * Every function takes a `productId` that was already resolved through
 * `requireProductContext` by the caller. No function here accepts a workspace
 * id from the client or searches globally.
 */

export type ReleaseRecord = {
  id: string;
  productId: string;
  title: string;
  slug: string;
  summary: string;
  body: string;
  translations: ReleaseTranslations;
  category: ReleaseCategory;
  status: ReleaseStatus;
  cover: ReleaseCover;
  ogImage: ReleaseSocialImage | null;
  channels: {
    publicChangelog: boolean;
    inAppWidget: boolean;
    subscriberEmail: boolean;
  };
  publishedAt: string | null;
  scheduledFor: string | null;
  createdAt: string;
  updatedAt: string;
  authorName: string;
  authors: { id: string; name: string }[];
  tags: string[];
  youtubeUrl: string | null;
  linkedFeedbackIds: string[];
  linkedCancellationReasonIds: string[];
};

const RELEASE_STATUSES: ReleaseStatus[] = ["draft", "scheduled", "published", "archived"];
const RELEASE_CATEGORIES: ReleaseCategory[] = ["feature", "improvement", "fix"];

function asStatus(value: string): ReleaseStatus {
  return RELEASE_STATUSES.includes(value as ReleaseStatus)
    ? (value as ReleaseStatus)
    : "draft";
}

function asCategory(value: string): ReleaseCategory {
  return RELEASE_CATEGORIES.includes(value as ReleaseCategory)
    ? (value as ReleaseCategory)
    : "feature";
}

function asCover(value: unknown): ReleaseCover {
  if (!value || typeof value !== "object") return { kind: "none" };
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === "preset") {
    const preset = candidate.preset;
    if (preset === "grid" || preset === "orbit" || preset === "waves" || preset === "plain") {
      return { kind: "preset", preset };
    }
    return { kind: "none" };
  }
  if (candidate.kind === "custom") {
    if (typeof candidate.key === "string" && candidate.key.length > 0) {
      const url = coverImageUrl(candidate.key);
      return url
        ? { kind: "custom", key: candidate.key, url }
        : { kind: "custom", key: candidate.key };
    }
    // Rows written before covers moved into storage still hold a data: URL.
    // They render read-only, and the database check constraint rejects any new
    // write of one; `bun run migrate:release-covers` rewrites them.
    if (typeof candidate.dataUrl === "string") {
      return { kind: "custom", key: "", url: candidate.dataUrl };
    }
  }
  return { kind: "none" };
}

function asSocialImage(key: string | null): ReleaseSocialImage | null {
  if (!key) return null;
  return { key, url: coverImageUrl(key) };
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export async function tagsForReleases(
  releaseIds: string[],
): Promise<Map<string, string[]>> {
  const tags = new Map<string, string[]>();
  if (releaseIds.length === 0) return tags;

  const rows = await db
    .select({ releaseId: releaseTagLinks.releaseId, name: releaseTags.name })
    .from(releaseTagLinks)
    .innerJoin(releaseTags, eq(releaseTagLinks.tagId, releaseTags.id))
    .where(inArray(releaseTagLinks.releaseId, releaseIds))
    .orderBy(asc(releaseTags.name));

  for (const row of rows) {
    const current = tags.get(row.releaseId) ?? [];
    current.push(row.name);
    tags.set(row.releaseId, current);
  }
  return tags;
}

export async function authorsForReleases(
  releaseIds: string[],
): Promise<Map<string, { id: string; name: string }[]>> {
  const authors = new Map<string, { id: string; name: string }[]>();
  if (releaseIds.length === 0) return authors;

  const rows = await db
    .select({
      releaseId: releaseAuthors.releaseId,
      id: user.id,
      name: user.name,
      position: releaseAuthors.position,
    })
    .from(releaseAuthors)
    .innerJoin(user, eq(releaseAuthors.userId, user.id))
    .where(inArray(releaseAuthors.releaseId, releaseIds))
    .orderBy(asc(releaseAuthors.position), asc(user.name));

  for (const row of rows) {
    const current = authors.get(row.releaseId) ?? [];
    current.push({ id: row.id, name: row.name });
    authors.set(row.releaseId, current);
  }
  return authors;
}

export async function listReleasesForProduct(productId: string): Promise<ReleaseRecord[]> {
  const rows = await db
    .select({
      release: releases,
      authorName: user.name,
    })
    .from(releases)
    .leftJoin(user, eq(releases.authorId, user.id))
    .where(eq(releases.productId, productId))
    .orderBy(
      desc(
        sql`coalesce(${releases.publishedAt}, ${releases.scheduledFor}, ${releases.updatedAt})`,
      ),
    );

  const ids = rows.map((row) => row.release.id);
  if (ids.length === 0) return [];

  const [feedbackLinks, reasonLinks, tagsByRelease, authorsByRelease] = await Promise.all([
    db
      .select({
        releaseId: releaseFeedbackLinks.releaseId,
        feedbackPostId: releaseFeedbackLinks.feedbackPostId,
      })
      .from(releaseFeedbackLinks)
      .where(inArray(releaseFeedbackLinks.releaseId, ids)),
    db
      .select({
        releaseId: releaseReasonLinks.releaseId,
        cancellationReasonId: releaseReasonLinks.cancellationReasonId,
      })
      .from(releaseReasonLinks)
      .where(inArray(releaseReasonLinks.releaseId, ids)),
    tagsForReleases(ids),
    authorsForReleases(ids),
  ]);

  const feedbackByRelease = new Map<string, string[]>();
  for (const link of feedbackLinks) {
    const current = feedbackByRelease.get(link.releaseId) ?? [];
    current.push(link.feedbackPostId);
    feedbackByRelease.set(link.releaseId, current);
  }

  const reasonsByRelease = new Map<string, string[]>();
  for (const link of reasonLinks) {
    const current = reasonsByRelease.get(link.releaseId) ?? [];
    current.push(link.cancellationReasonId);
    reasonsByRelease.set(link.releaseId, current);
  }

  return rows.map(({ release, authorName }) => ({
    id: release.id,
    productId: release.productId,
    title: release.title,
    slug: release.slug,
    summary: release.summary ?? "",
    body: release.bodyMarkdown ?? "",
    translations: release.translations,
    category: asCategory(release.category),
    status: asStatus(release.status),
    cover: asCover(release.cover),
    ogImage: asSocialImage(release.ogImageKey),
    channels: {
      publicChangelog: release.channelPublicChangelog,
      inAppWidget: release.channelInAppWidget,
      subscriberEmail: release.channelSubscriberEmail,
    },
    publishedAt: iso(release.publishedAt),
    scheduledFor: iso(release.scheduledFor),
    createdAt: release.createdAt.toISOString(),
    updatedAt: release.updatedAt.toISOString(),
    authorName: authorsByRelease.get(release.id)?.[0]?.name ?? authorName ?? "Team",
    authors: authorsByRelease.get(release.id) ?? [],
    tags: tagsByRelease.get(release.id) ?? [],
    youtubeUrl: release.youtubeUrl,
    linkedFeedbackIds: feedbackByRelease.get(release.id) ?? [],
    linkedCancellationReasonIds: reasonsByRelease.get(release.id) ?? [],
  }));
}

export async function findReleaseForProduct(
  productId: string,
  releaseId: string,
): Promise<ReleaseRecord | null> {
  const rows = await db
    .select({ id: releases.id })
    .from(releases)
    .where(and(eq(releases.productId, productId), eq(releases.id, releaseId)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  // Reuse the list mapper so a single release and the list cannot drift.
  const all = await listReleasesForProduct(productId);
  return all.find((release) => release.id === row.id) ?? null;
}

export async function findReleaseBySlug(
  productId: string,
  slug: string,
): Promise<ReleaseRecord | null> {
  const rows = await db
    .select({ id: releases.id })
    .from(releases)
    .where(and(eq(releases.productId, productId), eq(releases.slug, slug)))
    .limit(1);
  const row = rows[0];
  return row ? findReleaseForProduct(productId, row.id) : null;
}

export async function listReleaseFeedbackOptions(productId: string): Promise<
  { id: string; title: string; status: string }[]
> {
  return db
    .select({ id: feedbackPosts.id, title: feedbackPosts.title, status: feedbackPosts.status })
    .from(feedbackPosts)
    .where(and(eq(feedbackPosts.productId, productId), sql`${feedbackPosts.mergedIntoId} is null`))
    .orderBy(asc(feedbackPosts.title));
}

/** Subscribers that would receive a release email, if email were connected. */
export async function countActiveSubscribers(productId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(subscribers)
    .where(and(eq(subscribers.productId, productId), eq(subscribers.status, "active")));
  return rows[0]?.count ?? 0;
}
