import "server-only";

import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  boards,
  customers,
  feedbackPosts,
  products,
  publicRoadmaps,
  roadmapBoards,
  workspaces,
} from "@/db/schema";
import { publicSurfaceEnabled } from "@/features/entitlements/entitlements";
import { toPlanId } from "@/features/entitlements/plans";

import { loadAccessiblePublicBoards } from "./access";
import type { PublicRoadmapSort } from "./query";
import { resolvePublicProduct } from "./resolver";
import type {
  PublicRoadmapCard,
  PublicRoadmapPage,
  PublicRoadmapStatus,
} from "./types";

/**
 * Public roadmap projection.
 *
 * The columns are a view of `feedback_posts.status`; a published roadmap only
 * chooses which public boards are in scope. There is no second status to keep
 * in sync, and a segment-gated board is evaluated for the current visitor.
 */

const ROADMAP_STATUSES: PublicRoadmapStatus[] = ["planned", "in_progress", "shipped"];

function latestPostModerationSql() {
  return sql<string | null>`(
    SELECT mr.status::text
    FROM moderation_reviews mr
    WHERE mr.content_type = 'feedback_post'
      AND mr.content_id = ${feedbackPosts.id}
    ORDER BY mr.created_at DESC
    LIMIT 1
  )`;
}

function voteCountSql() {
  return sql<number>`(
    ${feedbackPosts.importedVoteCount}
    + (
      SELECT count(*)::int FROM feedback_votes fv
      WHERE fv.feedback_post_id = ${feedbackPosts.id}
    )
    + (
      SELECT count(*)::int FROM feedback_customer_votes fcv
      WHERE fcv.feedback_post_id = ${feedbackPosts.id}
    )
  )`;
}

/** Published views a crawler or the public switcher may list. */
export async function listPublishedRoadmaps(
  productId: string,
  options: { includeUnlisted?: boolean } = {},
) {
  return db
    .select({
      id: publicRoadmaps.id,
      name: publicRoadmaps.name,
      slug: publicRoadmaps.slug,
      description: publicRoadmaps.description,
      visibility: publicRoadmaps.visibility,
      updatedAt: publicRoadmaps.updatedAt,
    })
    .from(publicRoadmaps)
    .where(
      and(
        eq(publicRoadmaps.productId, productId),
        isNotNull(publicRoadmaps.publishedAt),
        options.includeUnlisted ? undefined : eq(publicRoadmaps.visibility, "public"),
      ),
    )
    .orderBy(asc(publicRoadmaps.position), asc(publicRoadmaps.name));
}

export async function listPublicRoadmapSitemapEntries(): Promise<
  {
    workspaceSlug: string;
    productSlug: string;
    roadmapSlug: string;
    lastModified: Date;
  }[]
> {
  const rows = await db
    .select({
      slug: publicRoadmaps.slug,
      updatedAt: publicRoadmaps.updatedAt,
      productSlug: products.slug,
      workspaceSlug: workspaces.slug,
      plan: workspaces.plan,
    })
    .from(publicRoadmaps)
    .innerJoin(products, eq(publicRoadmaps.productId, products.id))
    .innerJoin(workspaces, eq(products.workspaceId, workspaces.id))
    .where(
      and(
        isNotNull(publicRoadmaps.publishedAt),
        eq(publicRoadmaps.visibility, "public"),
        eq(products.publicRoadmapEnabled, true),
      ),
    )
    .orderBy(asc(workspaces.slug), asc(products.slug), asc(publicRoadmaps.position));

  return rows
    .filter((row) => publicSurfaceEnabled(toPlanId(row.plan)))
    .map((row) => ({
      workspaceSlug: row.workspaceSlug,
      productSlug: row.productSlug,
      roadmapSlug: row.slug,
      lastModified: row.updatedAt,
    }));
}

