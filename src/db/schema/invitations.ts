import { index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { user } from "@/db/schema/auth";
import { workspaces, workspaceRoleEnum } from "@/db/schema/workspaces";

const tz = { withTimezone: true } as const;

/**
 * A pending team invitation.
 *
 * Only the SHA-256 hash of the invitation token is stored. The raw link is
 * returned once to the inviter, so an operator can copy it even when outbound
 * email is not configured. Accepting requires a signed-in account whose
 * normalized email matches the invite.
 */
export const workspaceInvitations = pgTable(
  "workspace_invitations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    emailNormalized: text("email_normalized").notNull(),
    role: workspaceRoleEnum("role").notNull().default("editor"),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: text("invited_by").references(() => user.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", tz).notNull(),
    acceptedAt: timestamp("accepted_at", tz),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("workspace_invitations_workspace_email_unique").on(
      t.workspaceId,
      t.emailNormalized,
    ),
    index("workspace_invitations_workspace_idx").on(t.workspaceId),
    index("workspace_invitations_expires_idx").on(t.expiresAt),
  ],
);

export type WorkspaceInvitation = typeof workspaceInvitations.$inferSelect;
