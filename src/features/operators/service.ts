import "server-only";

import { and, eq, gt } from "drizzle-orm";

import { db } from "@/db";
import { session as authSession, user } from "@/db/schema/auth";
import { workspaceOperators, type OperatorScheduleWindow } from "@/db/schema/support";
import { workspaceMembers } from "@/db/schema/workspaces";
import type { WorkspaceRole } from "@/lib/permissions";

import { isWithinSchedule, isValidTimezone, normalizeSchedule } from "./schedule";

/**
 * Conversations operators.
 *
 * Eligible people are workspace owners and admins; an editor is not an
 * operator and cannot receive the inbox. Presence is derived, not stored as a
 * boolean: a heartbeat in the last three minutes plus the operator's own
 * availability window. `appearOffline` always wins.
 */

const PRESENCE_WINDOW_MS = 3 * 60 * 1000;

/** Anything that can run a read: the pool or an open transaction. */
type ReadExecutor = Pick<typeof db, "select">;

export type OperatorSettings = {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: WorkspaceRole;
  operator: {
    timezone: string;
    schedule: OperatorScheduleWindow[] | null;
    availableWhileUsing: boolean;
    appearOffline: boolean;
    notifyEmail: boolean;
    notifyInApp: boolean;
    notifyNewConversations: boolean;
    notifyReplies: boolean;
    awayReplyEnabled: boolean;
    awayReplyBody: string;
    lastSeenAt: string | null;
  } | null;
};

function isEligible(role: WorkspaceRole): boolean {
  return role === "owner" || role === "admin";
}

export async function listOperatorSettings(
  workspaceId: string,
): Promise<OperatorSettings[]> {
  const rows = await db
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      role: workspaceMembers.role,
      timezone: workspaceOperators.timezone,
      schedule: workspaceOperators.schedule,
      availableWhileUsing: workspaceOperators.availableWhileUsing,
      appearOffline: workspaceOperators.appearOffline,
      notifyEmail: workspaceOperators.notifyEmail,
      notifyInApp: workspaceOperators.notifyInApp,
      notifyNewConversations: workspaceOperators.notifyNewConversations,
      notifyReplies: workspaceOperators.notifyReplies,
      awayReplyEnabled: workspaceOperators.awayReplyEnabled,
      awayReplyBody: workspaceOperators.awayReplyBody,
      lastSeenAt: workspaceOperators.lastSeenAt,
      operatorWorkspace: workspaceOperators.workspaceId,
    })
    .from(workspaceMembers)
    .innerJoin(user, eq(workspaceMembers.userId, user.id))
    .leftJoin(
      workspaceOperators,
      and(
        eq(workspaceOperators.workspaceId, workspaceMembers.workspaceId),
        eq(workspaceOperators.userId, workspaceMembers.userId),
      ),
    )
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(user.name);

  return rows
    .filter((row) => isEligible(row.role as WorkspaceRole))
    .map((row) => ({
      userId: row.userId,
      name: row.name,
      email: row.email,
      image: row.image,
      role: row.role as WorkspaceRole,
      operator: row.operatorWorkspace
        ? {
            timezone: row.timezone ?? "UTC",
            schedule: row.schedule ?? null,
            availableWhileUsing: row.availableWhileUsing ?? true,
            appearOffline: row.appearOffline ?? false,
            notifyEmail: row.notifyEmail ?? true,
            notifyInApp: row.notifyInApp ?? true,
            notifyNewConversations: row.notifyNewConversations ?? true,
            notifyReplies: row.notifyReplies ?? true,
            awayReplyEnabled: row.awayReplyEnabled ?? false,
            awayReplyBody:
              row.awayReplyBody ??
              "Thanks for your message. Our team is away right now and will reply as soon as we are back.",
            lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
          }
        : null,
    }));
}

export async function saveOperatorSettings(input: {
  workspaceId: string;
  userId: string;
  timezone: string;
  schedule: unknown;
  availableWhileUsing: boolean;
  appearOffline: boolean;
  notifyEmail?: boolean;
  notifyInApp?: boolean;
  notifyNewConversations?: boolean;
  notifyReplies?: boolean;
  awayReplyEnabled?: boolean;
  awayReplyBody?: string;
  now?: Date;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const membership = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, input.workspaceId),
        eq(workspaceMembers.userId, input.userId),
      ),
    )
    .limit(1);

  const role = membership[0]?.role as WorkspaceRole | undefined;
  if (!role || !isEligible(role)) {
    return { ok: false, error: "Only an owner or admin can be a conversation operator." };
  }
  if (!isValidTimezone(input.timezone)) {
    return { ok: false, error: "Choose a valid IANA timezone, for example Europe/Berlin." };
  }

  const parsed = normalizeSchedule(input.schedule);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const awayReplyBody = (input.awayReplyBody ?? "")
    .trim()
    .slice(0, 2000);
  const awayReplyEnabled = input.awayReplyEnabled ?? false;
  if (awayReplyEnabled && awayReplyBody === "") {
    return { ok: false, error: "Write the away reply customers should receive." };
  }

  const now = input.now ?? new Date();
  await db
    .insert(workspaceOperators)
    .values({
      workspaceId: input.workspaceId,
      userId: input.userId,
      timezone: input.timezone,
      schedule: parsed.schedule,
      availableWhileUsing: input.availableWhileUsing,
      appearOffline: input.appearOffline,
      notifyEmail: input.notifyEmail ?? true,
      notifyInApp: input.notifyInApp ?? true,
      notifyNewConversations: input.notifyNewConversations ?? true,
      notifyReplies: input.notifyReplies ?? true,
      awayReplyEnabled,
      awayReplyBody:
        awayReplyBody ||
        "Thanks for your message. Our team is away right now and will reply as soon as we are back.",
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [workspaceOperators.workspaceId, workspaceOperators.userId],
      set: {
        timezone: input.timezone,
        schedule: parsed.schedule,
        availableWhileUsing: input.availableWhileUsing,
        appearOffline: input.appearOffline,
        notifyEmail: input.notifyEmail ?? true,
        notifyInApp: input.notifyInApp ?? true,
        notifyNewConversations: input.notifyNewConversations ?? true,
        notifyReplies: input.notifyReplies ?? true,
        awayReplyEnabled,
        awayReplyBody:
          awayReplyBody ||
          "Thanks for your message. Our team is away right now and will reply as soon as we are back.",
        updatedAt: now,
      },
    });

  return { ok: true };
}

