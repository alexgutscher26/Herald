import { sql } from "drizzle-orm";
import { boolean, check, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Better Auth core tables for better-auth 1.7.x with the Drizzle adapter.
 *
 * Verified against the installed package via `getSchema()` from
 * `better-auth/db`: the core models are `user`, `session`, `account` and
 * `verification`, and their expected field names are camelCase
 * (`emailVerified`, `userId`, `expiresAt`, `accessTokenExpiresAt`, ...).
 *
 * Two conventions matter for the adapter to resolve columns correctly:
 *   - the schema export keys must be exactly `user` / `session` / `account`
 *     / `verification` (the adapter keys off the export name, not the SQL
 *     table name), and
 *   - the Drizzle *property* names must match Better Auth's field names.
 *
 * SQL column names are snake_case like the rest of the schema.
 * Timestamps are timezone-aware (`timestamptz`).
 */

const tz = { withTimezone: true } as const;

export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    /** Product onboarding tips only; never product updates or billing mail. */
    onboardingEmails: boolean("onboarding_emails").notNull().default(true),
    image: text("image"),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    // A profile image is a URL, never an inline image payload.
    check(
      "user_image_not_inline_ck",
      sql`${t.image} is null or (${t.image} not like 'data:%' and ${t.image} not like 'blob:%')`,
    ),
  ],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", tz).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", tz),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", tz),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    index("account_user_id_idx").on(t.userId),
    index("account_provider_account_idx").on(t.providerId, t.accountId),
  ],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", tz).notNull(),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

/**
 * Better Auth SSO provider configuration (`@better-auth/sso`).
 *
 * The export key must be `ssoProvider` because the Drizzle adapter resolves
 * the plugin's model by export name. SAML/OIDC config is stored as JSON text
 * by the plugin; a workspace only ever sees its own row through the service.
 * The plugin's provider registration endpoint is the only writer.
 */
export const ssoProvider = pgTable(
  "sso_provider",
  {
    id: text("id").primaryKey(),
    issuer: text("issuer").notNull(),
    domain: text("domain").notNull(),
    oidcConfig: text("oidc_config"),
    samlConfig: text("saml_config"),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    providerId: text("provider_id").notNull().unique(),
    organizationId: text("organization_id"),
    domainVerified: boolean("domain_verified").notNull().default(false),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [index("sso_provider_domain_idx").on(t.domain)],
);

export type User = typeof user.$inferSelect;
export type Session = typeof session.$inferSelect;
export type Account = typeof account.$inferSelect;
export type Verification = typeof verification.$inferSelect;