import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "@/db/schema/auth";
import { workspaces } from "@/db/schema/workspaces";

const tz = { withTimezone: true } as const;

export const API_SCOPES = [
  "read",
  "write",
  "feedback:read",
  "support:read",
  "admin",
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

/**
 * Workspace-scoped bearer tokens for `/api/v1`.
 *
 * Only the SHA-256 hash of the token is stored. `prefix` is a short,
 * non-secret identifier shown in listings so a person can tell two tokens
 * apart without either being recoverable from the database, and `scopes`
 * limits a token to reads or to reads and writes.
 *
 * A token belongs to exactly one workspace. Every API query resolves the
 * workspace from the token and never from a header or path segment, so a
 * token from workspace A cannot name workspace B.
 */
export const apiTokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    prefix: text("prefix").notNull(),
    scopes: jsonb("scopes").$type<ApiScope[]>().notNull().default(["read", "write"]),
    lastUsedAt: timestamp("last_used_at", tz),
    /**
     * Coarse display metadata from the last authenticated request: a network
     * prefix (/24 IPv4, /48 IPv6) and a short user-agent label. A full client
     * IP is never stored.
     */
    lastUsedIpPrefix: text("last_used_ip_prefix"),
    lastUsedUserAgent: text("last_used_user_agent"),
    /** When the token stops working. A future value is a rotation grace period. */
    revokedAt: timestamp("revoked_at", tz),
    /** Hard expiry for OAuth-issued tokens; `null` for manually created tokens. */
    expiresAt: timestamp("expires_at", tz),
    /** The token this one replaced, for the audit view. */
    rotatedFromId: uuid("rotated_from_id"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    index("api_tokens_workspace_created_idx").on(t.workspaceId, t.createdAt),
    index("api_tokens_prefix_idx").on(t.prefix),
    check("api_tokens_name_ck", sql`length(${t.name}) between 1 and 120`),
    check(
      "api_tokens_scopes_ck",
      sql`jsonb_typeof(${t.scopes}) = 'array' and ${t.scopes} <@ '["read","write","feedback:read","support:read","admin"]'::jsonb`,
    ),
    check(
      "api_tokens_last_seen_ck",
      sql`(${t.lastUsedIpPrefix} is null or length(${t.lastUsedIpPrefix}) between 9 and 64)
        and (${t.lastUsedUserAgent} is null or length(${t.lastUsedUserAgent}) between 1 and 120)`,
    ),
  ],
);

/**
 * A stored first response for one `Idempotency-Key`.
 *
 * The row is claimed with an insert before the write runs, so two concurrent
 * retries cannot both execute the mutation. `response_status` stays null while
 * the first request is in flight; a retry in that window is told to try again
 * rather than running the write twice.
 *
 * `request_hash` covers the method, path and body. Reusing a key for a
 * different payload is a client error, never a silent replay of unrelated
 * content. Rows expire after the deployment's configured TTL (24 hours by
 * default); an expired key is claimable again.
 */
export const apiIdempotencyKeys = pgTable(
  "api_idempotency_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    tokenId: uuid("token_id")
      .notNull()
      .references(() => apiTokens.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    endpoint: text("endpoint").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body").$type<unknown>(),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", tz).notNull(),
  },
  (t) => [
    unique("api_idempotency_keys_workspace_key_unique").on(t.workspaceId, t.key),
    index("api_idempotency_keys_expires_idx").on(t.expiresAt),
    index("api_idempotency_keys_token_idx").on(t.tokenId),
  ],
);

export type ApiToken = typeof apiTokens.$inferSelect;
export type NewApiToken = typeof apiTokens.$inferInsert;
/**
 * Dynamically registered OAuth clients for the remote MCP endpoint.
 *
 * Only public clients (`token_endpoint_auth_method: none`) are supported; the
 * authorization code is bound to a PKCE challenge, so no client secret is
 * stored. Redirect URIs are an exact-match allowlist captured at registration.
 */
export const mcpOauthClients = pgTable(
  "mcp_oauth_clients",
  {
    clientId: text("client_id").primaryKey(),
    name: text("name").notNull(),
    redirectUris: jsonb("redirect_uris").$type<string[]>().notNull(),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", tz),
  },
  (t) => [
    check("mcp_oauth_clients_name_ck", sql`length(${t.name}) between 1 and 120`),
    check(
      "mcp_oauth_clients_redirect_uris_ck",
      sql`jsonb_typeof(${t.redirectUris}) = 'array' and jsonb_array_length(${t.redirectUris}) between 1 and 10`,
    ),
  ],
);

/** A single-use authorization code, stored as a hash. */
export const mcpOauthCodes = pgTable(
  "mcp_oauth_codes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    codeHash: text("code_hash").notNull().unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => mcpOauthClients.clientId, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    redirectUri: text("redirect_uri").notNull(),
    codeChallenge: text("code_challenge").notNull(),
    scopes: jsonb("scopes").$type<ApiScope[]>().notNull(),
    expiresAt: timestamp("expires_at", tz).notNull(),
    usedAt: timestamp("used_at", tz),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    index("mcp_oauth_codes_expires_idx").on(t.expiresAt),
    index("mcp_oauth_codes_client_idx").on(t.clientId),
    check("mcp_oauth_codes_pkce_ck", sql`length(${t.codeChallenge}) between 43 and 128`),
  ],
);

export type ApiIdempotencyKey = typeof apiIdempotencyKeys.$inferSelect;
export type McpOauthClient = typeof mcpOauthClients.$inferSelect;
export type McpOauthCode = typeof mcpOauthCodes.$inferSelect;
