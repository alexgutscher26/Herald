import { boolean, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { user } from "@/db/schema/auth";
import { products, workspaces } from "@/db/schema/workspaces";

const tz = { withTimezone: true } as const;

/**
 * A GitHub App installation selected for one product.
 *
 * The App private key stays in the deployment environment; only the
 * installation id and public account metadata are stored. An installation
 * token is minted on demand and never persisted, so a leaked database row
 * cannot call GitHub.
 */
export const githubAppInstallations = pgTable(
  "github_app_installations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    installationId: text("installation_id").notNull().unique(),
    accountLogin: text("account_login").notNull(),
    accountType: text("account_type").notNull().default("Organization"),
    repositorySelection: text("repository_selection").notNull().default("all"),
    active: boolean("active").notNull().default(true),
    installedBy: text("installed_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("github_app_installations_product_unique").on(t.productId),
    index("github_app_installations_workspace_idx").on(t.workspaceId, t.active),
  ],
);

export type GithubAppInstallation = typeof githubAppInstallations.$inferSelect;