export async function getPublicRoadmapPage(input: {
  workspaceSlug: string;
  productSlug: string;
  roadmapSlug?: string | null;
  viewerCustomerId?: string | null;
  /** Public ordering: recently updated (default) or most voted. */
  sort?: PublicRoadmapSort;
}): Promise<PublicRoadmapPage | null> {
  const tenant = await resolvePublicProduct(input);
  if (!tenant || !publicSurfaceEnabled(tenant.workspace.plan)) return null;

  const published = await listPublishedRoadmaps(tenant.product.id, {
    includeUnlisted: true,
  });
  const requestedSlug = input.roadmapSlug?.trim() || null;
  const selected = requestedSlug
    ? (published.find((roadmap) => roadmap.slug === requestedSlug) ?? null)
    : (published.find((roadmap) => roadmap.visibility === "public") ?? null);

  if (requestedSlug && !selected) return null;

  let selectedBoardIds: string[] | null = null;
  if (selected) {
    const boardRows = await db
      .select({ boardId: roadmapBoards.boardId })
      .from(roadmapBoards)
      .where(eq(roadmapBoards.roadmapId, selected.id));
    selectedBoardIds = boardRows.map((row) => row.boardId);

    // A roadmap that names boards the visitor cannot see is a 404, not an empty
    // page: disclosing its existence would defeat segment gating.
    const accessible = await loadAccessiblePublicBoards({
      productId: tenant.product.id,
      workspaceId: tenant.workspace.id,
      viewerCustomerId: input.viewerCustomerId ?? null,
      boardIds: selectedBoardIds,
    });
    if (selectedBoardIds.length > 0 && accessible.length === 0) return null;
  }

  const accessibleBoards = await loadAccessiblePublicBoards({
    productId: tenant.product.id,
    workspaceId: tenant.workspace.id,
    viewerCustomerId: input.viewerCustomerId ?? null,
    boardIds: selectedBoardIds ?? undefined,
  });
  const boardIds = accessibleBoards.map((board) => board.id);

  const latest = latestPostModerationSql();
  const requireApproval = sql<string>`coalesce(${boards.settings} #>> '{moderation,requireApproval}', 'none')`;
  const visible = and(
    eq(feedbackPosts.productId, tenant.product.id),
    boardIds.length === 0 ? sql`false` : inArray(feedbackPosts.boardId, boardIds),
    eq(boards.visibility, "public"),
    isNull(boards.archivedAt),
    isNull(feedbackPosts.archivedAt),
    isNull(feedbackPosts.hiddenAt),
    isNull(feedbackPosts.mergedIntoId),
    isNull(customers.bannedAt),
    eq(feedbackPosts.privacy, "public"),
    sql`case when ${requireApproval} = 'none' then ${latest} is distinct from 'rejected' else ${latest} = 'approved' end`,
  );

  const rowsFor = async (status: PublicRoadmapStatus): Promise<PublicRoadmapCard[]> => {
    if (boardIds.length === 0) return [];
    const orderBy =
      input.sort === "votes"
        ? [desc(voteCountSql()), desc(feedbackPosts.updatedAt)]
        : [desc(feedbackPosts.updatedAt), desc(feedbackPosts.id)];
    const rows = await db
      .select({
        id: feedbackPosts.id,
        title: feedbackPosts.title,
        boardSlug: boards.slug,
        boardName: boards.name,
        voteCount: voteCountSql(),
      })
      .from(feedbackPosts)
      .innerJoin(boards, eq(feedbackPosts.boardId, boards.id))
      .leftJoin(customers, eq(feedbackPosts.authorCustomerId, customers.id))
      .where(and(visible, eq(feedbackPosts.status, status)))
      .orderBy(...orderBy)
      .limit(200);

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      status,
      voteCount: row.voteCount,
      boardSlug: row.boardSlug,
      boardName: row.boardName,
    }));
  };

  const [planned, inProgress, shipped] = await Promise.all([
    rowsFor("planned"),
    rowsFor("in_progress"),
    rowsFor("shipped"),
  ]);

  const byStatus: Record<PublicRoadmapStatus, PublicRoadmapCard[]> = {
    planned,
    in_progress: inProgress,
    shipped,
  };

  return {
    workspace: { name: tenant.workspace.name, slug: tenant.workspace.slug },
    product: {
      name: tenant.product.name,
      slug: tenant.product.slug,
      description: tenant.product.description,
    },
    sort: input.sort ?? "recent",
    roadmap: selected
      ? {
          name: selected.name,
          slug: selected.slug,
          description: selected.description,
          visibility: selected.visibility,
        }
      : {
          name: "Roadmap",
          slug: null,
          description: null,
          visibility: "public",
        },
    roadmaps: published
      .filter((roadmap) => roadmap.visibility === "public")
      .map((roadmap) => ({
        name: roadmap.name,
        slug: roadmap.slug,
      })),
    columns: ROADMAP_STATUSES.map((status) => ({
      status,
      requests: byStatus[status],
    })),
    firstBoard:
      tenant.product.publicFeedbackEnabled && accessibleBoards[0]
        ? { name: accessibleBoards[0].name, slug: accessibleBoards[0].slug }
        : null,
    changelogEnabled: tenant.product.publicChangelogEnabled,
  };
}
