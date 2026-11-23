import "server-only";

import {
  and,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
} from "drizzle-orm";

import { db } from "@/db";
import {
  boards,
  customers,
  feedbackComments,
  feedbackCustomerVotes,
  feedbackPosts,
  feedbackVotes,
  products,
  subscribers,
  workspaces,
  workspaceMembers,
} from "@/db/schema";
import { conversationMessages, conversations } from "@/db/schema/conversations";
import { workspaceAuditEvents, workspaceDeletions } from "@/db/schema/data-controls";
import { releases } from "@/db/schema/releases";
import { user } from "@/db/schema/auth";

import {
  auditDateBounds,
  EMPTY_AUDIT_FILTERS,
  type AuditFilters,
} from "./audit-filters";

const WORKSPACE_DELETION_GRACE_DAYS = 30;
/** How long an audit entry is kept before `prune_audit_events` removes it. */
export const AUDIT_RETENTION_DAYS = 365;

const NO_STORE = { "cache-control": "private, no-store" };

/**
 * Workspace data controls.
 *
 * Deletion is a two-phase operation: an owner requests it, then a scheduled
 * job purges only after the documented 30-day grace period. The audit row is
 * intentionally independent of the workspace FK so it survives the purge.
 */

export async function recordWorkspaceAudit(input: {
  workspaceId: string;
  actorUserId: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
}): Promise<void> {
  await db.insert(workspaceAuditEvents).values({
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    action: input.action,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    metadata: input.metadata ? JSON.stringify(input.metadata) : null,
  });
}

export type WorkspaceAuditView = {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  createdAt: string;
  /**
   * The action's structured detail (a role change's old and new role, the
   * deprovisioning source). Null when the action recorded none, or when the
   * stored JSON cannot be read back.
   */
  metadata: Record<string, string | number | boolean | null> | null;
};

function parseAuditMetadata(raw: string | null): Record<string, string | number | boolean | null> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, string | number | boolean | null>;
  } catch {
    return null;
  }
}

export type WorkspaceAuditQuery = {
  filters?: AuditFilters;
  limit?: number;
};

/**
 * Owner-facing audit history, including the action's detail.
 *
 * Filters are applied in the database, not after the fetch, so a filtered view
 * and its CSV export always describe the same rows. The limit is bounded: the
 * settings table asks for 50, the export for 5,000.
 */
export async function listWorkspaceAuditEvents(
  workspaceId: string,
  query: number | WorkspaceAuditQuery = {},
): Promise<WorkspaceAuditView[]> {
  const options: WorkspaceAuditQuery = typeof query === "number" ? { limit: query } : query;
  const filters = options.filters ?? EMPTY_AUDIT_FILTERS;
  const bounded = Math.min(Math.max(Math.trunc(options.limit ?? 50), 1), 5000);
  const bounds = auditDateBounds(filters);

  const conditions = [eq(workspaceAuditEvents.workspaceId, workspaceId)];
  if (filters.actor) {
    const pattern = `%${filters.actor}%`;
    const actor = or(ilike(user.name, pattern), ilike(user.email, pattern));
    if (actor) conditions.push(actor);
  }
  if (filters.action) {
    conditions.push(eq(workspaceAuditEvents.action, filters.action));
  }
  if (filters.targetType) {
    conditions.push(eq(workspaceAuditEvents.targetType, filters.targetType));
  }
  if (bounds.from) conditions.push(gte(workspaceAuditEvents.createdAt, bounds.from));
  if (bounds.to) conditions.push(lte(workspaceAuditEvents.createdAt, bounds.to));
  if (filters.search) {
    const pattern = `%${filters.search}%`;
    const search = or(
      ilike(workspaceAuditEvents.action, pattern),
      ilike(workspaceAuditEvents.targetId, pattern),
      ilike(workspaceAuditEvents.metadata, pattern),
      ilike(user.name, pattern),
      ilike(user.email, pattern),
    );
    if (search) conditions.push(search);
  }

  const rows = await db
    .select({
      id: workspaceAuditEvents.id,
      action: workspaceAuditEvents.action,
      targetType: workspaceAuditEvents.targetType,
      targetId: workspaceAuditEvents.targetId,
      actorName: user.name,
      actorEmail: user.email,
      createdAt: workspaceAuditEvents.createdAt,
      metadata: workspaceAuditEvents.metadata,
    })
    .from(workspaceAuditEvents)
    .leftJoin(user, eq(workspaceAuditEvents.actorUserId, user.id))
    .where(and(...conditions))
    .orderBy(desc(workspaceAuditEvents.createdAt))
    .limit(bounded);

  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    metadata: parseAuditMetadata(row.metadata),
  }));
}

export async function getWorkspaceDeletion(
  workspaceId: string,
): Promise<{ purgeAfter: Date; cancelledAt: Date | null } | null> {
  const rows = await db
    .select({
      purgeAfter: workspaceDeletions.purgeAfter,
      cancelledAt: workspaceDeletions.cancelledAt,
    })
    .from(workspaceDeletions)
    .where(eq(workspaceDeletions.workspaceId, workspaceId))
    .limit(1);
  return rows[0] ?? null;
}

