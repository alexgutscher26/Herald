import "server-only";

import { and, asc, count, desc, eq, exists, isNull, ne, or, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  boards,
  customers,
  feedbackPosts,
  releaseFeedbackLinks,
  releaseReactions,
  releases,
  releaseTagLinks,
  releaseTags,
} from "@/db/schema";
import { authorsForReleases, tagsForReleases } from "@/db/queries/releases";
import { publicSurfaceEnabled } from "@/features/entitlements/entitlements";
import { coverImageUrl } from "@/features/releases/cover-url";
import { normalizeReleaseTranslations } from "@/features/i18n/content";
import { pageOffset, paginationMeta } from "@/lib/pagination";

import { cachedPublicPayload, publicPayloadKeys } from "./payload-cache";

import {
  latestPostModerationSql,
  REACTION_KINDS,
  voteCountSql,
  type PublicViewer,
} from "./queries";
import { resolvePublicChangelogProduct } from "./resolver";
import { toPublicStatus } from "./serialize";
import type {
  PublicChangelogDetailPage,
  PublicChangelogEntry,
  PublicChangelogFilter,
  PublicChangelogLinkedRequest,
  PublicChangelogPage,
  PublicChangelogSummary,
  PublicReaction,
  PublicReactionKind,
  PublicReleaseCategory,
  PublicReleaseCover,
} from "./types";

/**
 * Public changelog projection.
 *
 * Only published releases explicitly distributed to the public changelog are
 * readable, and only while the product's independent switch is on. Drafts,
 * scheduled entries, archived entries and entries with the channel disabled
 * never enter the query, so they cannot leak through pagination, the sitemap or
 * RSS.
 */

const PAGE_SIZE = 20;
const RELEASE_CATEGORIES: readonly PublicReleaseCategory[] = ["feature", "improvement", "fix"];

type ReleaseRow = {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  bodyMarkdown: string | null;
  translations: unknown;
  category: string;
  /** Raw JSONB; resolved by `toPublicCover`, never trusted as a shape. */
  cover: unknown;
  ogImageKey: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  youtubeUrl: string | null;
};

function isoDate(value: Date | null): string {
  return (value ?? new Date()).toISOString();
}

/**
 * Public cover projection.
 *
 * The row stores a storage key; the public DTO carries a short-lived signed
 * URL so the image is served by the storage route. A pre-migration `data:`
 * URL still renders read-only until `bun run migrate:release-covers` rewrites
 * it; the database rejects any new one.
 */
function toPublicCover(value: unknown): PublicReleaseCover {
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
      return { kind: "custom", key: candidate.key, url: coverImageUrl(candidate.key) };
    }
    if (typeof candidate.dataUrl === "string") {
      return { kind: "custom", key: "", url: candidate.dataUrl };
    }
  }
  return { kind: "none" };
}

async function firstBoardSlug(productId: string): Promise<string | null> {
  const rows = await db
    .select({ slug: boards.slug })
    .from(boards)
    .where(
      and(
        eq(boards.productId, productId),
        eq(boards.visibility, "public"),
        isNull(boards.archivedAt),
      ),
    )
    .orderBy(asc(boards.position), asc(boards.name))
    .limit(1);
  return rows[0]?.slug ?? null;
}

function toSummary(
  row: ReleaseRow,
  tags: string[],
  authors: { id: string; name: string }[],
): PublicChangelogSummary {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    summary: row.summary ?? "",
    translations: normalizeReleaseTranslations(row.translations),
    category: row.category as PublicReleaseCategory,
    publishedAt: isoDate(row.publishedAt ?? row.createdAt),
    cover: toPublicCover(row.cover),
    ogImageUrl: row.ogImageKey ? coverImageUrl(row.ogImageKey) : null,
    tags,
    authors,
  };
}

/**
 * Shared public visibility predicates. Tags and categories narrow this base;
 * they never widen it, so a filtered feed cannot reveal a non-public release.
 */
function publicReleaseWhere(
  productId: string,
  filter: {
    tagId?: string | undefined;
    tagSlug?: string | undefined;
    category?: PublicReleaseCategory | undefined;
  } | null = null,
) {
  return and(
    eq(releases.productId, productId),
    eq(releases.status, "published"),
    eq(releases.channelPublicChangelog, true),
    filter?.category ? eq(releases.category, filter.category) : undefined,
    filter?.tagId
      ? exists(
          db
            .select({ one: sql`1` })
            .from(releaseTagLinks)
            .where(
              and(
                eq(releaseTagLinks.releaseId, releases.id),
                eq(releaseTagLinks.tagId, filter.tagId),
              ),
            ),
        )
      : undefined,
    filter?.tagSlug
      ? exists(
          db
            .select({ one: sql`1` })
            .from(releaseTagLinks)
            .innerJoin(releaseTags, eq(releaseTagLinks.tagId, releaseTags.id))
            .where(
              and(
                eq(releaseTagLinks.releaseId, releases.id),
                eq(releaseTags.productId, productId),
                eq(releaseTags.slug, filter.tagSlug),
              ),
            ),
        )
      : undefined,
  );
}

