import { index, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { user } from "@/db/schema/auth";
import { workspaces } from "@/db/schema/workspaces";

const tz = { withTimezone: true } as const;

export const emailSuppressionReasonEnum = pgEnum("email_suppression_reason", [
  "hard_bounce",
  "complaint",
  "manual",
  "unsubscribe",
]);

export const emailVerificationPurposeEnum = pgEnum("email_verification_purpose", [
  "from",
  "reply_to",
]);

/**
 * Addresses that must never receive another message from a workspace.
 *
 * The raw address is kept for support, and the normalized form is the unique
 * key. Suppression is checked immediately before every send; a suppressed
 * delivery is marked `skipped`, not retried.
 */
export const emailSuppressions = pgTable(
  "email_suppressions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    emailNormalized: text("email_normalized").notNull(),
    reason: emailSuppressionReasonEnum("reason").notNull(),
    note: text("note"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("email_suppressions_workspace_email_unique").on(
      t.workspaceId,
      t.emailNormalized,
    ),
    index("email_suppressions_email_idx").on(t.emailNormalized),
  ],
);

export type EmailSuppression = typeof emailSuppressions.$inferSelect;
export type NewEmailSuppression = typeof emailSuppressions.$inferInsert;

/**
 * Per-workspace sender identity for marketing and lifecycle email.
 *
 * The deployment's EMAIL_FROM remains the fallback for workspaces that have
 * not configured an identity, but a campaign cannot be approved or sent until
 * the workspace supplies a verified From address, a reply-to and the physical
 * address required by anti-spam law. Keeping this separate from the brand
 * profile means changing a logo never changes who legally sent an email.
 */
export const workspaceEmailIdentities = pgTable(
  "workspace_email_identities",
  {
    workspaceId: uuid("workspace_id")
      .primaryKey()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    fromName: text("from_name").notNull(),
    fromEmail: text("from_email").notNull(),
    replyTo: text("reply_to"),
    postalAddress: text("postal_address").notNull(),
    /** Set only after the address owner opens a single-use verification link. */
    fromVerifiedAt: timestamp("from_verified_at", tz),
    replyToVerifiedAt: timestamp("reply_to_verified_at", tz),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
);

/**
 * Single-use mailbox verification tokens.
 *
 * Only the SHA-256 hash is stored, so a database read cannot mint a working
 * link. A token is scoped to one workspace, purpose and address; changing the
 * address in settings makes earlier tokens inert.
 */
export const emailIdentityVerifications = pgTable(
  "email_identity_verifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    purpose: emailVerificationPurposeEnum("purpose").notNull(),
    address: text("address").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", tz).notNull(),
    usedAt: timestamp("used_at", tz),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("email_identity_verifications_token_hash_unique").on(t.tokenHash),
    index("email_identity_verifications_workspace_purpose_idx").on(
      t.workspaceId,
      t.purpose,
    ),
  ],
);

export type WorkspaceEmailIdentity = typeof workspaceEmailIdentities.$inferSelect;
export type NewWorkspaceEmailIdentity = typeof workspaceEmailIdentities.$inferInsert;
export type EmailIdentityVerification = typeof emailIdentityVerifications.$inferSelect;