export async function requestWorkspaceDeletion(input: {
  workspaceId: string;
  actorUserId: string;
  reason?: string | undefined;
}): Promise<{ purgeAfter: Date }> {
  const purgeAfter = new Date(
    Date.now() + WORKSPACE_DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000,
  );

  await db
    .insert(workspaceDeletions)
    .values({
      workspaceId: input.workspaceId,
      requestedBy: input.actorUserId,
      purgeAfter,
      cancelledAt: null,
      reason: input.reason?.trim() || null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: workspaceDeletions.workspaceId,
      set: {
        requestedBy: input.actorUserId,
        requestedAt: new Date(),
        purgeAfter,
        cancelledAt: null,
        reason: input.reason?.trim() || null,
        updatedAt: new Date(),
      },
    });

  await recordWorkspaceAudit({
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    action: "workspace.deletion_requested",
    targetType: "workspace",
    targetId: input.workspaceId,
    metadata: { purgeAfter: purgeAfter.toISOString() },
  });

  return { purgeAfter };
}

export async function cancelWorkspaceDeletion(input: {
  workspaceId: string;
  actorUserId: string;
}): Promise<boolean> {
  const rows = await db
    .update(workspaceDeletions)
    .set({ cancelledAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(workspaceDeletions.workspaceId, input.workspaceId),
        // A cancelled request is already final; a second click is harmless.
        isNull(workspaceDeletions.cancelledAt),
      ),
    )
    .returning({ id: workspaceDeletions.id });

  if (rows[0]) {
    await recordWorkspaceAudit({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: "workspace.deletion_cancelled",
      targetType: "workspace",
      targetId: input.workspaceId,
    });
  }
  return Boolean(rows[0]);
}

export async function purgeDueWorkspaces(now = new Date()): Promise<{ purged: number }> {
  const due = await db
    .select({
      workspaceId: workspaceDeletions.workspaceId,
      purgeAfter: workspaceDeletions.purgeAfter,
    })
    .from(workspaceDeletions)
    .where(
      and(
        isNull(workspaceDeletions.cancelledAt),
        lt(workspaceDeletions.purgeAfter, now),
      ),
    );

  let purged = 0;
  for (const row of due) {
    // Record before deleting: this row deliberately has no workspace FK.
    await recordWorkspaceAudit({
      workspaceId: row.workspaceId,
      actorUserId: null,
      action: "workspace.purged",
      targetType: "workspace",
      targetId: row.workspaceId,
      metadata: { purgeAfter: row.purgeAfter.toISOString() },
    });
    await db.delete(workspaces).where(eq(workspaces.id, row.workspaceId));
    purged += 1;
  }
  return { purged };
}

