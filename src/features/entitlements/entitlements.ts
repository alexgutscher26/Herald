import "server-only";

import { and, count, eq, gte, isNull, ne, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  boards,
  crmConnections,
  issueTrackerConnections,
  junoUsage,
  notificationDeliveries,
  products,
  slackIntegrations,
  supportToolConnections,
  surveyImpressions,
  webhooks,
  workspaceMembers,
  workspaceSubscriptions,
  workspaces,
} from "@/db/schema";

import { isFeatureEnabled } from "./flags";
import {
  checkUsage,
  hasFeature,
  planLimit,
  planDefinition,
  toPlanId,
  type PlanFeature,
  type PlanId,
  type PlanLimit,
  type UsageCheck,
} from "./plans";

/**
 * Server-side entitlement gates.
 *
 * Every function here resolves the plan from the database using the
 * workspace/product id the caller already authorized — never from request
 * input. Public surfaces call `publicSurfaceEnabled` with the plan returned by
 * the resolver so a lookup cannot be widened by a query parameter.
 *
 * Billing is the source of truth once a workspace has a subscription row:
 * `trialing`, `active`, one-time `lifetime`, and `past_due`/`unpaid` while
 * their seven-day dunning grace is still open keep a paid plan. A workspace
 * without a billing row keeps its existing `workspaces.plan` value so manual
 * plans and pre-billing fixtures continue to work.
 */

export type WorkspaceUsage = {
  /** Non-archived products in the workspace. */
  products: number;
  /** Non-archived boards across those products. */
  boards: number;
  /** Paid team seats: owners, admins and editors; viewers are free. */
  members: number;
  /** Free read/comment-only stakeholders, shown separately and not capped. */
  viewers: number;
  integrations: number;
};

function isPaidStatus(
  status: string,
  graceUntil: Date | null,
  now = new Date(),
): boolean {
  // `lifetime` is not a Stripe subscription status: it is the durable state
  // written by a paid one-time Checkout. Treating it as paid is what makes the
  // existing precedence return the lifetime plan without a renewal date.
  if (status === "active" || status === "trialing" || status === "lifetime") {
    return true;
  }
  // A failed payment does not remove paid limits on the first retry. The grace
  // window is set once per dunning cycle and cleared by a successful payment.
  return (
    (status === "past_due" || status === "unpaid") &&
    graceUntil !== null &&
    graceUntil.getTime() > now.getTime()
  );
}

export async function getWorkspacePlan(workspaceId: string): Promise<PlanId> {
  const rows = await db
    .select({
      plan: workspaces.plan,
      subscriptionPlan: workspaceSubscriptions.plan,
      subscriptionStatus: workspaceSubscriptions.status,
      dunningGraceUntil: workspaceSubscriptions.dunningGraceUntil,
    })
    .from(workspaces)
    .leftJoin(
      workspaceSubscriptions,
      eq(workspaceSubscriptions.workspaceId, workspaces.id),
    )
    .where(eq(workspaces.id, workspaceId))
    .limit(1);

  const row = rows[0];
  if (!row) return "free";

  if (row.subscriptionPlan !== null) {
    return isPaidStatus(
      row.subscriptionStatus ?? "",
      row.dunningGraceUntil ?? null,
    )
      ? toPlanId(row.subscriptionPlan)
      : "free";
  }

  return toPlanId(row.plan);
}

export async function countWorkspaceUsage(workspaceId: string): Promise<WorkspaceUsage> {
  const [
    productRows,
    memberRows,
    viewerRows,
    boardRows,
    slackRows,
    webhookRows,
    issueRows,
    crmRows,
    supportRows,
  ] = await Promise.all([
      db
        .select({ value: count() })
        .from(products)
        .where(eq(products.workspaceId, workspaceId)),
      db
        .select({ value: count() })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, workspaceId),
            // A viewer is a free seat. Counting one against the plan would
            // turn F41 into a paid feature and break the flat-plan model.
            ne(workspaceMembers.role, "viewer"),
          ),
        ),
      db
        .select({ value: count() })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, workspaceId),
            eq(workspaceMembers.role, "viewer"),
          ),
        ),
      db
        .select({ value: count() })
        .from(boards)
        .innerJoin(products, eq(boards.productId, products.id))
        .where(and(eq(products.workspaceId, workspaceId), isNull(boards.archivedAt))),
      db
        .select({ value: count() })
        .from(slackIntegrations)
        .where(
          and(
            eq(slackIntegrations.workspaceId, workspaceId),
            eq(slackIntegrations.active, true),
          ),
        ),
      db
        .select({ value: count() })
        .from(webhooks)
        .where(and(eq(webhooks.workspaceId, workspaceId), eq(webhooks.active, true))),
      db
        .select({ value: count() })
        .from(issueTrackerConnections)
        .where(
          and(
            eq(issueTrackerConnections.workspaceId, workspaceId),
            eq(issueTrackerConnections.active, true),
          ),
        ),
      db
        .select({ value: count() })
        .from(crmConnections)
        .where(
          and(
            eq(crmConnections.workspaceId, workspaceId),
            eq(crmConnections.active, true),
          ),
        ),
      db
        .select({ value: count() })
        .from(supportToolConnections)
        .where(
          and(
            eq(supportToolConnections.workspaceId, workspaceId),
            eq(supportToolConnections.active, true),
          ),
        ),
    ]);

  const activeIntegrations =
    (slackRows[0]?.value ?? 0) +
    (webhookRows[0]?.value ?? 0) +
    (issueRows[0]?.value ?? 0) +
    (crmRows[0]?.value ?? 0) +
    (supportRows[0]?.value ?? 0);

  return {
    products: productRows[0]?.value ?? 0,
    members: memberRows[0]?.value ?? 0,
    viewers: viewerRows[0]?.value ?? 0,
    boards: boardRows[0]?.value ?? 0,
    integrations: activeIntegrations,
  };
}

function currentMonthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function currentMonthKey(now = new Date()): string {
  return currentMonthStart(now).toISOString().slice(0, 10);
}

export type WorkspaceUsageMeters = {
  plan: PlanId;
  periodStart: string;
  products: { used: number; limit: number | null };
  boards: { used: number; limit: number | null };
  members: { used: number; limit: number | null };
  viewers: number;
  integrations: { used: number; limit: number | null };
  emails: { used: number; limit: number | null };
  surveyImpressions: { used: number; limit: number | null };
  aiSpendCents: number;
};

/**
 * Every number the billing screen needs for its usage meters.
 *
 * AI spend is a cost observation, not a plan cap: plans.ts does not meter AI,
 * so the meter reports money spent this month without pretending there is a
 * hard limit. Email volume counts only provider-confirmed sends, which is the
 * same number the delivery gate enforces.
 */
export async function getWorkspaceUsageMeters(
  workspaceId: string,
): Promise<WorkspaceUsageMeters> {
  const monthStart = currentMonthStart();
  const [plan, usage, emailRows, surveyRows, aiRows] = await Promise.all([
    getWorkspacePlan(workspaceId),
    countWorkspaceUsage(workspaceId),
    db
      .select({ value: count() })
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.workspaceId, workspaceId),
          eq(notificationDeliveries.status, "sent"),
          gte(notificationDeliveries.sentAt, monthStart),
        ),
      ),
    db
      .select({ value: count() })
      .from(surveyImpressions)
      .where(
        and(
          eq(surveyImpressions.workspaceId, workspaceId),
          gte(surveyImpressions.createdAt, monthStart),
        ),
      ),
    db
      .select({
        value: sql<number>`coalesce(sum(${junoUsage.costCents}), 0)::int`,
      })
      .from(junoUsage)
      .innerJoin(products, eq(products.id, junoUsage.productId))
      .where(
        and(
          eq(products.workspaceId, workspaceId),
          gte(junoUsage.day, currentMonthKey()),
        ),
      ),
  ]);

  const definition = planDefinition(plan);
  const boardCap = definition.limits.boardsPerProduct;
  return {
    plan,
    periodStart: monthStart.toISOString(),
    products: { used: usage.products, limit: definition.limits.products },
    boards: {
      used: usage.boards,
      limit: boardCap === null ? null : boardCap * Math.max(usage.products, 1),
    },
    members: { used: usage.members, limit: definition.limits.members },
    viewers: usage.viewers,
    integrations: {
      used: usage.integrations,
      limit: definition.limits.integrations,
    },
    emails: { used: emailRows[0]?.value ?? 0, limit: definition.limits.monthlyEmails },
    surveyImpressions: {
      used: surveyRows[0]?.value ?? 0,
      limit: definition.limits.monthlySurveyImpressions,
    },
    aiSpendCents: Number(aiRows[0]?.value ?? 0),
  };
}

/** The monthly email allowance, enforced by the delivery worker. */
export async function checkWorkspaceEmailAllowance(
  workspaceId: string,
  increment = 1,
): Promise<UsageCheck & { plan: PlanId }> {
  const [plan, rows] = await Promise.all([
    getWorkspacePlan(workspaceId),
    db
      .select({ value: count() })
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.workspaceId, workspaceId),
          eq(notificationDeliveries.status, "sent"),
          gte(notificationDeliveries.sentAt, currentMonthStart()),
        ),
      ),
  ]);
  return {
    plan,
    ...checkUsage(plan, "monthlyEmails", rows[0]?.value ?? 0, increment),
  };
}

