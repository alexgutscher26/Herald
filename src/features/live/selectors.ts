import {
  computeSignals,
  distinctRequesters,
  sumKnownRevenue,
} from "@/features/feedback/prioritisation";
import type {
  CancellationReason,
  CustomerSegment,
  CustomFieldDefinition,
  CustomFieldValue,
  DashboardState,
  FeedbackComment,
  FeedbackPost,
  FeedbackPrioritisation,
  FeedbackVote,
  PrioritySignals,
  Product,
  Release,
  Workspace,
  WorkspaceMember,
} from "@/types";
import type { WorkspaceRole } from "@/lib/permissions";

/**
 * Pure selectors over the dashboard snapshot.
 *
 * Components never read raw arrays directly; they call these functions so
 * tenant scoping, derived counts and cross-entity rules live in one place.
 */

/* -------------------------------------------------------------------------- */
/* Context                                                                    */
/* -------------------------------------------------------------------------- */

export function getWorkspaceBySlug(state: DashboardState, slug: string): Workspace | null {
  return state.workspaces.find((workspace) => workspace.slug === slug) ?? null;
}

export function getProductBySlugs(
  state: DashboardState,
  workspaceSlug: string,
  productSlug: string,
): Product | null {
  const workspace = getWorkspaceBySlug(state, workspaceSlug);
  if (!workspace) return null;
  return (
    state.products.find(
      (product) => product.workspaceId === workspace.id && product.slug === productSlug,
    ) ?? null
  );
}

export function getWorkspaceById(state: DashboardState, workspaceId: string): Workspace | null {
  return state.workspaces.find((workspace) => workspace.id === workspaceId) ?? null;
}

export function getProductsForWorkspace(state: DashboardState, workspaceId: string): Product[] {
  return state.products.filter((product) => product.workspaceId === workspaceId);
}

export function getMembership(
  state: DashboardState,
  workspaceId: string,
): WorkspaceMember | null {
  return (
    state.workspaceMembers.find(
      (member) => member.workspaceId === workspaceId && member.email === state.currentUser.email,
    ) ?? null
  );
}

export function getEffectiveRole(state: DashboardState, workspaceId: string): WorkspaceRole {
  return getMembership(state, workspaceId)?.role ?? "editor";
}

export type RouteContext = {
  workspace: Workspace;
  product: Product;
  membership: WorkspaceMember | null;
  role: WorkspaceRole;
};

export function getRouteContext(
  state: DashboardState,
  workspaceSlug: string,
  productSlug: string,
): RouteContext | null {
  const product = getProductBySlugs(state, workspaceSlug, productSlug);
  if (!product) return null;
  const workspace = getWorkspaceById(state, product.workspaceId);
  if (!workspace) return null;
  return {
    workspace,
    product,
    membership: getMembership(state, workspace.id),
    role: getEffectiveRole(state, workspace.id),
  };
}

export type SwitcherWorkspaceView = {
  id: string;
  name: string;
  slug: string;
  role: WorkspaceRole;
  products: { id: string; name: string; slug: string }[];
};

export function getSwitcherWorkspaces(state: DashboardState): SwitcherWorkspaceView[] {
  return state.workspaces
    .map((workspace) => {
      const membership = getMembership(state, workspace.id);
      if (!membership) return null;
      return {
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
        role: getEffectiveRole(state, workspace.id),
        products: getProductsForWorkspace(state, workspace.id).map((product) => ({
          id: product.id,
          name: product.name,
          slug: product.slug,
        })),
      };
    })
    .filter((workspace): workspace is SwitcherWorkspaceView => workspace !== null);
}

/* -------------------------------------------------------------------------- */
/* Entity lookups                                                             */
/* -------------------------------------------------------------------------- */

export function getReleasesForProduct(state: DashboardState, productId: string): Release[] {
  return state.releases
    .filter((release) => release.productId === productId)
    .sort((a, b) => {
      const aDate = a.publishedAt ?? a.scheduledFor ?? a.updatedAt;
      const bDate = b.publishedAt ?? b.scheduledFor ?? b.updatedAt;
      return new Date(bDate).getTime() - new Date(aDate).getTime();
    });
}

