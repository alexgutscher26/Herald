import "server-only";

import { getFeedbackSnapshot, listFeedbackSavedViews } from "@/db/queries/feedback";
import { buildSegmentFacets } from "@/features/public/segments";
import { countActiveSubscribers, listReleasesForProduct } from "@/db/queries/releases";
import { listCancellationReasonsForProduct } from "@/db/queries/winback";
import {
  listWorkspaceSummaries,
  listWorkspaceTeamMembers,
} from "@/db/queries/workspaces";
import type { Product as DbProduct, Workspace as DbWorkspace } from "@/db/schema";
import type { AuthedUser, ProductContext } from "@/lib/authz";
import { DEFAULT_WORKSPACE_TIMEZONE } from "@/lib/workspace-time";
import type {
  DashboardState,
  Product,
  Release,
  Workspace,
  WorkspaceMember,
} from "@/types";

/**
 * Build the serialisable dashboard snapshot.
 *
 * Every record here comes from Postgres. Sections without a query of their own
 * are absent from the snapshot and render an explicit "not implemented" page.
 *
 * This snapshot is computed on the server for every request. It contains no
 * session tokens or secrets, only the data the current member is already
 * authorized to read.
 */

const ACCENT_COLOR = "#4f46e5";

function iso(date: Date): string {
  return date.toISOString();
}

function mapWorkspace(row: DbWorkspace): Workspace {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    timezone: DEFAULT_WORKSPACE_TIMEZONE,
    createdAt: iso(row.createdAt),
  };
}

function mapProduct(row: DbProduct): Product {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    slug: row.slug,
    description: row.description ?? "",
    accentColor: ACCENT_COLOR,
    publicFeedbackEnabled: row.publicFeedbackEnabled,
    publicRoadmapEnabled: row.publicRoadmapEnabled,
    publicChangelogEnabled: row.publicChangelogEnabled,
    createdAt: iso(row.createdAt),
  };
}

function mapMemberships(
  summaries: Awaited<ReturnType<typeof listWorkspaceSummaries>>,
  user: AuthedUser,
): WorkspaceMember[] {
  return summaries.map((summary) => ({
    workspaceId: summary.workspace.id,
    email: user.email,
    role: summary.role,
  }));
}

export async function loadDashboardSnapshot(context: ProductContext): Promise<DashboardState> {
  const { user, workspace, product } = context;
  const summaries = await listWorkspaceSummaries(user.id);

  const [
    releaseRecords,
    feedback,
    cancellationReasons,
    activeSubscribers,
    savedViews,
    teamMembers,
  ] = await Promise.all([
    listReleasesForProduct(product.id),
    getFeedbackSnapshot(product.id),
    listCancellationReasonsForProduct(workspace.id, product.id),
    countActiveSubscribers(product.id),
    listFeedbackSavedViews(product.id, user.id),
    listWorkspaceTeamMembers(workspace.id),
  ]);

  const releases: Release[] = releaseRecords.map((release) => ({ ...release }));

  return {
    currentUser: { id: user.id, name: user.name, email: user.email },
    liveNow: new Date().toISOString(),
    activeSubscriberCounts: { [product.id]: activeSubscribers },
    workspaces: summaries.map((summary) => mapWorkspace(summary.workspace)),
    workspaceMembers: mapMemberships(summaries, user),
    teamMembers,
    products: summaries.flatMap((summary) => summary.products.map((row) => mapProduct(row))),
    releases,
    feedbackPosts: feedback.posts,
    feedbackVotes: feedback.votes,
    feedbackComments: feedback.comments,
    feedbackTags: feedback.tags,
    feedbackTagLinks: feedback.tagLinks,
    feedbackCustomFields: feedback.customFields,
    feedbackCustomFieldValues: feedback.customFieldValues,
    feedbackPrioritisation: feedback.prioritisation,
    feedbackFollowers: feedback.followers,
    feedbackInsights: feedback.insights,
    feedbackContextLinks: feedback.contextLinks,
    helpArticles: feedback.helpArticles,
    customerRevenue: feedback.customerRevenue,
    customerSegments: feedback.customerSegments,
    segmentFacets: buildSegmentFacets(feedback.customerSegments),
    feedbackSavedViews: savedViews,
    cancellationReasons,
  };
}