/**
 * True when a downgrade left more active integrations than the plan allows.
 *
 * The connections keep working, but their configuration becomes read-only
 * until enough are disconnected. That avoids silently deleting a customer's
 * CRM or issue-tracker setup on a plan change.
 */
export async function workspaceIntegrationsOverLimit(
  workspaceId: string,
): Promise<boolean> {
  const [plan, usage] = await Promise.all([
    getWorkspacePlan(workspaceId),
    countWorkspaceUsage(workspaceId),
  ]);
  const limit = planLimit(plan, "integrations");
  return limit !== null && usage.integrations > limit;
}

/**
 * Check a workspace-scoped allowance. Products and members are the only limits
 * counted per workspace; boards are per product because that is the unit a
 * board actually belongs to.
 */
export async function checkWorkspaceLimit(
  workspaceId: string,
  limit: Extract<PlanLimit, "products" | "members" | "integrations">,
  increment = 1,
): Promise<UsageCheck & { plan: PlanId }> {
  const [plan, usage] = await Promise.all([
    getWorkspacePlan(workspaceId),
    countWorkspaceUsage(workspaceId),
  ]);

  const current =
    limit === "products"
      ? usage.products
      : limit === "members"
        ? usage.members
        : usage.integrations;

  return { plan, ...checkUsage(plan, limit, current, increment) };
}

/** Check the board allowance for one product, counted on its non-archived boards. */
export async function checkBoardLimit(
  productId: string,
  increment = 1,
): Promise<UsageCheck & { plan: PlanId }> {
  const rows = await db
    .select({ workspaceId: products.workspaceId })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);

  const workspaceId = rows[0]?.workspaceId;
  if (!workspaceId) {
    return { plan: "free", allowed: false, limit: 0, current: 0, remaining: 0 };
  }

  const [plan, boardRows] = await Promise.all([
    getWorkspacePlan(workspaceId),
    db
      .select({ value: count() })
      .from(boards)
      .where(and(eq(boards.productId, productId), isNull(boards.archivedAt))),
  ]);

  return {
    plan,
    ...checkUsage(plan, "boardsPerProduct", boardRows[0]?.value ?? 0, increment),
  };
}

/** Resolve a plan feature for a workspace id the caller already authorized. */
export async function workspaceHasFeature(
  workspaceId: string,
  feature: PlanFeature,
): Promise<boolean> {
  return hasFeature(await getWorkspacePlan(workspaceId), feature);
}

/** Throw-free gate for server actions that need a typed upgrade message. */
export async function checkWorkspaceFeature(
  workspaceId: string,
  feature: PlanFeature,
): Promise<{ allowed: boolean; plan: PlanId }> {
  const plan = await getWorkspacePlan(workspaceId);
  return { plan, allowed: hasFeature(plan, feature) };
}

/**
 * Whether the public feedback surface may be served for a workspace on `plan`.
 *
 * Requires both the plan feature and the deployment flag: either one can close
 * the surface, which is what makes a downgrade and an incident kill switch
 * independent. Callers answer 404, never 403, so a closed surface is not
 * distinguishable from an unknown one.
 */
export function publicSurfaceEnabled(plan: PlanId): boolean {
  return isFeatureEnabled("public_feedback") && hasFeature(plan, "publicFeedback");
}

/**
 * Whether the embeddable widget may be served for a workspace on `plan`.
 *
 * The widget shares the public customer session and projections, so the public
 * feedback flag is still required, plus its own deployment flag and plan
 * feature. The embed route answers 404 when any of them is off.
 */
export function widgetSurfaceEnabled(plan: PlanId): boolean {
  return (
    isFeatureEnabled("public_feedback") &&
    isFeatureEnabled("widget") &&
    hasFeature(plan, "publicFeedback") &&
    hasFeature(plan, "widget")
  );
}

export type WorkspaceEntitlements = {
  plan: PlanId;
  planName: string;
  status: string;
  features: Record<PlanFeature, boolean>;
  limits: Record<PlanLimit, number | null>;
  usage: WorkspaceUsage;
};

/** Everything a settings screen needs to explain a limit, in one call. */
export async function getWorkspaceEntitlements(
  workspaceId: string,
): Promise<WorkspaceEntitlements> {
  const [plan, usage, subscription] = await Promise.all([
    getWorkspacePlan(workspaceId),
    countWorkspaceUsage(workspaceId),
    db
      .select({ status: workspaceSubscriptions.status })
      .from(workspaceSubscriptions)
      .where(eq(workspaceSubscriptions.workspaceId, workspaceId))
      .limit(1),
  ]);

  const definition = planDefinition(plan);

  return {
    plan,
    planName: definition.name,
    status: subscription[0]?.status ?? (plan === "free" ? "free" : "active"),
    features: { ...definition.features },
    limits: { ...definition.limits },
    usage,
  };
}
