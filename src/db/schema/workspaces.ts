import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "@/db/schema/auth";

/**
 * Tenant core: workspaces, their members, and the products inside them.
 *
 * Tenant rules enforced here at the database level:
 *   - workspace slugs are globally unique,
 *   - product slugs are unique *within* a workspace,
 *   - `products` carries a unique (id, workspace_id) pair so other tables can
 *     reference "this product, in this workspace" atomically.
 */

const tz = { withTimezone: true } as const;export const workspaceRoleEnum = pgEnum("workspace_role", [
  "owner",
  "admin",
  "editor",
  "viewer",
]);

/** Plan ids are mirrored from the billing subscription for legacy/manual rows. */
export const workspacePlanEnum = pgEnum("workspace_plan", [
  "free",
  "starter",
  "pro",
  "lifetime",
]);

export type WorkspaceRoleValue = (typeof workspaceRoleEnum.enumValues)[number];
export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    plan: workspacePlanEnum("plan").notNull().default("free"),
    /**
     * Whether public request pages may disclose a planned quarter or date.
     *
     * The field is always stored and visible to the team; this is the policy
     * switch, and it defaults to off so a new workspace cannot leak a target
     * date simply by filling it in.
     */
    publicPlannedFor: boolean("public_planned_for").notNull().default(false),
    /**
     * When on, a new subscriber stays `pending` until they open the
     * confirmation link, so an address is never opted in by someone else.
     */
    doubleOptIn: boolean("double_opt_in").notNull().default(false),
    /**
     * Maximum outbound messages (email and in-app) one customer may receive in
     * the rolling window. Zero disables the cap.
     */
    outboundFrequencyCap: smallint("outbound_frequency_cap").notNull().default(0),
    outboundFrequencyWindowDays: smallint("outbound_frequency_window_days")
      .notNull()
      .default(7),
    /** The user who created it. Not an ownership source of truth — see `workspace_members`. */
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    index("workspaces_created_by_idx").on(t.createdBy),
    check(
      "workspaces_outbound_frequency_cap_ck",
      sql`${t.outboundFrequencyCap} >= 0 AND ${t.outboundFrequencyCap} <= 100`,
    ),
    check(
      "workspaces_outbound_frequency_window_ck",
      sql`${t.outboundFrequencyWindowDays} >= 1 AND ${t.outboundFrequencyWindowDays} <= 365`,
    ),
  ],
);

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: workspaceRoleEnum("role").notNull().default("editor"),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("workspace_members_workspace_user_unique").on(t.workspaceId, t.userId),
    index("workspace_members_user_idx").on(t.userId),
    index("workspace_members_workspace_idx").on(t.workspaceId),
  ],
);

export const products = pgTable(
  "products",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    /**
     * Public surfaces are product-level because a roadmap is not board-scoped.
     * Feedback and the roadmap can be published independently: a team may
     * want a public roadmap while keeping the request threads private, or the
     * other way around.
     */
    publicFeedbackEnabled: boolean("public_feedback_enabled").notNull().default(true),
    publicRoadmapEnabled: boolean("public_roadmap_enabled").notNull().default(false),
    publicChangelogEnabled: boolean("public_changelog_enabled").notNull().default(false),
    /** Opt-in public "shipped this quarter" counter on the portal home. */
    publicShippedCounterEnabled: boolean("public_shipped_counter_enabled")
      .notNull()
      .default(false),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    // Product slugs only have to be unique inside their workspace.
    unique("products_workspace_slug_unique").on(t.workspaceId, t.slug),
    // FK target used to guarantee "product belongs to workspace" atomically.
    unique("products_id_workspace_unique").on(t.id, t.workspaceId),
    index("products_workspace_idx").on(t.workspaceId),
  ],
);

export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;