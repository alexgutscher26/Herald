import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { user } from "@/db/schema/auth";
import { workspaces } from "@/db/schema/workspaces";

const tz = { withTimezone: true } as const;

/**
 * A workspace deletion request.
 *
 * The workspace remains available during the grace period. `purgeAfter` is the
 * only authority that permits the destructive job to run, and cancelling leaves
 * an audit-friendly row rather than deleting the request history. A workspace
 * can have at most one current request.
 */
export const workspaceDeletions = pgTable(
  "workspace_deletions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .unique()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    requestedBy: text("requested_by").references(() => user.id, {
      onDelete: "set null",
    }),
    requestedAt: timestamp("requested_at", tz).notNull().defaultNow(),
    purgeAfter: timestamp("purge_after", tz).notNull(),
    cancelledAt: timestamp("cancelled_at", tz),
    reason: text("reason"),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    index("workspace_deletions_due_idx").on(t.purgeAfter, t.cancelledAt),
    index("workspace_deletions_workspace_idx").on(t.workspaceId),
  ],
);

/**
 * Sensitive workspace actions.
 *
 * This is intentionally not a copy of the application log: it stores the
 * durable who/what/when needed for billing, access and data-request reviews.
 * Metadata must never contain secrets, raw tokens, passwords or email bodies.
 * Retention is enforced by the operations job, not by the UI.
 */
export const workspaceAuditEvents = pgTable(
  "workspace_audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Intentionally not a foreign key: the audit trail must survive the
    // workspace deletion it records.
    workspaceId: uuid("workspace_id").notNull(),
    actorUserId: text("actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    metadata: text("metadata"),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    index("workspace_audit_events_workspace_time_idx").on(
      t.workspaceId,
      t.createdAt,
    ),
    index("workspace_audit_events_action_time_idx").on(t.action, t.createdAt),
  ],
);

export type WorkspaceDeletion = typeof workspaceDeletions.$inferSelect;
export type NewWorkspaceDeletion = typeof workspaceDeletions.$inferInsert;
export type WorkspaceAuditEvent = typeof workspaceAuditEvents.$inferSelect;
export type NewWorkspaceAuditEvent = typeof workspaceAuditEvents.$inferInsert;
