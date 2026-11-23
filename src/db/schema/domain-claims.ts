import { index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { user } from "@/db/schema/auth";
import { workspaces, workspaceRoleEnum } from "@/db/schema/workspaces";

const tz = { withTimezone: true } as const;

/**
 * A company email domain one workspace has claimed.
 *
 * Claiming is what makes "everyone at acme.com joins us" safe: the domain is
 * unique across the installation, so two workspaces cannot capture the same
 * company, and a claim only takes effect after its DNS TXT challenge is present.
 * Until then it is stored as `pending` and joins nobody.
 *
 * A personal mailbox provider (gmail.com and friends) is rejected by the
 * service, because claiming one would enroll strangers who happen to share a
 * provider, not a company.
 */
export const workspaceDomainClaims = pgTable(
  "workspace_domain_claims",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Bare, lowercased domain such as `acme.com`. */
    domain: text("domain").notNull().unique(),
    /**
     * The role a new sign-up gets. Never `owner`; a captured domain must not be
     * able to mint owners. Viewers are free seats, so they are always allowed.
     */
    role: workspaceRoleEnum("role").notNull().default("editor"),
    verificationToken: text("verification_token").notNull(),
    status: text("status").notNull().default("pending"),
    verifiedAt: timestamp("verified_at", tz),
    lastCheckedAt: timestamp("last_checked_at", tz),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("workspace_domain_claims_workspace_unique").on(t.workspaceId),
    index("workspace_domain_claims_status_idx").on(t.status),
  ],
);

export type WorkspaceDomainClaim = typeof workspaceDomainClaims.$inferSelect;
