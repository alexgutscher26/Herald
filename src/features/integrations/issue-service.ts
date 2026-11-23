import "server-only";

import { randomBytes, randomUUID } from "node:crypto";

import { and, asc, desc, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import {
  boards,
  customerCompanies,
  customerCompanyMemberships,
  customers,
  feedbackPosts,
  issueLinks,
  issueSyncEvents,
  issueTrackerConnections,
  products,
  workspaces,
} from "@/db/schema";
import { recordWorkspaceAudit } from "@/features/data-controls/service";
import {
  checkWorkspaceLimit,
  workspaceIntegrationsOverLimit,
} from "@/features/entitlements/entitlements";
import {
  getGithubInstallationForProduct,
  getGithubInstallationTokenForProduct,
} from "@/features/github/service";
import { queueFeedbackStatusNotifications } from "@/features/notifications/service";
import { queueSlackStatusUpdate } from "@/features/slack/notify";
import { emitWebhookEvent } from "@/features/webhooks/service";
import { getServerEnv } from "@/lib/env";
import { logEvent, serializeError } from "@/lib/logger";

import {
  ISSUE_PROVIDER_LABELS,
  IssueProviderError,
  createIssueInTracker,
  isIssueProvider,
  normalizeIssueConfig,
  normalizeStatusMap,
  statusForCandidates,
  updateIssueStatusInTracker,
  type HeraldStatus,
  type IssueProvider,
  type IssueProviderConfig,
  type IssueWebhookEvent,
} from "./issue-providers";

/**
 * Issue-tracker service.
 *
 * Every read and write is scoped by the product (and workspace) already
 * authorized by the caller. Provider tokens are selected only by server-side
 * execution paths and never appear in a view returned to a page or action.
 */

export type IssueConnectionView = {
  id: string;
  provider: IssueProvider;
  providerLabel: string;
  name: string;
  active: boolean;
  config: IssueProviderConfig;
  statusMap: Record<string, HeraldStatus>;
  webhookUrl: string;
  updatedAt: string;
  lastEventAt: string | null;
};

export type IssueLinkView = {
  id: string;
  provider: IssueProvider;
  providerLabel: string;
  connectionName: string;
  state: "pending" | "linked" | "failed";
  externalKey: string | null;
  externalUrl: string | null;
  externalStatus: string | null;
  lastEventAt: string | null;
  lastError: string | null;
};

export type FeedbackCrmView = {
  provider: "hubspot" | "salesforce";
  companyName: string;
  contactCount: number | null;
  openDealCount: number | null;
  openDealValueCents: number | null;
  annualRevenueCents: number | null;
  syncedAt: string | null;
};

export type FeedbackIntegrationView = {
  connections: {
    id: string;
    provider: IssueProvider;
    providerLabel: string;
    name: string;
  }[];
  links: IssueLinkView[];
  crm: FeedbackCrmView | null;
};

function webhookUrl(token: string): string {
  return `${getServerEnv().BETTER_AUTH_URL.replace(/\/+$/, "")}/api/integrations/issues/${token}`;
}

function parseStoredConfig(value: Record<string, unknown>): IssueProviderConfig {
  return value as IssueProviderConfig;
}

function parseStoredStatusMap(value: Record<string, string>): Record<string, HeraldStatus> {
  return Object.fromEntries(
    Object.entries(value).filter(([, status]) =>
      ["open", "under_review", "planned", "in_progress", "shipped", "closed"].includes(status),
    ),
  ) as Record<string, HeraldStatus>;
}

/**
 * A GitHub issue connection can use the product's GitHub App installation
 * instead of storing a personal access token. Explicit tokens remain supported
 * for a one-off connection, but are no longer required.
 */
async function resolveIssueApiToken(
  connection: typeof issueTrackerConnections.$inferSelect,
): Promise<string | null> {
  if (connection.apiToken !== "") return connection.apiToken;
  if (connection.provider !== "github") return null;
  return getGithubInstallationTokenForProduct(connection.productId);
}

function publicRequestUrl(input: {
  workspaceSlug: string;
  productSlug: string;
  boardSlug: string | null;
  postId: string;
}): string {
  const origin = getServerEnv().BETTER_AUTH_URL.replace(/\/+$/, "");
  const base = `${origin}/p/${encodeURIComponent(input.workspaceSlug)}/${encodeURIComponent(
    input.productSlug,
  )}`;
  return input.boardSlug
    ? `${base}/${encodeURIComponent(input.boardSlug)}/${encodeURIComponent(input.postId)}`
    : base;
}

async function loadPost(workspaceId: string, productId: string, postId: string) {
  const rows = await db
    .select({
      id: feedbackPosts.id,
      postId: feedbackPosts.id,
      productId: feedbackPosts.productId,
      title: feedbackPosts.title,
      body: feedbackPosts.body,
      status: feedbackPosts.status,
      mergedIntoId: feedbackPosts.mergedIntoId,
      boardSlug: boards.slug,
      productSlug: products.slug,
      workspaceSlug: workspaces.slug,
    })
    .from(feedbackPosts)
    .innerJoin(products, eq(feedbackPosts.productId, products.id))
    .innerJoin(workspaces, eq(products.workspaceId, workspaces.id))
    .leftJoin(boards, eq(feedbackPosts.boardId, boards.id))
    .where(
      and(
        eq(feedbackPosts.id, postId),
        eq(feedbackPosts.productId, productId),
        eq(workspaces.id, workspaceId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function recordEvent(input: {
  workspaceId: string;
  productId: string;
  connectionId: string;
  issueLinkId?: string | null;
  feedbackPostId?: string | null;
  direction: "outbound" | "inbound";
  action: string;
  outcome: "succeeded" | "skipped" | "failed";
  dedupeKey: string;
  externalId?: string | null;
  externalStatus?: string | null;
  fromStatus?: string | null;
  toStatus?: string | null;
  actorUserId?: string | null;
  actorName?: string | null;
  detail?: string | null;
}): Promise<boolean> {
  const inserted = await db
    .insert(issueSyncEvents)
    .values({
      workspaceId: input.workspaceId,
      productId: input.productId,
      connectionId: input.connectionId,
      issueLinkId: input.issueLinkId ?? null,
      feedbackPostId: input.feedbackPostId ?? null,
      direction: input.direction,
      action: input.action,
      outcome: input.outcome,
      dedupeKey: input.dedupeKey.slice(0, 1_000),
      externalId: input.externalId?.slice(0, 300) ?? null,
      externalStatus: input.externalStatus?.slice(0, 300) ?? null,
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus ?? null,
      actorUserId: input.actorUserId ?? null,
      actorName: input.actorName?.slice(0, 200) ?? null,
      detail: input.detail?.slice(0, 2_000) ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: issueSyncEvents.id });
  return inserted.length > 0;
}

export async function listIssueConnectionsForSettings(
  productId: string,
): Promise<IssueConnectionView[]> {
  const rows = await db
    .select()
    .from(issueTrackerConnections)
    .where(eq(issueTrackerConnections.productId, productId))
    .orderBy(asc(issueTrackerConnections.provider));

  return Promise.all(
    rows.map(async (row) => {
      const lastEvent = await db
        .select({ at: issueSyncEvents.createdAt })
        .from(issueSyncEvents)
        .where(eq(issueSyncEvents.connectionId, row.id))
        .orderBy(desc(issueSyncEvents.createdAt))
        .limit(1);
      return {
        id: row.id,
        provider: row.provider,
        providerLabel: ISSUE_PROVIDER_LABELS[row.provider],
        name: row.name,
        active: row.active,
        config: parseStoredConfig(row.config),
        statusMap: parseStoredStatusMap(row.statusMap),
        webhookUrl: webhookUrl(row.webhookToken),
        updatedAt: row.updatedAt.toISOString(),
        lastEventAt: lastEvent[0]?.at.toISOString() ?? null,
      };
    }),
  );
}

export async function saveIssueConnection(input: {
  workspaceId: string;
  productId: string;
  userId: string;
  provider: IssueProvider;
  name: string;
  config: Record<string, unknown>;
  statusMap: Record<string, string>;
  apiToken?: string | undefined;
  webhookSecret?: string | undefined;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!isIssueProvider(input.provider)) {
    return { ok: false, error: "Choose a supported issue tracker." };
  }

  const configResult = normalizeIssueConfig(input.provider, input.config);
  if (!configResult.ok) return configResult;
  const statusResult = normalizeStatusMap(input.statusMap);
  if (!statusResult.ok) return statusResult;

  const existingRows = await db
    .select()
    .from(issueTrackerConnections)
    .where(
      and(
        eq(issueTrackerConnections.productId, input.productId),
        eq(issueTrackerConnections.provider, input.provider),
      ),
    )
    .limit(1);
  const existing = existingRows[0];

  if (existing?.active && (await workspaceIntegrationsOverLimit(input.workspaceId))) {
    return {
      ok: false,
      error:
        "This workspace has more active integrations than its plan allows. Disconnect one before editing a connection.",
    };
  }

  const apiToken = input.apiToken?.trim() || existing?.apiToken || "";
  if (apiToken.length < 8) {
    const githubApp =
      input.provider === "github"
        ? await getGithubInstallationForProduct(input.productId)
        : null;
    if (!githubApp) {
      return {
        ok: false,
        error:
          input.provider === "github"
            ? "Enter an API token, or connect the GitHub App for this product first."
            : "Enter a valid API token.",
      };
    }
  }
  const webhookSecret = input.webhookSecret?.trim() || existing?.webhookSecret || null;
  const signedProvider =
    input.provider === "linear" ||
    input.provider === "github" ||
    input.provider === "clickup";
  if (signedProvider && (!webhookSecret || webhookSecret.length < 8)) {
    return { ok: false, error: "Enter the webhook signing secret (at least 8 characters)." };
  }

  if (!existing || (!existing.active && input.statusMap)) {
    const limit = await checkWorkspaceLimit(input.workspaceId, "integrations");
    if (!limit.allowed) {
      return {
        ok: false,
        error: `The ${limit.plan} plan allows ${limit.limit} active integration${
          limit.limit === 1 ? "" : "s"
        }. Upgrade to connect another.`,
      };
    }
  }

  const name = input.name.trim().slice(0, 100) || ISSUE_PROVIDER_LABELS[input.provider];
  const now = new Date();

  if (existing) {
    await db
      .update(issueTrackerConnections)
      .set({
        name,
        config: configResult.config,
        statusMap: statusResult.map,
        apiToken,
        webhookSecret,
        active: true,
        updatedAt: now,
      })
      .where(eq(issueTrackerConnections.id, existing.id));

    await recordWorkspaceAudit({
      workspaceId: input.workspaceId,
      actorUserId: input.userId,
      action: "integration.issue.connected",
      targetType: "issue_tracker_connection",
      targetId: existing.id,
      metadata: { provider: input.provider, updated: true },
    });
    return { ok: true, id: existing.id };
  }

  try {
    const inserted = await db
      .insert(issueTrackerConnections)
      .values({
        workspaceId: input.workspaceId,
        productId: input.productId,
        provider: input.provider,
        name,
        config: configResult.config,
        statusMap: statusResult.map,
        apiToken,
        webhookSecret,
        webhookToken: randomBytes(32).toString("base64url"),
        active: true,
        createdBy: input.userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: issueTrackerConnections.id });
    const id = inserted[0]?.id;
    if (!id) return { ok: false, error: "Could not save the issue-tracker connection." };

    await recordWorkspaceAudit({
      workspaceId: input.workspaceId,
      actorUserId: input.userId,
      action: "integration.issue.connected",
      targetType: "issue_tracker_connection",
      targetId: id,
      metadata: { provider: input.provider, updated: false },
    });
    return { ok: true, id };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "23505") {
      return { ok: false, error: "That issue tracker is already connected to this product." };
    }
    throw error;
  }
}

export async function disconnectIssueConnection(input: {
  workspaceId: string;
  productId: string;
  userId: string;
  provider: IssueProvider;
}): Promise<boolean> {
  const rows = await db
    .update(issueTrackerConnections)
    .set({ active: false, updatedAt: new Date() })
    .where(
      and(
        eq(issueTrackerConnections.productId, input.productId),
        eq(issueTrackerConnections.provider, input.provider),
      ),
    )
    .returning({ id: issueTrackerConnections.id });
  const id = rows[0]?.id;
  if (!id) return false;
  await recordWorkspaceAudit({
    workspaceId: input.workspaceId,
    actorUserId: input.userId,
    action: "integration.issue.disconnected",
    targetType: "issue_tracker_connection",
    targetId: id,
    metadata: { provider: input.provider },
  });
  return true;
}

/**
 * Rotate the unguessable URL used by providers whose admin webhooks cannot
 * sign. The old URL stops working immediately; the settings page shows the
 * replacement so an administrator can update Jira/Azure in the same step.
 */
export async function rotateIssueWebhookToken(input: {
  workspaceId: string;
  productId: string;
  userId: string;
  provider: IssueProvider;
}): Promise<{ webhookUrl: string } | null> {
  if (input.provider !== "jira" && input.provider !== "azure_devops") return null;

  const token = randomBytes(32).toString("base64url");
  const rows = await db
    .update(issueTrackerConnections)
    .set({ webhookToken: token, updatedAt: new Date() })
    .where(
      and(
        eq(issueTrackerConnections.productId, input.productId),
        eq(issueTrackerConnections.provider, input.provider),
        eq(issueTrackerConnections.workspaceId, input.workspaceId),
      ),
    )
    .returning({ id: issueTrackerConnections.id });
  const id = rows[0]?.id;
  if (!id) return null;

  await recordWorkspaceAudit({
    workspaceId: input.workspaceId,
    actorUserId: input.userId,
    action: "integration.issue.webhook_token_rotated",
    targetType: "issue_tracker_connection",
    targetId: id,
    metadata: { provider: input.provider },
  });
  return { webhookUrl: webhookUrl(token) };
}

export async function getIssueConnectionForWebhook(token: string) {
  const rows = await db
    .select()
    .from(issueTrackerConnections)
    .where(
      and(
        eq(issueTrackerConnections.webhookToken, token),
        eq(issueTrackerConnections.active, true),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export type CreateIssueResult =
  | { ok: true; link: IssueLinkView; created: boolean }
  | { ok: false; error: string };

function linkView(
  row: typeof issueLinks.$inferSelect,
  connectionName = "",
): IssueLinkView {
  return {
    id: row.id,
    provider: row.provider,
    providerLabel: ISSUE_PROVIDER_LABELS[row.provider],
    connectionName,
    state: row.state,
    externalKey: row.externalKey,
    externalUrl: row.externalUrl,
    externalStatus: row.externalStatus,
    lastEventAt: row.lastEventAt?.toISOString() ?? null,
    lastError: row.lastError,
  };
}

async function existingLink(
  feedbackPostId: string,
  connectionId: string,
): Promise<typeof issueLinks.$inferSelect | null> {
  const rows = await db
    .select()
    .from(issueLinks)
    .where(
      and(
        eq(issueLinks.feedbackPostId, feedbackPostId),
        eq(issueLinks.connectionId, connectionId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function listFeedbackIssueLinks(input: {
  productId: string;
  feedbackPostId: string;
}): Promise<IssueLinkView[]> {
  const rows = await db
    .select({
      link: issueLinks,
      connectionName: issueTrackerConnections.name,
    })
    .from(issueLinks)
    .innerJoin(
      issueTrackerConnections,
      eq(issueLinks.connectionId, issueTrackerConnections.id),
    )
    .where(
      and(
        eq(issueLinks.productId, input.productId),
        eq(issueLinks.feedbackPostId, input.feedbackPostId),
      ),
    )
    .orderBy(asc(issueLinks.createdAt));
  return rows.map((row) => linkView(row.link, row.connectionName));
}

export async function createIssueForFeedback(input: {
  workspaceId: string;
  productId: string;
  userId: string;
  feedbackPostId: string;
  provider: IssueProvider;
  fetchImpl?: typeof fetch;
}): Promise<CreateIssueResult> {
  const connectionRows = await db
    .select()
    .from(issueTrackerConnections)
    .where(
      and(
        eq(issueTrackerConnections.productId, input.productId),
        eq(issueTrackerConnections.provider, input.provider),
        eq(issueTrackerConnections.active, true),
      ),
    )
    .limit(1);
  const connection = connectionRows[0];
  if (!connection) {
    return { ok: false, error: "Connect this issue tracker before creating an issue." };
  }

  const post = await loadPost(input.workspaceId, input.productId, input.feedbackPostId);
  if (!post) return { ok: false, error: "That feedback request no longer exists." };

  const previous = await existingLink(post.id, connection.id);
  if (previous) {
    if (previous.state === "linked") {
      return { ok: true, link: linkView(previous, connection.name), created: false };
    }
    if (previous.state === "pending") {
      return {
        ok: false,
        error: "An issue is already being created. Reload before trying again.",
      };
    }
    return {
      ok: false,
      error:
        "A previous creation did not finish. Link the issue manually if it was created, or use a new connection.",
    };
  }

  const pendingId = `pending:${randomUUID()}`;
  let link: typeof issueLinks.$inferSelect;
  try {
    const inserted = await db
      .insert(issueLinks)
      .values({
        workspaceId: input.workspaceId,
        productId: input.productId,
        connectionId: connection.id,
        feedbackPostId: post.id,
        provider: connection.provider,
        state: "pending",
        externalId: pendingId,
        createdBy: input.userId,
      })
      .returning();
    link = inserted[0]!;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "23505") {
      return {
        ok: false,
        error: "An issue is already being created for this request.",
      };
    }
    throw error;
  }

  const config = normalizeIssueConfig(connection.provider, parseStoredConfig(connection.config));
  if (!config.ok) {
    await db
      .update(issueLinks)
      .set({ state: "failed", lastError: config.error, updatedAt: new Date() })
      .where(eq(issueLinks.id, link.id));
    return { ok: false, error: config.error };
  }

  try {
    const apiToken = await resolveIssueApiToken(connection);
    if (!apiToken) {
      throw new IssueProviderError(
        "Connect the GitHub App before creating an issue without a token.",
      );
    }
    const created = await createIssueInTracker({
      provider: connection.provider,
      config: config.config,
      apiToken,
      title: post.title,
      body: post.body,
      requestUrl: publicRequestUrl(post),
      fetchImpl: input.fetchImpl,
    });
    const now = new Date();
    const updated = await db
      .update(issueLinks)
      .set({
        state: "linked",
        externalId: created.externalId,
        externalKey: created.externalKey,
        externalUrl: created.externalUrl,
        externalStatus: created.externalStatus,
        lastEventAt: now,
        updatedAt: now,
      })
      .where(eq(issueLinks.id, link.id))
      .returning();
    const saved = updated[0]!;

    await recordEvent({
      workspaceId: input.workspaceId,
      productId: input.productId,
      connectionId: connection.id,
      issueLinkId: saved.id,
      feedbackPostId: post.id,
      direction: "outbound",
      action: "issue.create",
      outcome: "succeeded",
      dedupeKey: `issue-create:${saved.id}`,
      externalId: saved.externalId,
      externalStatus: saved.externalStatus,
      actorUserId: input.userId,
    });
    await recordWorkspaceAudit({
      workspaceId: input.workspaceId,
      actorUserId: input.userId,
      action: "integration.issue.created",
      targetType: "feedback_post",
      targetId: post.id,
      metadata: {
        provider: connection.provider,
        external_id: saved.externalId,
        external_key: saved.externalKey,
      },
    });
    return { ok: true, link: linkView(saved, connection.name), created: true };
  } catch (error) {
    const message =
      error instanceof IssueProviderError
        ? error.message
        : "Could not create the issue. The tracker may have created it; check before linking manually.";
    await db
      .update(issueLinks)
      .set({ state: "failed", lastError: message, updatedAt: new Date() })
      .where(eq(issueLinks.id, link.id));
    await recordEvent({
      workspaceId: input.workspaceId,
      productId: input.productId,
      connectionId: connection.id,
      issueLinkId: link.id,
      feedbackPostId: post.id,
      direction: "outbound",
      action: "issue.create",
      outcome: "failed",
      dedupeKey: `issue-create:${link.id}`,
      externalId: link.externalId,
      actorUserId: input.userId,
      detail: message,
    });
    logEvent("warn", "integration.issue.create_failed", {
      productId: input.productId,
      provider: connection.provider,
      error: serializeError(error),
    });
    return { ok: false, error: message };
  }
}

export async function linkExistingIssue(input: {
  workspaceId: string;
  productId: string;
  userId: string;
  feedbackPostId: string;
  provider: IssueProvider;
  externalId: string;
  externalKey?: string | undefined;
  externalUrl?: string | undefined;
}): Promise<CreateIssueResult> {
  const connectionRows = await db
    .select()
    .from(issueTrackerConnections)
    .where(
      and(
        eq(issueTrackerConnections.productId, input.productId),
        eq(issueTrackerConnections.provider, input.provider),
        eq(issueTrackerConnections.active, true),
      ),
    )
    .limit(1);
  const connection = connectionRows[0];
  if (!connection) {
    return { ok: false, error: "Connect this issue tracker before linking an issue." };
  }
  const post = await loadPost(input.workspaceId, input.productId, input.feedbackPostId);
  if (!post) return { ok: false, error: "That feedback request no longer exists." };

  const externalId = input.externalId.trim().slice(0, 300);
  if (!externalId) return { ok: false, error: "Enter the issue id or key." };
  const externalUrl = input.externalUrl?.trim() || null;
  if (externalUrl) {
    try {
      const parsed = new URL(externalUrl);
      if (parsed.protocol !== "https:" || externalUrl.length > 2_000) {
        return { ok: false, error: "The issue URL must be an https address." };
      }
    } catch {
      return { ok: false, error: "The issue URL is not valid." };
    }
  }

  const previous = await existingLink(post.id, connection.id);
  if (previous?.state === "pending") {
    return { ok: false, error: "An issue is already being created for this request." };
  }
  if (previous?.state === "linked") {
    return { ok: true, link: linkView(previous, connection.name), created: false };
  }

  const now = new Date();
  let saved: typeof issueLinks.$inferSelect;
  try {
    if (previous) {
      const updated = await db
        .update(issueLinks)
        .set({
          state: "linked",
          externalId,
          externalKey: input.externalKey?.trim().slice(0, 200) || externalId,
          externalUrl,
          externalStatus: null,
          lastError: null,
          lastEventAt: now,
          updatedAt: now,
        })
        .where(eq(issueLinks.id, previous.id))
        .returning();
      saved = updated[0]!;
    } else {
      const inserted = await db
        .insert(issueLinks)
        .values({
          workspaceId: input.workspaceId,
          productId: input.productId,
          connectionId: connection.id,
          feedbackPostId: post.id,
          provider: connection.provider,
          state: "linked",
          externalId,
          externalKey: input.externalKey?.trim().slice(0, 200) || externalId,
          externalUrl,
          createdBy: input.userId,
          lastEventAt: now,
        })
        .returning();
      saved = inserted[0]!;
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "23505") {
      return { ok: false, error: "That issue is already linked to another request." };
    }
    throw error;
  }

  await recordEvent({
    workspaceId: input.workspaceId,
    productId: input.productId,
    connectionId: connection.id,
    issueLinkId: saved.id,
    feedbackPostId: post.id,
    direction: "outbound",
    action: "issue.link",
    outcome: "succeeded",
    dedupeKey: `issue-link:${saved.id}:${externalId}`,
    externalId,
    actorUserId: input.userId,
  });
  await recordWorkspaceAudit({
    workspaceId: input.workspaceId,
    actorUserId: input.userId,
    action: "integration.issue.linked",
    targetType: "feedback_post",
    targetId: post.id,
    metadata: { provider: connection.provider, external_id: externalId },
  });
  return { ok: true, link: linkView(saved, connection.name), created: true };
}

/**
 * Push a Herald status transition to every linked external issue.
 *
 * Best effort by design: the Herald write has already committed, so a tracker
 * outage must not roll it back or fail the user's action. Each attempt is
 * recorded in `issue_sync_events`; a failure stays on the link as `lastError`
 * and can be retried by pushing the status again.
 *
 * The target status is the *first* external name mapped to the Herald status in
 * the connection's status map. If nothing maps, the event is recorded as
 * skipped rather than inventing a state the tracker does not have.
 */
export async function pushFeedbackStatusToIssueTracker(input: {
  productId: string;
  feedbackPostId: string;
  fromStatus: string | null;
  toStatus: HeraldStatus;
  fetchImpl?: typeof fetch;
}): Promise<{ pushed: number; skipped: number; failed: number }> {
  const rows = await db
    .select({ link: issueLinks, connection: issueTrackerConnections })
    .from(issueLinks)
    .innerJoin(
      issueTrackerConnections,
      and(
        eq(issueTrackerConnections.id, issueLinks.connectionId),
        eq(issueTrackerConnections.active, true),
      ),
    )
    .where(
      and(
        eq(issueLinks.productId, input.productId),
        eq(issueLinks.feedbackPostId, input.feedbackPostId),
        eq(issueLinks.state, "linked"),
      ),
    )
    .limit(10);

  let pushed = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const connection = row.connection;
    const link = row.link;
    const statusMap = parseStoredStatusMap(connection.statusMap);
    const target = Object.entries(statusMap).find(
      ([, heraldStatus]) => heraldStatus === input.toStatus,
    )?.[0];
    const dedupeKey = `issue-status:${link.id}:${input.fromStatus ?? "none"}:${
      input.toStatus
    }:${Math.floor(Date.now() / 60_000)}`;

    if (!target) {
      skipped += 1;
      await recordEvent({
        workspaceId: connection.workspaceId,
        productId: connection.productId,
        connectionId: connection.id,
        issueLinkId: link.id,
        feedbackPostId: link.feedbackPostId,
        direction: "outbound",
        action: "issue.status_push",
        outcome: "skipped",
        dedupeKey,
        externalId: link.externalId,
        fromStatus: input.fromStatus,
        toStatus: input.toStatus,
        detail: "No external status is mapped to this Herald status.",
      });
      continue;
    }

    const config = normalizeIssueConfig(
      connection.provider,
      parseStoredConfig(connection.config),
    );
    if (!config.ok) {
      failed += 1;
      await recordEvent({
        workspaceId: connection.workspaceId,
        productId: connection.productId,
        connectionId: connection.id,
        issueLinkId: link.id,
        feedbackPostId: link.feedbackPostId,
        direction: "outbound",
        action: "issue.status_push",
        outcome: "failed",
        dedupeKey,
        externalId: link.externalId,
        fromStatus: input.fromStatus,
        toStatus: input.toStatus,
        detail: config.error,
      });
      continue;
    }

    try {
      const apiToken = await resolveIssueApiToken(connection);
      if (!apiToken) {
        throw new IssueProviderError(
          "Connect the GitHub App before pushing without a token.",
        );
      }
      const updated = await updateIssueStatusInTracker({
        provider: connection.provider,
        config: config.config,
        apiToken,
        externalId: link.externalId,
        externalStatus: target,
        fetchImpl: input.fetchImpl,
      });
      const now = new Date();
      await db
        .update(issueLinks)
        .set({
          externalStatus: updated.externalStatus,
          lastEventAt: now,
          lastError: null,
          updatedAt: now,
        })
        .where(eq(issueLinks.id, link.id));
      await recordEvent({
        workspaceId: connection.workspaceId,
        productId: connection.productId,
        connectionId: connection.id,
        issueLinkId: link.id,
        feedbackPostId: link.feedbackPostId,
        direction: "outbound",
        action: "issue.status_push",
        outcome: "succeeded",
        dedupeKey,
        externalId: link.externalId,
        externalStatus: updated.externalStatus,
        fromStatus: input.fromStatus,
        toStatus: input.toStatus,
      });
      pushed += 1;
    } catch (error) {
      failed += 1;
      const message =
        error instanceof IssueProviderError
          ? error.message
          : "Could not update the issue status in the tracker.";
      await db
        .update(issueLinks)
        .set({ lastError: message.slice(0, 500), updatedAt: new Date() })
        .where(eq(issueLinks.id, link.id));
      await recordEvent({
        workspaceId: connection.workspaceId,
        productId: connection.productId,
        connectionId: connection.id,
        issueLinkId: link.id,
        feedbackPostId: link.feedbackPostId,
        direction: "outbound",
        action: "issue.status_push",
        outcome: "failed",
        dedupeKey,
        externalId: link.externalId,
        fromStatus: input.fromStatus,
        toStatus: input.toStatus,
        detail: message,
      });
      logEvent("warn", "integration.issue.status_push_failed", {
        productId: connection.productId,
        provider: connection.provider,
        error: serializeError(error),
      });
    }
  }

  return { pushed, skipped, failed };
}

export async function processIssueTrackerEvent(input: IssueWebhookEvent & {
  connectionId: string;
}): Promise<{ applied: boolean; reason?: string }> {
  const connectionRows = await db
    .select()
    .from(issueTrackerConnections)
    .where(
      and(
        eq(issueTrackerConnections.id, input.connectionId),
        eq(issueTrackerConnections.active, true),
      ),
    )
    .limit(1);
  const connection = connectionRows[0];
  if (!connection) return { applied: false, reason: "connection_inactive" };

  const linkRows = await db
    .select()
    .from(issueLinks)
    .where(
      and(
        eq(issueLinks.connectionId, connection.id),
        eq(issueLinks.externalId, input.externalId),
      ),
    )
    .limit(1);
  const link = linkRows[0];
  if (!link) return { applied: false, reason: "issue_not_linked" };

  const status = statusForCandidates(
    parseStoredStatusMap(connection.statusMap),
    input.candidates,
  );
  const dedupeKey = `issue-webhook:${connection.id}:${input.deliveryKey}`;
  if (!status) {
    await recordEvent({
      workspaceId: connection.workspaceId,
      productId: connection.productId,
      connectionId: connection.id,
      issueLinkId: link.id,
      feedbackPostId: link.feedbackPostId,
      direction: "inbound",
      action: input.eventName,
      outcome: "skipped",
      dedupeKey,
      externalId: input.externalId,
      externalStatus: input.candidates[0] ?? null,
      actorName: input.actorName,
      detail: "No Herald status is mapped to this external status.",
    });
    return { applied: false, reason: "status_not_mapped" };
  }

  const postRows = await db
    .select({
      id: feedbackPosts.id,
      status: feedbackPosts.status,
      mergedIntoId: feedbackPosts.mergedIntoId,
    })
    .from(feedbackPosts)
    .where(
      and(
        eq(feedbackPosts.id, link.feedbackPostId),
        eq(feedbackPosts.productId, connection.productId),
      ),
    )
    .limit(1);
  const post = postRows[0];
  if (!post) return { applied: false, reason: "request_missing" };
  if (post.mergedIntoId) {
    await recordEvent({
      workspaceId: connection.workspaceId,
      productId: connection.productId,
      connectionId: connection.id,
      issueLinkId: link.id,
      feedbackPostId: post.id,
      direction: "inbound",
      action: input.eventName,
      outcome: "skipped",
      dedupeKey,
      externalId: input.externalId,
      externalStatus: input.candidates[0] ?? null,
      actorName: input.actorName,
      detail: "The request is merged; its canonical request owns the status.",
    });
    return { applied: false, reason: "request_merged" };
  }

  const now = new Date();
  let changed = false;
  const recorded = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(issueSyncEvents)
      .values({
        workspaceId: connection.workspaceId,
        productId: connection.productId,
        connectionId: connection.id,
        issueLinkId: link.id,
        feedbackPostId: post.id,
        direction: "inbound",
        action: input.eventName.slice(0, 100),
        outcome: "succeeded",
        dedupeKey: dedupeKey.slice(0, 1_000),
        externalId: input.externalId.slice(0, 300),
        externalStatus: (input.candidates[0] ?? status).slice(0, 300),
        fromStatus: post.status,
        toStatus: status,
        actorName: input.actorName?.slice(0, 200) ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: issueSyncEvents.id });
    if (inserted.length === 0) return false;

    if (post.status !== status) {
      await tx
        .update(feedbackPosts)
        .set({ status, updatedAt: now })
        .where(
          and(
            eq(feedbackPosts.id, post.id),
            eq(feedbackPosts.productId, connection.productId),
          ),
        );
      await queueFeedbackStatusNotifications(tx, {
        productId: connection.productId,
        postId: post.id,
        toStatus: status,
        eventAt: now,
      });
      changed = true;
    }

    await tx
      .update(issueLinks)
      .set({
        externalStatus: input.candidates[0] ?? status,
        lastEventAt: now,
        lastError: null,
        updatedAt: now,
        ...(input.externalUrl ? { externalUrl: input.externalUrl } : {}),
      })
      .where(eq(issueLinks.id, link.id));
    return true;
  });

  if (!recorded) return { applied: false, reason: "duplicate_event" };

  if (changed) {
    await queueSlackStatusUpdate({
      requestId: post.id,
      status: status as "open" | "under_review" | "planned" | "in_progress" | "shipped" | "closed",
    }).catch(() => undefined);
    await emitWebhookEvent({
      workspaceId: connection.workspaceId,
      event: "request.updated",
      data: {
        request_id: post.id,
        from_status: post.status,
        to_status: status,
        source: connection.provider,
        external_issue_id: input.externalId,
      },
    }).catch(() => undefined);
  }

  await recordWorkspaceAudit({
    workspaceId: connection.workspaceId,
    actorUserId: null,
    action: "integration.issue.status_synced",
    targetType: "feedback_post",
    targetId: post.id,
    metadata: {
      provider: connection.provider,
      external_id: input.externalId,
      external_status: input.candidates[0] ?? null,
      from_status: post.status,
      to_status: status,
    },
  });

  return { applied: true };
}

export async function getFeedbackIntegrationView(input: {
  workspaceId: string;
  productId: string;
  feedbackPostId: string;
}): Promise<FeedbackIntegrationView> {
  const connections = await db
    .select({
      id: issueTrackerConnections.id,
      provider: issueTrackerConnections.provider,
      name: issueTrackerConnections.name,
    })
    .from(issueTrackerConnections)
    .where(
      and(
        eq(issueTrackerConnections.productId, input.productId),
        eq(issueTrackerConnections.active, true),
      ),
    )
    .orderBy(asc(issueTrackerConnections.provider));

  const links = await listFeedbackIssueLinks({
    productId: input.productId,
    feedbackPostId: input.feedbackPostId,
  });

  const authorRows = await db
    .select({
      customerId: customers.id,
      crmProvider: customers.crmProvider,
      crmSyncedAt: customers.crmSyncedAt,
      companyId: customerCompanies.id,
      companyName: customerCompanies.name,
      companyProvider: customerCompanies.crmProvider,
      companySyncedAt: customerCompanies.crmSyncedAt,
      contactCount: customerCompanies.crmContactCount,
      openDealCount: customerCompanies.crmOpenDealCount,
      openDealValueCents: customerCompanies.crmOpenDealValueCents,
      annualRevenueCents: customerCompanies.crmAnnualRevenueCents,
    })
    .from(customers)
    .innerJoin(
      feedbackPosts,
      and(
        eq(feedbackPosts.authorCustomerId, customers.id),
        eq(feedbackPosts.id, input.feedbackPostId),
      ),
    )
    .leftJoin(
      customerCompanyMemberships,
      eq(customerCompanyMemberships.customerId, customers.id),
    )
    .leftJoin(
      customerCompanies,
      eq(customerCompanyMemberships.companyId, customerCompanies.id),
    )
    .where(
      and(
        eq(customers.workspaceId, input.workspaceId),
        eq(feedbackPosts.productId, input.productId),
        isNull(feedbackPosts.mergedIntoId),
      ),
    )
    .limit(1);

  const author = authorRows[0];
  const provider = author?.companyProvider ?? author?.crmProvider;
  const syncedAt = author?.companySyncedAt ?? author?.crmSyncedAt;
  const crm: FeedbackCrmView | null =
    author && provider && (provider === "hubspot" || provider === "salesforce")
      ? {
          provider,
          companyName: author.companyName ?? "Customer company",
          contactCount: author.contactCount,
          openDealCount: author.openDealCount,
          openDealValueCents: author.openDealValueCents,
          annualRevenueCents: author.annualRevenueCents,
          syncedAt: syncedAt?.toISOString() ?? null,
        }
      : null;

  return {
    connections: connections.map((connection) => ({
      id: connection.id,
      provider: connection.provider,
      providerLabel: ISSUE_PROVIDER_LABELS[connection.provider],
      name: connection.name,
    })),
    links,
    crm,
  };
}
