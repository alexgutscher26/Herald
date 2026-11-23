import { index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { products, workspaces } from "@/db/schema/workspaces";

const tz = { withTimezone: true } as const;

/**
 * One customer-owned hostname per workspace.
 *
 * `verification_token` is written to a DNS TXT record
 * (`_herald.<domain>`). Verification and the subsequent health check are
 * explicit operator actions, and every result is stored with its timestamp so
 * the settings screen never claims a check that did not run.
 *
 * TLS is terminated by the deployment platform; the health check verifies the
 * public `/api/health?scope=readiness` response rather than implying that a
 * DNS record alone made the domain live.
 */
export const workspaceDomains = pgTable(
  "workspace_domains",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    domain: text("domain").notNull().unique(),
    verificationToken: text("verification_token").notNull(),
    status: text("status").notNull().default("pending"),
    verifiedAt: timestamp("verified_at", tz),
    lastCheckedAt: timestamp("last_checked_at", tz),
    healthStatus: text("health_status").notNull().default("unknown"),
    healthMessage: text("health_message"),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("workspace_domains_workspace_unique").on(t.workspaceId),
    index("workspace_domains_status_idx").on(t.status),
    index("workspace_domains_product_idx").on(t.productId),
  ],
);

export type WorkspaceDomain = typeof workspaceDomains.$inferSelect;
