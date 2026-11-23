import { sql } from "drizzle-orm";
import { boolean, check, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { workspaces } from "@/db/schema/workspaces";

const tz = { withTimezone: true } as const;

/**
 * Public surface appearance.
 *
 * Branding is workspace-wide: one logo, name and accent colour across every
 * product's public board. `auto` locale means the visitor's browser decides;
 * `auto` theme follows the operating system. An explicit value always wins.
 */
export const publicThemeEnum = pgEnum("public_theme", ["light", "dark", "auto"]);
export const publicLocaleEnum = pgEnum("public_locale", ["auto", "en", "es"]);

export const workspaceBranding = pgTable(
  "workspace_branding",
  {
    workspaceId: uuid("workspace_id")
      .primaryKey()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Shown on public pages instead of the internal workspace name. */
    brandName: text("brand_name"),
    /** Storage key for a validated image upload. */
    logoKey: text("logo_key"),
    /** Six-digit hex, e.g. #4f46e5. Null keeps the default accent. */
    primaryColor: text("primary_color"),
    theme: publicThemeEnum("theme").notNull().default("light"),
    locale: publicLocaleEnum("locale").notNull().default("auto"),
    /** Explicit opt-in before stored help/outbound translations are served. */
    contentTranslationEnabled: boolean("content_translation_enabled")
      .notNull()
      .default(false),
    /** Paid plans may remove the small "Powered by Herald" public footer. */
    hideAttribution: boolean("hide_attribution").notNull().default(false),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    // The logo is a storage key; an inline payload never belongs in a row.
    check(
      "workspace_branding_logo_inline_ck",
      sql`${t.logoKey} is null or (${t.logoKey} not like 'data:%' and ${t.logoKey} not like 'blob:%')`,
    ),
  ],
);

export type WorkspaceBranding = typeof workspaceBranding.$inferSelect;
export type NewWorkspaceBranding = typeof workspaceBranding.$inferInsert;
export type PublicThemeValue = WorkspaceBranding["theme"];
export type PublicLocaleValue = WorkspaceBranding["locale"];