/** Record that an eligible operator is using the dashboard. */
export async function touchOperatorPresence(input: {
  workspaceId: string;
  userId: string;
  now?: Date;
}): Promise<boolean> {
  const membership = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, input.workspaceId),
        eq(workspaceMembers.userId, input.userId),
      ),
    )
    .limit(1);

  const role = membership[0]?.role as WorkspaceRole | undefined;
  if (!role || !isEligible(role)) return false;

  const now = input.now ?? new Date();
  await db
    .insert(workspaceOperators)
    .values({ workspaceId: input.workspaceId, userId: input.userId, lastSeenAt: now })
    .onConflictDoUpdate({
      target: [workspaceOperators.workspaceId, workspaceOperators.userId],
      set: { lastSeenAt: now, updatedAt: now },
    });
  return true;
}

export type OnlineOperator = { id: string; name: string };

/**
 * Names of eligible operators who are available right now.
 *
 * This is the initial value for the live presence indicator. The SSE stream
 * then adds people as they open the inbox or thread. `appearOffline` always
 * wins, and a schedule restricts a heartbeat when `availableWhileUsing` is off.
 */
export async function listOnlineOperators(
  workspaceId: string,
  now: Date = new Date(),
): Promise<OnlineOperator[]> {
  const rows = await db
    .select({
      userId: workspaceOperators.userId,
      name: user.name,
      timezone: workspaceOperators.timezone,
      schedule: workspaceOperators.schedule,
      availableWhileUsing: workspaceOperators.availableWhileUsing,
    })
    .from(workspaceOperators)
    .innerJoin(user, eq(workspaceOperators.userId, user.id))
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, workspaceOperators.workspaceId),
        eq(workspaceMembers.userId, workspaceOperators.userId),
      ),
    )
    .where(
      and(
        eq(workspaceOperators.workspaceId, workspaceId),
        eq(workspaceOperators.appearOffline, false),
        gt(workspaceOperators.lastSeenAt, new Date(now.getTime() - PRESENCE_WINDOW_MS)),
      ),
    );

  return rows
    .filter((row) =>
      row.availableWhileUsing
        ? true
        : isWithinSchedule(now, row.timezone, row.schedule),
    )
    .map((row) => ({ id: row.userId, name: row.name }));
}

/**
 * True when at least one eligible operator is available right now.
 *
 * If nobody has ever configured an operator, fall back to the existing
 * dashboard-session signal so the widget does not regress on an old workspace.
 */
export async function teamPresence(
  workspaceId: string,
  now: Date = new Date(),
  executor: ReadExecutor = db,
): Promise<boolean> {
  const rows = await executor
    .select({
      timezone: workspaceOperators.timezone,
      schedule: workspaceOperators.schedule,
      availableWhileUsing: workspaceOperators.availableWhileUsing,
      appearOffline: workspaceOperators.appearOffline,
    })
    .from(workspaceOperators)
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, workspaceOperators.workspaceId),
        eq(workspaceMembers.userId, workspaceOperators.userId),
      ),
    )
    .where(
      and(
        eq(workspaceOperators.workspaceId, workspaceId),
        eq(workspaceOperators.appearOffline, false),
        gt(workspaceOperators.lastSeenAt, new Date(now.getTime() - PRESENCE_WINDOW_MS)),
      ),
    );

  if (rows.length > 0) {
    return rows.some((row) => {
      // "Available while using" means the heartbeat alone is enough. Turning it
      // off restricts presence to the configured weekly window.
      if (row.availableWhileUsing) return true;
      return isWithinSchedule(now, row.timezone, row.schedule);
    });
  }

  const configured = await executor
    .select({ userId: workspaceOperators.userId })
    .from(workspaceOperators)
    .where(eq(workspaceOperators.workspaceId, workspaceId))
    .limit(1);

  if (configured.length > 0) return false;

  const cutoff = new Date(now.getTime() - 5 * 60_000);
  const sessions = await executor
    .select({ id: authSession.id })
    .from(authSession)
    .innerJoin(workspaceMembers, eq(workspaceMembers.userId, authSession.userId))
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        gt(authSession.expiresAt, now),
        gt(authSession.updatedAt, cutoff),
      ),
    )
    .limit(1);

  return sessions.length > 0;
}
