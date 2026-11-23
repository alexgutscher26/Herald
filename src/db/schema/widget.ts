import { sql } from "drizzle-orm";
import {
  check,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { workspaces } from "@/db/schema/workspaces";

const tz = { withTimezone: true } as const;

/**
 * Per-workspace widget configuration.
 *
 * The public key is an identifier, not a secret: it lets the embed route and
 * installation checks reject stale or misconfigured snippets without requiring
 * a cookie. Allowed origins are empty by default, which means any origin may
 * embed the public widget; once configured, only those origins are accepted.
 */
export const workspaceWidgetSettings = pgTable(
  "workspace_widget_settings",
  {
    workspaceId: uuid("workspace_id")
      .primaryKey()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    publicKey: text("public_key").notNull().unique(),
    allowedOrigins: jsonb("allowed_origins")
      .$type<string[]>()
      .notNull()
      .default([]),
    position: text("position").notNull().default("bottom-right"),
    theme: text("theme").notNull().default("auto"),
    /** Extra panels shown next to the always-on changelog view. */
    sections: jsonb("sections")
      .$type<string[]>()
      .notNull()
      .default(["feedback", "roadmap"]),
    /**
     * Per-origin launcher position/theme overrides, e.g.
     * `[{ origin: "https://app.example.com", theme: "dark" }]`. An origin
     * must also be in `allowedOrigins`; validation lives in `policy.ts`.
     */
    originOverrides: jsonb("origin_overrides")
      .$type<unknown[]>()
      .notNull()
      .default([]),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    check(
      "workspace_widget_settings_position_ck",
      sql`${t.position} in ('bottom-right', 'bottom-left', 'top-right', 'top-left')`,
    ),
    check(
      "workspace_widget_settings_theme_ck",
      sql`${t.theme} in ('light', 'dark', 'auto')`,
    ),
  ],
);

export type WorkspaceWidgetSettings = typeof workspaceWidgetSettings.$inferSelect;