function filterCategory(filter: PublicChangelogFilter | null) {
  if (filter?.kind === "category") return { category: filter.category };
  if (filter?.kind === "tag") return { tagSlug: filter.tag.slug };
  return null;
}

function asCategory(value: string | null | undefined): PublicReleaseCategory | null {
  return value && RELEASE_CATEGORIES.includes(value as PublicReleaseCategory)
    ? (value as PublicReleaseCategory)
    : null;
}

async function findPublicTag(productId: string, slug: string) {
  const rows = await db
    .select({ id: releaseTags.id, name: releaseTags.name, slug: releaseTags.slug })
    .from(releaseTags)
    .where(and(eq(releaseTags.productId, productId), eq(releaseTags.slug, slug)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Linked requests shown as “Built from your feedback”.
 *
 * The join repeats the public board and moderation predicates instead of
 * trusting the link row. A hidden, merged, archived, banned-author or
 * unapproved request is omitted. A viewer may additionally see their own
 * pending request while it waits for review, which matches the request page's
 * receipt behaviour without exposing it to anyone else.
 */
async function linkedRequestsFor(
  releaseId: string,
  productId: string,
  viewer: PublicViewer | null,
): Promise<PublicChangelogLinkedRequest[]> {
  const latest = latestPostModerationSql();
  const requireApproval = sql<string>`coalesce(${boards.settings} #>> '{moderation,requireApproval}', 'none')`;
  const visible = sql`case when ${requireApproval} = 'none' then ${latest} is distinct from 'rejected' else ${latest} = 'approved' end`;
  const viewerPending =
    viewer === null
      ? null
      : and(
          eq(feedbackPosts.authorCustomerId, viewer.customerId),
          sql`${latest} = 'pending'`,
        );

  const rows = await db
    .select({
      id: feedbackPosts.id,
      title: feedbackPosts.title,
      status: feedbackPosts.status,
      boardSlug: boards.slug,
      settings: boards.settings,
      authorCustomerId: feedbackPosts.authorCustomerId,
      latestModeration: latest,
      voteCount: voteCountSql(),
    })
    .from(releaseFeedbackLinks)
    .innerJoin(feedbackPosts, eq(releaseFeedbackLinks.feedbackPostId, feedbackPosts.id))
    .innerJoin(boards, eq(feedbackPosts.boardId, boards.id))
    .leftJoin(customers, eq(feedbackPosts.authorCustomerId, customers.id))
    .where(
      and(
        eq(releaseFeedbackLinks.releaseId, releaseId),
        eq(feedbackPosts.productId, productId),
        eq(boards.visibility, "public"),
        isNull(boards.archivedAt),
        isNull(feedbackPosts.archivedAt),
        isNull(feedbackPosts.hiddenAt),
        isNull(feedbackPosts.mergedIntoId),
        isNull(customers.bannedAt),
        eq(feedbackPosts.privacy, "public"),
        viewerPending ? or(visible, viewerPending) : visible,
      ),
    )
    .orderBy(asc(feedbackPosts.title))
    .limit(50);

  return rows.map((row) => {
    const awaiting =
      row.latestModeration === "pending" &&
      row.settings.moderation.requireApproval !== "none" &&
      viewer !== null &&
      row.authorCustomerId === viewer.customerId;

    return {
      id: row.id,
      title: row.title,
      status: toPublicStatus(row.status),
      voteCount: row.voteCount,
      boardSlug: row.boardSlug,
      ...(awaiting ? { pending: true } : {}),
    };
  });
}

function releasedAt(row: ReleaseRow): number {
  return (row.publishedAt ?? row.createdAt).getTime();
}

/** Aggregate reaction counts, with the individual viewer's own state. */
async function reactionsFor(
  releaseId: string,
  customerId: string | null,
): Promise<PublicReaction[]> {
  const [counts, mine] = await Promise.all([
    db
      .select({ kind: releaseReactions.kind, value: count() })
      .from(releaseReactions)
      .where(eq(releaseReactions.releaseId, releaseId))
      .groupBy(releaseReactions.kind),
    customerId
      ? db
          .select({ kind: releaseReactions.kind })
          .from(releaseReactions)
          .where(
            and(
              eq(releaseReactions.releaseId, releaseId),
              eq(releaseReactions.customerId, customerId),
            ),
          )
      : Promise.resolve([] as { kind: PublicReactionKind }[]),
  ]);

  const byKind = new Map(counts.map((row) => [row.kind, row.value]));
  const viewerKinds = new Set(mine.map((row) => row.kind));
  return REACTION_KINDS.map((kind) => ({
    kind,
    count: byKind.get(kind) ?? 0,
    reacted: viewerKinds.has(kind),
  }));
}

/**
 * “If you liked this release…” picks nearby entries that share a tag (stronger)
 * or only the category. Both sides already passed the public predicates.
 */
async function relatedEntriesFor(
  productId: string,
  current: ReleaseRow,
  currentTags: string[],
): Promise<PublicChangelogSummary[]> {
  const candidates = await db
    .select({
      id: releases.id,
      title: releases.title,
      slug: releases.slug,
      summary: releases.summary,
      bodyMarkdown: releases.bodyMarkdown,
      translations: releases.translations,
      category: releases.category,
      cover: releases.cover,
      ogImageKey: releases.ogImageKey,
      publishedAt: releases.publishedAt,
      createdAt: releases.createdAt,
      youtubeUrl: releases.youtubeUrl,
    })
    .from(releases)
    .where(and(publicReleaseWhere(productId), ne(releases.id, current.id)))
    .orderBy(desc(releases.publishedAt), desc(releases.createdAt))
    .limit(40);
  if (candidates.length === 0) return [];

  const candidateTags = await tagsForReleases(candidates.map((row) => row.id));
  const ownTags = new Set(currentTags);
  const ranked = candidates
    .map((row) => {
      const shared = (candidateTags.get(row.id) ?? []).filter((tag) => ownTags.has(tag)).length;
      const categoryMatch = row.category === current.category ? 2 : 0;
      return { row, score: shared * 10 + categoryMatch };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) =>
      b.score === a.score ? releasedAt(b.row) - releasedAt(a.row) : b.score - a.score,
    )
    .slice(0, 3);
  if (ranked.length === 0) return [];

  const ids = ranked.map((candidate) => candidate.row.id);
  const authors = await authorsForReleases(ids);
  return ranked.map(({ row }) =>
    toSummary(row, candidateTags.get(row.id) ?? [], authors.get(row.id) ?? []),
  );
}

export async function getPublicChangelogPage(input: {
  workspaceSlug: string;
  productSlug: string;
  page?: number;
  pageSize?: number;
  tagSlug?: string;
  category?: string;
}): Promise<PublicChangelogPage | null> {
  const tenant = await resolvePublicChangelogProduct(input);
  if (!tenant || !publicSurfaceEnabled(tenant.workspace.plan)) return null;

  const pageSize = Math.min(Math.max(input.pageSize ?? PAGE_SIZE, 1), 50);
  const requestedPage = Math.max(input.page ?? 1, 1);
  const tag = input.tagSlug
    ? await findPublicTag(tenant.product.id, input.tagSlug)
    : null;
  if (input.tagSlug && !tag) return null;
  const category = asCategory(input.category);
  if (input.category && !category) return null;
  const filter: PublicChangelogFilter | null = tag
    ? { kind: "tag", tag: { name: tag.name, slug: tag.slug } }
    : category
      ? { kind: "category", category }
      : null;
  const where = publicReleaseWhere(tenant.product.id, {
    tagId: tag?.id,
    category: category ?? undefined,
  });

  const [totalRows, boardSlug] = await Promise.all([
    db.select({ value: count() }).from(releases).where(where),
    firstBoardSlug(tenant.product.id),
  ]);

  const total = totalRows[0]?.value ?? 0;
  const pagination = paginationMeta({
    page: requestedPage,
    pageSize,
    total,
  });

  const rows = await db
    .select({
      id: releases.id,
      title: releases.title,
      slug: releases.slug,
      summary: releases.summary,
      bodyMarkdown: releases.bodyMarkdown,
      translations: releases.translations,
      category: releases.category,
      cover: releases.cover,
      ogImageKey: releases.ogImageKey,
      publishedAt: releases.publishedAt,
      createdAt: releases.createdAt,
      youtubeUrl: releases.youtubeUrl,
    })
    .from(releases)
    .where(where)
    .orderBy(desc(releases.publishedAt), desc(releases.createdAt))
    .limit(pagination.pageSize)
    .offset(pageOffset(pagination.page, pagination.pageSize));

  const ids = rows.map((row) => row.id);
  const [tags, authors] = await Promise.all([tagsForReleases(ids), authorsForReleases(ids)]);

  return {
    workspace: { name: tenant.workspace.name, slug: tenant.workspace.slug },
    product: {
      name: tenant.product.name,
      slug: tenant.product.slug,
      description: tenant.product.description,
    },
    entries: rows.map((row) => toSummary(row, tags.get(row.id) ?? [], authors.get(row.id) ?? [])),
    filter,
    pagination,
    boardSlug,
    roadmapEnabled: tenant.product.publicRoadmapEnabled,
  };
}

/**
 * Immutable half of a changelog entry: the published row plus its tags and
 * authors. Viewer-dependent linked requests and the product switches stay live
 * so moderation, bans and merges apply on the next request. The cover key is
 * cached raw and signed per call, never as an expiring URL.
 */
async function loadPublicReleaseBase(productId: string, slug: string) {
  return cachedPublicPayload(publicPayloadKeys.releaseEntry(productId, slug), async () => {
    const rows = await db
      .select({
        id: releases.id,
        title: releases.title,
        slug: releases.slug,
        summary: releases.summary,
        bodyMarkdown: releases.bodyMarkdown,
        translations: releases.translations,
        category: releases.category,
        cover: releases.cover,
        ogImageKey: releases.ogImageKey,
        publishedAt: releases.publishedAt,
        createdAt: releases.createdAt,
        youtubeUrl: releases.youtubeUrl,
      })
      .from(releases)
      .where(
        and(
          eq(releases.productId, productId),
          eq(releases.slug, slug),
          eq(releases.status, "published"),
          eq(releases.channelPublicChangelog, true),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    const [tags, authors] = await Promise.all([
      tagsForReleases([row.id]),
      authorsForReleases([row.id]),
    ]);

    return { row, tags: tags.get(row.id) ?? [], authors: authors.get(row.id) ?? [] };
  });
}

export async function getPublicChangelogEntry(
  input: {
    workspaceSlug: string;
    productSlug: string;
    slug: string;
  },
  viewer: PublicViewer | null = null,
): Promise<PublicChangelogDetailPage | null> {
  const tenant = await resolvePublicChangelogProduct(input);
  if (!tenant || !publicSurfaceEnabled(tenant.workspace.plan)) return null;

  const base = await loadPublicReleaseBase(tenant.product.id, input.slug);
  if (!base) return null;

  const { row, tags, authors } = base;
  const effectiveViewer =
    viewer && viewer.workspaceId === tenant.workspace.id ? viewer : null;
  const canReact = effectiveViewer?.identified ?? false;

  const [boardSlug, linkedRequests, reactions, related] = await Promise.all([
    firstBoardSlug(tenant.product.id),
    linkedRequestsFor(row.id, tenant.product.id, effectiveViewer),
    reactionsFor(row.id, canReact ? effectiveViewer?.customerId ?? null : null),
    relatedEntriesFor(tenant.product.id, row, tags),
  ]);

  const entry: PublicChangelogEntry = {
    ...toSummary(row, tags, authors),
    body: row.bodyMarkdown ?? "",
    youtubeUrl: row.youtubeUrl,
    linkedRequests,
    canReact,
    reactions,
    related,
  };

  return {
    workspace: {
      id: tenant.workspace.id,
      name: tenant.workspace.name,
      slug: tenant.workspace.slug,
    },
    product: {
      id: tenant.product.id,
      name: tenant.product.name,
      slug: tenant.product.slug,
    },
    entry,
    boardSlug,
    roadmapEnabled: tenant.product.publicRoadmapEnabled,
  };
}

/**
 * All public changelog entries for a product, bounded for RSS and sitemap use.
 * The same predicates as the pages apply.
 */
export async function listPublicChangelogEntries(
  productId: string,
  limit = 50,
  filter: PublicChangelogFilter | null = null,
): Promise<PublicChangelogSummary[]> {
  const rows = await db
    .select({
      id: releases.id,
      title: releases.title,
      slug: releases.slug,
      summary: releases.summary,
      bodyMarkdown: releases.bodyMarkdown,
      translations: releases.translations,
      category: releases.category,
      cover: releases.cover,
      ogImageKey: releases.ogImageKey,
      publishedAt: releases.publishedAt,
      createdAt: releases.createdAt,
      youtubeUrl: releases.youtubeUrl,
    })
    .from(releases)
    .where(publicReleaseWhere(productId, filterCategory(filter)))
    .orderBy(desc(releases.publishedAt), desc(releases.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200));

  const ids = rows.map((row) => row.id);
  const [tags, authors] = await Promise.all([tagsForReleases(ids), authorsForReleases(ids)]);
  return rows.map((row) => toSummary(row, tags.get(row.id) ?? [], authors.get(row.id) ?? []));
}
