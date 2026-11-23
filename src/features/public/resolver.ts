import "server-only";

import { and, eq, isNull, or } from "drizzle-orm";

import { db } from "@/db";
import { boards, products, workspaces } from "@/db/schema";

import {
  hasFeature,
  toPlanId,
  type PlanId,
} from "@/features/entitlements/plans";

import {
  boardMatchesSegments,
  loadBoardAccessRules,
  loadViewerSegments,
} from "./access";
import type { ResolvedPublicBoard, ResolvedPublicProduct } from "./types";

/**
 * Resolve a public board from the URL path without a session.
 *
 * Resolution is a single query over boards → products → workspaces, with
 * visibility and archive state in the WHERE clause. Unknown workspaces,
 * unknown products, private boards and archived boards all produce `null`,
 * which callers turn into a 404 — never a 403 that would disclose that a
 * private board exists.
 */
export async function resolvePublicBoard(input: {
  workspaceSlug: string;
  productSlug: string;
  boardSlug: string;
  /**
   * Visitor whose segments are checked against the board's access rules.
   * Omitted means anonymous, which is denied on any gated board — the safe
   * default, so a new call site cannot accidentally expose one.
   */
  viewerCustomerId?: string | null;
}): Promise<ResolvedPublicBoard | null> {
  const rows = await db
    .select({
      workspace: {
        id: workspaces.id,
        name: workspaces.name,
        slug: workspaces.slug,
        plan: workspaces.plan,
        publicPlannedFor: workspaces.publicPlannedFor,
      },
      product: {
        id: products.id,
        name: products.name,
        slug: products.slug,
        description: products.description,
        publicFeedbackEnabled: products.publicFeedbackEnabled,
        publicRoadmapEnabled: products.publicRoadmapEnabled,
        publicChangelogEnabled: products.publicChangelogEnabled,
        publicShippedCounterEnabled: products.publicShippedCounterEnabled,
      },
      board: {
        id: boards.id,
        name: boards.name,
        slug: boards.slug,
        description: boards.description,
        guestPosting: boards.guestPosting,
        icon: boards.icon,
        color: boards.color,
        settings: boards.settings,
      },
    })
    .from(boards)
    .innerJoin(products, eq(boards.productId, products.id))
    .innerJoin(workspaces, eq(products.workspaceId, workspaces.id))
    .where(
      and(
        eq(workspaces.slug, input.workspaceSlug),
        eq(products.slug, input.productSlug),
        eq(products.publicFeedbackEnabled, true),
        eq(boards.slug, input.boardSlug),
        eq(boards.visibility, "public"),
        isNull(boards.archivedAt),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  // Segment gating is evaluated here, once, for every public entry point. A
  // visitor who does not match learns nothing: the board is the same 404 as an
  // unknown one, so gating never discloses that the board exists.
  const accessRules = await loadBoardAccessRules(row.board.id);
  if (accessRules.length > 0) {
    const segments = await loadViewerSegments({
      workspaceId: row.workspace.id,
      customerId: input.viewerCustomerId ?? null,
    });
    if (!boardMatchesSegments(accessRules, segments)) return null;
  }

  const plan = toPlanId(row.workspace.plan);

  return {
    ...row,
    workspace: { ...row.workspace, plan },
    board: {
      ...row.board,
      // A downgraded workspace keeps the stored setting but loses the
      // capability; every public write path reads this resolved value.
      guestPosting: row.board.guestPosting && hasFeature(plan, "guestPosting"),
    },
  };
}

/**
 * Resolve a product that has published its public roadmap.
 *
 * The roadmap is independent of public feedback: a product may keep its
 * boards private and still publish a planned/in-progress/shipped view. The
 * query only returns products whose roadmap toggle is on; the page then
 * applies the same board, moderation and request visibility rules as every
 * other public projection.
 */
export async function resolvePublicProduct(input: {
  workspaceSlug: string;
  productSlug: string;
}): Promise<ResolvedPublicProduct | null> {
  const rows = await db
    .select({
      workspace: {
        id: workspaces.id,
        name: workspaces.name,
        slug: workspaces.slug,
        plan: workspaces.plan,
        publicPlannedFor: workspaces.publicPlannedFor,
      },
      product: {
        id: products.id,
        name: products.name,
        slug: products.slug,
        description: products.description,
        publicFeedbackEnabled: products.publicFeedbackEnabled,
        publicRoadmapEnabled: products.publicRoadmapEnabled,
        publicChangelogEnabled: products.publicChangelogEnabled,
        publicShippedCounterEnabled: products.publicShippedCounterEnabled,
      },
    })
    .from(products)
    .innerJoin(workspaces, eq(products.workspaceId, workspaces.id))
    .where(
      and(
        eq(workspaces.slug, input.workspaceSlug),
        eq(products.slug, input.productSlug),
        eq(products.publicRoadmapEnabled, true),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    ...row,
    workspace: { ...row.workspace, plan: toPlanId(row.workspace.plan) },
  };
}

/**
 * Resolve a product with any public customer surface enabled.
 *
 * The portal and its search span help, feedback, updates and the roadmap, so
 * the old roadmap-only resolver is too narrow for it. A product with every
 * public switch off still resolves to `null` and 404s.
 */
export async function resolvePublicPortalProduct(input: {
  workspaceSlug: string;
  productSlug: string;
}): Promise<ResolvedPublicProduct | null> {
  const rows = await db
    .select({
      workspace: {
        id: workspaces.id,
        name: workspaces.name,
        slug: workspaces.slug,
        plan: workspaces.plan,
        publicPlannedFor: workspaces.publicPlannedFor,
      },
      product: {
        id: products.id,
        name: products.name,
        slug: products.slug,
        description: products.description,
        publicFeedbackEnabled: products.publicFeedbackEnabled,
        publicRoadmapEnabled: products.publicRoadmapEnabled,
        publicChangelogEnabled: products.publicChangelogEnabled,
        publicShippedCounterEnabled: products.publicShippedCounterEnabled,
      },
    })
    .from(products)
    .innerJoin(workspaces, eq(products.workspaceId, workspaces.id))
    .where(
      and(
        eq(workspaces.slug, input.workspaceSlug),
        eq(products.slug, input.productSlug),
        or(
          eq(products.publicFeedbackEnabled, true),
          eq(products.publicRoadmapEnabled, true),
          eq(products.publicChangelogEnabled, true),
        ),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    ...row,
    workspace: { ...row.workspace, plan: toPlanId(row.workspace.plan) },
  };
}

/**
 * Resolve a product that has published its public changelog.
 *
 * Changelog visibility is independent of feedback and the roadmap: a team can
 * publish release notes while keeping both request surfaces private.
 */
export async function resolvePublicChangelogProduct(input: {
  workspaceSlug: string;
  productSlug: string;
}): Promise<ResolvedPublicProduct | null> {
  const rows = await db
    .select({
      workspace: {
        id: workspaces.id,
        name: workspaces.name,
        slug: workspaces.slug,
        plan: workspaces.plan,
        publicPlannedFor: workspaces.publicPlannedFor,
      },
      product: {
        id: products.id,
        name: products.name,
        slug: products.slug,
        description: products.description,
        publicFeedbackEnabled: products.publicFeedbackEnabled,
        publicRoadmapEnabled: products.publicRoadmapEnabled,
        publicChangelogEnabled: products.publicChangelogEnabled,
        publicShippedCounterEnabled: products.publicShippedCounterEnabled,
      },
    })
    .from(products)
    .innerJoin(workspaces, eq(products.workspaceId, workspaces.id))
    .where(
      and(
        eq(workspaces.slug, input.workspaceSlug),
        eq(products.slug, input.productSlug),
        eq(products.publicChangelogEnabled, true),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    ...row,
    workspace: { ...row.workspace, plan: toPlanId(row.workspace.plan) },
  };
}

/**
 * Resolve a workspace that has at least one public board.
 *
 * Customer sessions are only useful where a public site exists; limiting the
 * bootstrap to workspaces with a public, non-archived board avoids creating
 * sessions for private or empty workspaces.
 */
export async function resolvePublicWorkspace(
  workspaceSlug: string,
): Promise<{ id: string; name: string; slug: string; plan: PlanId } | null> {
  const rows = await db
    .selectDistinct({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      plan: workspaces.plan,
    })
    .from(workspaces)
    .innerJoin(products, eq(products.workspaceId, workspaces.id))
    .innerJoin(boards, eq(boards.productId, products.id))
    .where(
      and(
        eq(workspaces.slug, workspaceSlug),
        eq(products.publicFeedbackEnabled, true),
        eq(boards.visibility, "public"),
        isNull(boards.archivedAt),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}
