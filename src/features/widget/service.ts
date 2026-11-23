import "server-only";

import { and, asc, eq, isNull, or } from "drizzle-orm";

import { db } from "@/db";
import { boards, products, workspaces } from "@/db/schema";
import { publicConversationUnreadCount } from "@/features/conversations/customer";
import { widgetSurfaceEnabled } from "@/features/entitlements/entitlements";
import { hasFeature, toPlanId } from "@/features/entitlements/plans";
import { publicUnreadNotificationCount } from "@/features/notifications/inbox";
import { teamPresence } from "@/features/operators/service";
import { getPublicViewerIdentity, type PublicViewerIdentity } from "@/features/public/viewer";
import { experiencePreviewMatches } from "@/features/engagement/preview";
import { widgetAccessAllowed } from "./policy";
import { readWidgetAccessSettings } from "./settings";

/**
 * Widget tenant resolution and shell data.
 *
 * The embed route never trusts the query string for a product id: it resolves
 * the two slugs through the same plan/flag gates as the public pages, then
 * hands only public projections to the panels. The widget is independently
 * switchable from the public site, but shares its customer session and
 * published/public-channel visibility rules.
 */

export type WidgetTenant = {
  workspace: { id: string; name: string; slug: string };
  product: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    publicFeedbackEnabled: boolean;
    publicRoadmapEnabled: boolean;
    publicChangelogEnabled: boolean;
  };
  boardSlug: string | null;
};

export type WidgetPanelAvailability = {
  help: boolean;
  feedback: boolean;
  roadmap: boolean;
  updates: boolean;
  messages: boolean;
  notifications: boolean;
};

export type WidgetShell = WidgetTenant & {
  viewer: PublicViewerIdentity | null;
  unread: number;
  presence: { online: boolean };
  panels: WidgetPanelAvailability;
  /** A valid preview link loaded this shell; nothing is tracked or gated. */
  preview: boolean;
};

async function firstPublicBoardSlug(productId: string): Promise<string | null> {
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

export async function resolveWidgetTenant(input: {
  workspaceSlug: string;
  productSlug: string;
}): Promise<WidgetTenant | null> {
  const rows = await db
    .select({
      workspaceId: workspaces.id,
      workspaceName: workspaces.name,
      workspaceSlug: workspaces.slug,
      plan: workspaces.plan,
      productId: products.id,
      productName: products.name,
      productSlug: products.slug,
      productDescription: products.description,
      publicFeedbackEnabled: products.publicFeedbackEnabled,
      publicRoadmapEnabled: products.publicRoadmapEnabled,
      publicChangelogEnabled: products.publicChangelogEnabled,
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

  const plan = toPlanId(row.plan);
  if (!widgetSurfaceEnabled(plan) || !hasFeature(plan, "widget")) return null;

  return {
    workspace: {
      id: row.workspaceId,
      name: row.workspaceName,
      slug: row.workspaceSlug,
    },
    product: {
      id: row.productId,
      name: row.productName,
      slug: row.productSlug,
      description: row.productDescription,
      publicFeedbackEnabled: row.publicFeedbackEnabled,
      publicRoadmapEnabled: row.publicRoadmapEnabled,
      publicChangelogEnabled: row.publicChangelogEnabled,
    },
    boardSlug: row.publicFeedbackEnabled
      ? await firstPublicBoardSlug(row.productId)
      : null,
  };
}

export async function loadWidgetShell(input: {
  workspaceSlug: string;
  productSlug: string;
  /** Public installation key and the embedding page's origin. */
  projectKey?: string | null;
  hostOrigin?: string | null;
  /** Live preview token from the loader; bypasses the origin allowlist only. */
  previewToken?: string | null;
  /** Test/fallback seam; production reads the first-party session cookie. */
  viewer?: PublicViewerIdentity | null;
}): Promise<WidgetShell | null> {
  const tenant = await resolveWidgetTenant(input);
  if (!tenant) return null;

  const access = await readWidgetAccessSettings(tenant.workspace.id);
  const preview = input.previewToken
    ? await experiencePreviewMatches(input.previewToken, tenant.product.id)
    : false;
  if (
    !preview &&
    !widgetAccessAllowed(
      access,
      input.projectKey ?? null,
      input.hostOrigin ?? null,
    )
  ) {
    return null;
  }

  const [viewer, online] = await Promise.all([
    input.viewer !== undefined
      ? Promise.resolve(input.viewer)
      : getPublicViewerIdentity(tenant.workspace.slug),
    teamPresence(tenant.workspace.id),
  ]);

  const [notificationUnread, messageUnread] = viewer
    ? await Promise.all([
        publicUnreadNotificationCount({
          workspaceSlug: tenant.workspace.slug,
          productSlug: tenant.product.slug,
        }),
        publicConversationUnreadCount({
          workspaceSlug: tenant.workspace.slug,
          productSlug: tenant.product.slug,
        }),
      ])
    : [0, 0];
  const unread = notificationUnread + messageUnread;

  return {
    ...tenant,
    viewer,
    unread,
    presence: { online },
    preview,
    panels: {
      help:
        tenant.product.publicFeedbackEnabled ||
        tenant.product.publicRoadmapEnabled ||
        tenant.product.publicChangelogEnabled,
      feedback: tenant.boardSlug !== null,
      roadmap: tenant.product.publicRoadmapEnabled,
      updates: tenant.product.publicChangelogEnabled,
      messages: true,
      notifications: true,
    },
  };
}

/** The resolved board used by the feedback panel and compose links. */
export async function widgetBoardSlug(
  tenant: WidgetTenant,
  requested: string | null,
): Promise<string | null> {
  if (!tenant.product.publicFeedbackEnabled) return null;
  if (requested) {
    const rows = await db
      .select({ slug: boards.slug })
      .from(boards)
      .where(
        and(
          eq(boards.productId, tenant.product.id),
          eq(boards.slug, requested),
          eq(boards.visibility, "public"),
          isNull(boards.archivedAt),
        ),
      )
      .limit(1);
    return rows[0]?.slug ?? null;
  }
  return tenant.boardSlug;
}
