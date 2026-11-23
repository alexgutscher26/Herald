import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { workspaces } from "@/db/schema/workspaces";

const tz = { withTimezone: true } as const;

/**
 * Per-workspace customer identity configuration.
 *
 * The SSO signing secret is stored encrypted, never in plaintext: a database
 * read alone must not be enough to mint an identity token. `ssoEnabled` is a
 * separate switch so rotating a secret cannot accidentally re-open sign-in.
 *
 * `ssoIssuer` and `ssoAudience` are the expected `iss`/`aud` claims. They are
 * optional here but validated as required claims; a workspace that enables SSO
 * is shown the values it must sign.
 */
export const workspaceIdentitySettings = pgTable("workspace_identity_settings", {
  workspaceId: uuid("workspace_id")
    .primaryKey()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  ssoEnabled: boolean("sso_enabled").notNull().default(false),
  /** `v1.<iv>.<tag>.<ciphertext>`, AES-256-GCM under a derived key. */
  ssoSecretEncrypted: text("sso_secret_encrypted"),
  /**
   * Outgoing secret during a rotation. It keeps verifying until the matching
   * expiry, so a deployment can pick up the new secret without an outage.
   */
  ssoSecretPreviousEncrypted: text("sso_secret_previous_encrypted"),
  ssoSecretPreviousExpiresAt: timestamp("sso_secret_previous_expires_at", tz),
  ssoIssuer: text("sso_issuer"),
  ssoAudience: text("sso_audience"),
  /** Reserved for the widget: an unsigned identify call is never accepted. */
  requireSignedTokens: boolean("require_signed_tokens").notNull().default(true),
  /** Paid plans can hide customer names and avatars on public surfaces. */
  maskCustomerIdentity: boolean("mask_customer_identity").notNull().default(false),
  createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
});

/**
 * Single-use magic-link tokens.
 *
 * Only a hash of the token is stored, so a database read cannot be replayed as
 * a sign-in link. `next_path` is restricted to a same-site path by the caller
 * and is re-validated on consumption. Rows are workspace-scoped: a token from
 * one workspace can never sign a visitor into another.
 */
export const customerLoginTokens = pgTable(
  "customer_login_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Address exactly as supplied, for the email body. */
    email: text("email").notNull(),
    /** Canonical address; the identity key. */
    emailNormalized: text("email_normalized").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    nextPath: text("next_path"),
    expiresAt: timestamp("expires_at", tz).notNull(),
    usedAt: timestamp("used_at", tz),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    index("customer_login_tokens_workspace_email_idx").on(
      t.workspaceId,
      t.emailNormalized,
      t.createdAt,
    ),
    index("customer_login_tokens_expires_at_idx").on(t.expiresAt),
  ],
);

export type WorkspaceIdentitySettings = typeof workspaceIdentitySettings.$inferSelect;
export type CustomerLoginToken = typeof customerLoginTokens.$inferSelect;
