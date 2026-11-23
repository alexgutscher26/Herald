import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "@/db/schema/auth";
import { products, workspaces } from "@/db/schema/workspaces";

const tz = { withTimezone: true } as const;

export const apiDocVersionStatusEnum = pgEnum("api_doc_version_status", [
  "draft",
  "live",
  "superseded",
]);

export const apiDocSourceEnum = pgEnum("api_doc_source", ["file", "url", "ci"]);

/** One reviewed difference between two imported OpenAPI versions. */
export type ApiDocChange = {
  severity: "breaking" | "compatible";
  kind: string;
  method: string | null;
  path: string | null;
  detail: string;
};

/** A named API surface. Versions live below it; only one is ever live. */
export const apiDocs = pgTable(
  "api_docs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("api_docs_product_slug_unique").on(t.productId, t.slug),
    index("api_docs_product_idx").on(t.productId, t.createdAt),
    check("api_docs_name_ck", sql`length(${t.name}) between 1 and 120`),
    check("api_docs_slug_ck", sql`${t.slug} ~ '^[a-z0-9][a-z0-9-]{0,79}$'`),
  ],
);

/**
 * One immutable OpenAPI import.
 *
 * The document is stored as JSON, not a link, so a URL changing later cannot
 * alter a reviewed draft or the live version. `breakingChanges` is computed
 * against the version that was live at import time and is kept for review.
 */
export const apiDocVersions = pgTable(
  "api_doc_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    apiDocId: uuid("api_doc_id")
      .notNull()
      .references(() => apiDocs.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    source: apiDocSourceEnum("source").notNull(),
    sourceUrl: text("source_url"),
    status: apiDocVersionStatusEnum("status").notNull().default("draft"),
    document: jsonb("document").$type<Record<string, unknown>>().notNull(),
    breakingChanges: jsonb("breaking_changes").$type<ApiDocChange[]>().notNull().default([]),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    publishedAt: timestamp("published_at", tz),
  },
  (t) => [
    unique("api_doc_versions_doc_version_unique").on(t.apiDocId, t.version),
    index("api_doc_versions_doc_created_idx").on(t.apiDocId, t.createdAt),
    uniqueIndex("api_doc_versions_one_live_idx")
      .on(t.apiDocId)
      .where(sql`${t.status} = 'live'`),
    check("api_doc_versions_version_ck", sql`length(${t.version}) between 1 and 80`),
  ],
);

export type ApiDoc = typeof apiDocs.$inferSelect;
export type ApiDocVersion = typeof apiDocVersions.$inferSelect;
export type NewApiDocVersion = typeof apiDocVersions.$inferInsert;
