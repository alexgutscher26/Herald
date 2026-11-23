import {
  boolean,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "@/db/schema/auth";
import { workspaceMembers, workspaces } from "@/db/schema/workspaces";

const tz = { withTimezone: true } as const;

/**
 * Enterprise identity settings for team sign-in.
 *
 * This sits beside the customer HS256 JWT configuration in
 * `workspaceIdentitySettings`: that one signs end users into the widget, this
 * one governs how workspace members sign in. `providerId` matches the Better
 * Auth SSO provider (`workspace-<workspaceId>`), and is never supplied by the
 * client.
 */
export const workspaceEnterpriseIdentity = pgTable(
  "workspace_enterprise_identity",
  {
    workspaceId: uuid("workspace_id")
      .primaryKey()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    providerId: text("provider_id"),
    samlIssuer: text("saml_issuer"),
    samlDomain: text("saml_domain"),
    samlEnabled: boolean("saml_enabled").notNull().default(false),
    /** When true, a session without a linked SSO account is sent to sign-in. */
    enforced: boolean("enforced").notNull().default(false),
    configuredAt: timestamp("configured_at", tz),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [index("workspace_enterprise_identity_enforced_idx").on(t.enforced)],
);

/**
 * SCIM bearer credentials. Only a SHA-256 digest is stored, so a database read
 * cannot be replayed against the provisioning API. A token belongs to exactly
 * one workspace; the route resolves that workspace from the token and then
 * checks it matches the URL.
 */
export const workspaceScimTokens = pgTable(
  "workspace_scim_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    prefix: text("prefix").notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    lastUsedAt: timestamp("last_used_at", tz),
    revokedAt: timestamp("revoked_at", tz),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [index("workspace_scim_tokens_workspace_idx").on(t.workspaceId, t.createdAt)],
);

/**
 * Reusable permission sets scoped to one workspace.
 *
 * A custom role is additive: the effective permissions are the member's base
 * role plus this set. Owner-only permissions cannot be granted here (see
 * `validateCustomPermissions`), so a custom admin role cannot escalate past
 * the person who assigned it.
 */
export const workspaceCustomRoles = pgTable(
  "workspace_custom_roles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    permissions: jsonb("permissions").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("workspace_custom_roles_workspace_name_unique").on(t.workspaceId, t.name),
    index("workspace_custom_roles_workspace_idx").on(t.workspaceId),
  ],
);

export const workspaceMemberCustomRoles = pgTable(
  "workspace_member_custom_roles",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    customRoleId: uuid("custom_role_id")
      .notNull()
      .references(() => workspaceCustomRoles.id, { onDelete: "cascade" }),
    assignedAt: timestamp("assigned_at", tz).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: "workspace_member_custom_roles_pk",
      columns: [t.workspaceId, t.userId],
    }),
    index("workspace_member_custom_roles_role_idx").on(t.customRoleId),
  ],
);

export type WorkspaceEnterpriseIdentity = typeof workspaceEnterpriseIdentity.$inferSelect;
export type WorkspaceScimToken = typeof workspaceScimTokens.$inferSelect;
export type WorkspaceCustomRole = typeof workspaceCustomRoles.$inferSelect;
