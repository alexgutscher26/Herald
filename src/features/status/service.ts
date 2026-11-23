import "server-only";

import { desc, gte, sql } from "drizzle-orm";

import { db } from "@/db";
import { jobRuns } from "@/db/schema";
import {
  checkBackups,
  checkDatabase,
  checkEmail,
  checkQueue,
  checkStorage,
  type CheckState,
} from "@/features/status/checks";

/**
 * Public status model.
 *
 * Everything here is an aggregate or a coarse state. No workspace id, email,
 * job payload, provider message or error string is ever returned: the page is
 * unauthenticated, so its data must be safe to show to anyone.
 *
 * Each check is isolated. A database outage makes the database component
 * `outage` while the remaining checks fail closed to `degraded` instead of
 * taking the whole status page down with them.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const WORKER_STALE_MINUTES = 15;

export type StatusState = "operational" | "degraded" | "outage";
export type HistoryState = StatusState | "no-data";

export type StatusComponent = {
  id: string;
  name: string;
  description: string;
  state: StatusState;
  detail: string;
};

export type StatusHistoryDay = {
  date: string;
  runs: number;
  failed: number;
  state: HistoryState;
};

export type PublicStatus = {
  overall: StatusState;
  checkedAt: string;
  components: StatusComponent[];
  history: StatusHistoryDay[];
};

function toStatusState(state: CheckState): StatusState {
  if (state === "ok") return "operational";
  if (state === "unavailable") return "outage";
  return "degraded";
}

async function workerComponent(now: Date): Promise<{ state: StatusState; detail: string }> {
  try {
    const rows = await db
      .select({
        startedAt: jobRuns.startedAt,
        failed: jobRuns.failed,
      })
      .from(jobRuns)
      .orderBy(desc(jobRuns.startedAt))
      .limit(1);
    const latest = rows[0];
    const queue = await checkQueue(now);
    const queueNote =
      queue.depth > 0 ? ` ${queue.depth} job${queue.depth === 1 ? "" : "s"} overdue.` : "";

    if (!latest) {
      return {
        state: "degraded",
        detail: `No background worker run has been recorded yet.${queueNote}`,
      };
    }

    const ageMinutes = Math.max(
      0,
      Math.round((now.getTime() - latest.startedAt.getTime()) / 60_000),
    );
    if (ageMinutes > WORKER_STALE_MINUTES) {
      return {
        state: "degraded",
        detail: `The last worker run was ${ageMinutes} minutes ago.${queueNote}`,
      };
    }
    if (latest.failed > 0) {
      return {
        state: "degraded",
        detail: `The last worker run reported ${latest.failed} failed job${
          latest.failed === 1 ? "" : "s"
        }.${queueNote}`,
      };
    }
    return {
      state: "operational",
      detail: `The last worker run completed ${
        ageMinutes === 0 ? "moments" : `${ageMinutes} minute${ageMinutes === 1 ? "" : "s"}`
      } ago.${queueNote}`,
    };
  } catch {
    return { state: "degraded", detail: "Queue health could not be read." };
  }
}

async function history(now: Date): Promise<StatusHistoryDay[]> {
  try {
    const since = new Date(now.getTime() - 13 * DAY_MS);
    const rows = await db
      .select({
        day: sql<string>`to_char(${jobRuns.startedAt} at time zone 'utc', 'YYYY-MM-DD')`,
        runs: sql<number>`count(*)::int`,
        failed: sql<number>`coalesce(sum(${jobRuns.failed}), 0)::int`,
      })
      .from(jobRuns)
      .where(gte(jobRuns.startedAt, since))
      .groupBy(sql`1`)
      .orderBy(sql`1`);

    const byDay = new Map(rows.map((row) => [row.day, row]));
    const days: StatusHistoryDay[] = [];
    for (let offset = 13; offset >= 0; offset -= 1) {
      const date = new Date(now.getTime() - offset * DAY_MS).toISOString().slice(0, 10);
      const row = byDay.get(date);
      days.push({
        date,
        runs: row?.runs ?? 0,
        failed: row?.failed ?? 0,
        state: !row ? "no-data" : row.failed > 0 ? "degraded" : "operational",
      });
    }
    return days;
  } catch {
    return [];
  }
}

function overallFor(components: StatusComponent[]): StatusState {
  // Email and backup verification are supporting services: their outage is
  // visible on the component row but must not claim the dashboard and API are
  // down. Readiness follows the same rule (database and storage only).
  const criticalOutage = components.some(
    (component) =>
      component.state === "outage" &&
      component.id !== "email" &&
      component.id !== "backups",
  );
  if (criticalOutage) return "outage";
  if (
    components.some(
      (component) => component.state === "degraded" || component.state === "outage",
    )
  ) {
    return "degraded";
  }
  return "operational";
}

export async function getPublicStatus(now = new Date()): Promise<PublicStatus> {
  const [database, storage, worker, email, backups] = await Promise.all([
    checkDatabase(),
    checkStorage(now),
    workerComponent(now),
    checkEmail(now),
    checkBackups(now),
  ]);

  const components: StatusComponent[] = [
    {
      id: "api",
      name: "Dashboard and API",
      description: "Signed-in pages, the REST API and public request handling.",
      // Serving this page proves the application is answering requests. The
      // database check below carries the real dependency signal.
      state: "operational",
      detail: "Requests are being served.",
    },
    {
      id: "database",
      name: "Database",
      description: "Postgres reads and writes for workspaces, feedback and releases.",
      state: toStatusState(database.state),
      detail: database.detail,
    },
    {
      id: "storage",
      name: "File storage",
      description: "Attachments, release covers, exports and the backup manifest.",
      state: toStatusState(storage.state),
      detail: storage.detail,
    },
    {
      id: "workers",
      name: "Background jobs",
      description: "Publishing, email delivery, imports and scheduled maintenance.",
      ...worker,
    },
    {
      id: "email",
      name: "Email delivery",
      description: "Product updates, request notifications and billing notices.",
      state: toStatusState(email.state),
      detail: email.detail,
    },
    {
      id: "backups",
      name: "Backup verification",
      description: "Scheduled checks that a restore would still find the database and storage.",
      state: toStatusState(backups.state),
      detail: backups.detail,
    },
  ];

  return {
    overall: overallFor(components),
    checkedAt: now.toISOString(),
    components,
    history: await history(now),
  };
}