export function getFeedbackForProduct(state: DashboardState, productId: string): FeedbackPost[] {
  return state.feedbackPosts
    .filter((post) => post.productId === productId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function getFeedbackById(state: DashboardState, postId: string): FeedbackPost | null {
  return state.feedbackPosts.find((post) => post.id === postId) ?? null;
}

export function getVotesForPost(state: DashboardState, postId: string): FeedbackVote[] {
  return state.feedbackVotes.filter((vote) => vote.postId === postId);
}

export function getVoteCount(state: DashboardState, postId: string): number {
  return getVotesForPost(state, postId).length;
}

export function hasUserVoted(state: DashboardState, postId: string): boolean {
  return state.feedbackVotes.some(
    (vote) => vote.postId === postId && vote.voterKey === state.currentUser.id,
  );
}

export function getCommentsForPost(state: DashboardState, postId: string): FeedbackComment[] {
  return state.feedbackComments
    .filter((comment) => comment.postId === postId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export function getCancellationReasons(
  state: DashboardState,
  productId: string,
): CancellationReason[] {
  return state.cancellationReasons.filter((reason) => reason.productId === productId);
}

export function getActiveSubscriberCount(state: DashboardState, productId: string): number {
  return state.activeSubscriberCounts[productId] ?? 0;
}

/* -------------------------------------------------------------------------- */
/* Custom fields and prioritisation                                           */
/* -------------------------------------------------------------------------- */

export function getCustomFieldsForProduct(
  state: DashboardState,
  productId: string,
): CustomFieldDefinition[] {
  return state.feedbackCustomFields.filter((field) => field.productId === productId);
}

export function getCustomFieldValuesForPost(
  state: DashboardState,
  postId: string,
): CustomFieldValue[] {
  return state.feedbackCustomFieldValues.filter((value) => value.postId === postId);
}

export function getPrioritisationForPost(
  state: DashboardState,
  postId: string,
): FeedbackPrioritisation | null {
  return state.feedbackPrioritisation.find((row) => row.postId === postId) ?? null;
}

/**
 * Signals for one request.
 *
 * Requesters are the customer author, customer voters, customer commenters
 * and followers — one unit per person, never per vote. Team votes and imported
 * vote totals are excluded because neither identifies a customer. Revenue is
 * summed once per company from stored traits.
 */
/**
 * Distinct customer requesters for one request.
 *
 * Team votes and imported vote totals never identify a customer, so neither
 * counts. The same list feeds requester weight and segment filtering.
 */
export function getRequestersForPost(state: DashboardState, postId: string): string[] {
  const post = getFeedbackById(state, postId);
  return distinctRequesters({
    authorCustomerId: post?.authorCustomerId ?? null,
    customerVoteIds: state.feedbackVotes
      .filter((vote) => vote.postId === postId && vote.voterType === "customer")
      .map((vote) => vote.voterKey),
    commentCustomerIds: state.feedbackComments
      .filter((comment) => comment.postId === postId && !comment.internal)
      .map((comment) => comment.authorCustomerId),
    followerCustomerIds: state.feedbackFollowers
      .filter((follower) => follower.postId === postId)
      .map((follower) => follower.customerId),
  });
}

/** Stored traits for the requesters of one request, in snapshot order. */
export function getRequesterSegmentsForPost(
  state: DashboardState,
  postId: string,
): CustomerSegment[] {
  const ids = new Set(getRequestersForPost(state, postId));
  return state.customerSegments.filter((segment) => ids.has(segment.customerId));
}

export function getPrioritySignals(
  state: DashboardState,
  postId: string,
): PrioritySignals {
  const requesters = getRequestersForPost(state, postId);
  const stored = getPrioritisationForPost(state, postId);
  const known = sumKnownRevenue(requesters, state.customerRevenue);

  return computeSignals({
    impact: stored?.impact ?? null,
    businessValue: stored?.businessValue ?? null,
    effort: stored?.effort ?? null,
    requesterCount: requesters.length,
    knownArr: known.annualRevenue,
    knownOpenDealValue: known.openDealValue,
    knownWeightBasis: known.weightBasis,
  });
}
