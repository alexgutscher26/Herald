import {
  bigint,
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { workspaces } from "@/db/schema/workspaces";

const tz = { withTimezone: true } as const;

/**
 * Public end users, scoped to a workspace.
 *
 * Customers are deliberately NOT Better Auth `user` rows. A public board
 * visitor may be anonymous, may belong to a company, and must never gain
 * dashboard access; workspace members and customers are different principals.
 *
 * `email` is nullable because a guest session exists before the visitor
 * supplies an address. Uniqueness only applies once an address is present —
 * Postgres allows multiple NULLs in a unique index.
 *
 * `traits` holds customer-supplied attributes (plan, locale, company size…)
 * without a migration per attribute. Keep secrets out of it: it is readable by
 * workspace members and may be projected publicly.
 */
export type CustomerTraits = Record<string, unknown>;

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Identifier from the customer's own app/CRM; unique inside a workspace. */
    externalId: text("external_id"),
    /** Address exactly as supplied, for display and replies. */
    email: text("email"),
    /** Canonical form produced by `normalizeEmail`; the de-duplication key. */
    emailNormalized: text("email_normalized"),
    name: text("name"),
    avatarUrl: text("avatar_url"),
    traits: jsonb("traits").$type<CustomerTraits>().notNull().default({}),
    /** Read-only CRM cache. Only the CRM sync job writes these columns. */
    crmProvider: text("crm_provider"),
    crmExternalId: text("crm_external_id"),
    crmCompanyExternalId: text("crm_company_external_id"),
    crmLifecycleStage: text("crm_lifecycle_stage"),
    crmSyncedAt: timestamp("crm_synced_at", tz),
    verifiedAt: timestamp("verified_at", tz),
    bannedAt: timestamp("banned_at", tz),
    lastSeenAt: timestamp("last_seen_at", tz),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("customers_workspace_email_unique").on(t.workspaceId, t.emailNormalized),
    unique("customers_workspace_external_unique").on(t.workspaceId, t.externalId),
    // FK target so company memberships and sessions cannot cross workspaces.
    unique("customers_id_workspace_unique").on(t.id, t.workspaceId),
    index("customers_workspace_last_seen_idx").on(t.workspaceId, t.lastSeenAt),
    index("customers_workspace_banned_idx").on(t.workspaceId, t.bannedAt),
  ],
);

export type CustomerCompanyTraits = Record<string, unknown>;

export const customerCompanies = pgTable(
  "customer_companies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Company id from an external system (CRM, billing); nullable. */
    externalId: text("external_id"),
    name: text("name").notNull(),
    /** Domain as supplied. Domain ownership is never assumed from an email. */
    domain: text("domain"),
    domainNormalized: text("domain_normalized"),
    traits: jsonb("traits").$type<CustomerCompanyTraits>().notNull().default({}),
    /** Read-only CRM cache. Only the CRM sync job writes these columns. */
    crmProvider: text("crm_provider"),
    crmExternalId: text("crm_external_id"),
    crmContactCount: integer("crm_contact_count"),
    crmOpenDealCount: integer("crm_open_deal_count"),
    crmOpenDealValueCents: bigint("crm_open_deal_value_cents", { mode: "number" }),
    crmAnnualRevenueCents: bigint("crm_annual_revenue_cents", { mode: "number" }),
    crmSyncedAt: timestamp("crm_synced_at", tz),
    crmSyncError: text("crm_sync_error"),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("customer_companies_workspace_external_unique").on(t.workspaceId, t.externalId),
    // FK target for memberships.
    unique("customer_companies_id_workspace_unique").on(t.id, t.workspaceId),
    index("customer_companies_workspace_name_idx").on(t.workspaceId, t.name),
    index("customer_companies_workspace_domain_idx").on(
      t.workspaceId,
      t.domainNormalized,
    ),
  ],
);

/**
 * Many-to-many between customers and companies.
 *
 * Both composite foreign keys include `workspace_id`, so a membership can
 * never pair a customer from one workspace with a company from another.
 */
export const customerCompanyMemberships = pgTable(
  "customer_company_memberships",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").notNull(),
    companyId: uuid("company_id").notNull(),
    /** Free-form role/title inside the company (owner, admin, member…). */
    role: text("role"),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: "customer_company_memberships_pk",
      columns: [t.companyId, t.customerId],
    }),
    foreignKey({
      name: "customer_company_memberships_customer_fk",
      columns: [t.customerId, t.workspaceId],
      foreignColumns: [customers.id, customers.workspaceId],
    }).onDelete("cascade"),
    foreignKey({
      name: "customer_company_memberships_company_fk",
      columns: [t.companyId, t.workspaceId],
      foreignColumns: [customerCompanies.id, customerCompanies.workspaceId],
    }).onDelete("cascade"),
    index("customer_company_memberships_customer_idx").on(t.customerId),
    index("customer_company_memberships_company_idx").on(t.companyId),
  ],
);

/**
 * Short-lived public sessions, stored as a hash of the cookie token.
 *
 * A guest session carries no email until the visitor supplies one, which is
 * what lets someone vote or follow before creating an account. The raw token
 * is never persisted; lookups hash the cookie value first.
 */
export const customerSessions = pgTable(
  "customer_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    guest: boolean("guest").notNull().default(true),
    expiresAt: timestamp("expires_at", tz).notNull(),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "customer_sessions_customer_fk",
      columns: [t.customerId, t.workspaceId],
      foreignColumns: [customers.id, customers.workspaceId],
    }).onDelete("cascade"),
    index("customer_sessions_customer_idx").on(t.customerId),
    index("customer_sessions_expires_at_idx").on(t.expiresAt),
  ],
);

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
export type CustomerCompany = typeof customerCompanies.$inferSelect;
export type NewCustomerCompany = typeof customerCompanies.$inferInsert;
export type CustomerCompanyMembership = typeof customerCompanyMemberships.$inferSelect;
export type NewCustomerCompanyMembership = typeof customerCompanyMemberships.$inferInsert;
export type CustomerSession = typeof customerSessions.$inferSelect;
export type NewCustomerSession = typeof customerSessions.$inferInsert;