export async function pruneAuditEvents(now = new Date()): Promise<{ pruned: number }> {
  const cutoff = new Date(now.getTime() - AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db
    .delete(workspaceAuditEvents)
    .where(lt(workspaceAuditEvents.createdAt, cutoff))
    .returning({ id: workspaceAuditEvents.id });
  return { pruned: rows.length };
}

export async function eraseCustomerData(input: {
  workspaceId: string;
  actorUserId: string;
  email: string;
}): Promise<{ deleted: boolean }> {
  const rows = await db
    .select({ id: customers.id })
    .from(customers)
    .where(
      and(
        eq(customers.workspaceId, input.workspaceId),
        eq(customers.emailNormalized, input.email.trim().toLowerCase()),
      ),
    )
    .limit(1);
  const customer = rows[0];
  if (!customer) return { deleted: false };

  await db.delete(customers).where(
    and(eq(customers.id, customer.id), eq(customers.workspaceId, input.workspaceId)),
  );
  await recordWorkspaceAudit({
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    action: "customer.data_erased",
    targetType: "customer",
    targetId: customer.id,
  });
  return { deleted: true };
}

export async function transferWorkspaceOwnership(input: {
  workspaceId: string;
  actorUserId: string;
  targetMemberId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const targetRows = await db
    .select({ id: workspaceMembers.id, userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.id, input.targetMemberId),
        eq(workspaceMembers.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);
  const target = targetRows[0];
  if (!target) return { ok: false, error: "Choose a teammate in this workspace." };
  if (target.userId === input.actorUserId) {
    return { ok: false, error: "You already own this workspace." };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(workspaceMembers)
      .set({ role: "owner", updatedAt: new Date() })
      .where(
        and(
          eq(workspaceMembers.id, target.id),
          eq(workspaceMembers.workspaceId, input.workspaceId),
        ),
      );
    await tx
      .update(workspaceMembers)
      .set({ role: "admin", updatedAt: new Date() })
      .where(
        and(
          eq(workspaceMembers.workspaceId, input.workspaceId),
          eq(workspaceMembers.userId, input.actorUserId),
          ne(workspaceMembers.id, target.id),
        ),
      );
  });

  await recordWorkspaceAudit({
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    action: "workspace.ownership_transferred",
    targetType: "member",
    targetId: target.id,
  });
  return { ok: true };
}

export type WorkspaceExport = Awaited<ReturnType<typeof buildWorkspaceExport>>;

/**
 * Complete, portable workspace export. It includes customer-authored content
 * but deliberately omits session cookies, API token hashes and webhook secrets.
 */
export async function buildWorkspaceExport(input: {
  workspaceId: string;
}): Promise<Record<string, unknown> | null> {
  const workspaceRows = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      plan: workspaces.plan,
      createdAt: workspaces.createdAt,
    })
    .from(workspaces)
    .where(eq(workspaces.id, input.workspaceId))
    .limit(1);
  const workspace = workspaceRows[0];
  if (!workspace) return null;

  const productRows = await db
    .select({
      id: products.id,
      name: products.name,
      slug: products.slug,
      description: products.description,
      createdAt: products.createdAt,
    })
    .from(products)
    .where(eq(products.workspaceId, input.workspaceId));

  const productIds = productRows.map((row) => row.id);
  if (productIds.length === 0) {
    return {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      workspace,
      products: [],
      boards: [],
      feedback: [],
      comments: [],
      votes: [],
      customerVotes: [],
      customers: [],
      conversations: [],
      messages: [],
      releases: [],
      subscribers: [],
      members: [],
    };
  }

  const postIdRows = await db
    .select({ id: feedbackPosts.id })
    .from(feedbackPosts)
    .where(inArray(feedbackPosts.productId, productIds));

  const [
    boardRows,
    postRows,
    commentRows,
    teamVoteRows,
    customerVoteRows,
    customerRows,
    conversationRows,
    messageRows,
    releaseRows,
    subscriberRows,
    memberRows,
  ] = await Promise.all([
    db.select({
      id: boards.id,
      productId: boards.productId,
      name: boards.name,
      slug: boards.slug,
      description: boards.description,
      visibility: boards.visibility,
      createdAt: boards.createdAt,
    }).from(boards).where(inArray(boards.productId, productIds)),
    db.select().from(feedbackPosts).where(inArray(feedbackPosts.productId, productIds)),
    db.select().from(feedbackComments).where(inArray(feedbackComments.productId, productIds)),
    db.select().from(feedbackVotes).where(
      inArray(
        feedbackVotes.feedbackPostId,
        postIdRows.length > 0
          ? postIdRows.map((row) => row.id)
          : ["00000000-0000-0000-0000-000000000000"],
      ),
    ),
    db.select().from(feedbackCustomerVotes).where(
      inArray(
        feedbackCustomerVotes.feedbackPostId,
        postIdRows.length > 0
          ? postIdRows.map((row) => row.id)
          : ["00000000-0000-0000-0000-000000000000"],
      ),
    ),
    db.select({
      id: customers.id,
      email: customers.email,
      name: customers.name,
      externalId: customers.externalId,
      traits: customers.traits,
      createdAt: customers.createdAt,
    }).from(customers).where(eq(customers.workspaceId, input.workspaceId)),
    db.select({
      id: conversations.id,
      productId: conversations.productId,
      subject: conversations.subject,
      status: conversations.status,
      createdAt: conversations.createdAt,
      resolvedAt: conversations.resolvedAt,
    }).from(conversations).where(inArray(conversations.productId, productIds)),
    db.select({
      id: conversationMessages.id,
      conversationId: conversationMessages.conversationId,
      body: conversationMessages.body,
      authorType: conversationMessages.authorType,
      authorUserId: conversationMessages.authorUserId,
      authorCustomerId: conversationMessages.authorCustomerId,
      createdAt: conversationMessages.createdAt,
    }).from(conversationMessages).where(inArray(conversationMessages.productId, productIds)),
    db.select({
      id: releases.id,
      productId: releases.productId,
      title: releases.title,
      bodyMarkdown: releases.bodyMarkdown,
      summary: releases.summary,
      publishedAt: releases.publishedAt,
      createdAt: releases.createdAt,
    }).from(releases).where(inArray(releases.productId, productIds)),
    db.select({
      id: subscribers.id,
      email: subscribers.email,
      status: subscribers.status,
      createdAt: subscribers.createdAt,
    }).from(subscribers).where(inArray(subscribers.productId, productIds)),
    db.select({
      id: workspaceMembers.id,
      userId: workspaceMembers.userId,
      role: workspaceMembers.role,
      createdAt: workspaceMembers.createdAt,
    }).from(workspaceMembers).where(eq(workspaceMembers.workspaceId, input.workspaceId)),
  ]);

  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    workspace,
    products: productRows,
    boards: boardRows,
    feedback: postRows,
    comments: commentRows,
    votes: teamVoteRows,
    customerVotes: customerVoteRows,
    customers: customerRows,
    conversations: conversationRows,
    messages: messageRows,
    releases: releaseRows,
    subscribers: subscriberRows,
    members: memberRows,
  };
}

export { NO_STORE };
