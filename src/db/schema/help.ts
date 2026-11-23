import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "@/db/schema/auth";
import { products, workspaces } from "@/db/schema/workspaces";
import type { HelpTranslations } from "@/features/i18n/content";

const tz = { withTimezone: true } as const;

export const helpCollectionVisibilityEnum = pgEnum("help_collection_visibility", [
  "public",
  "internal",
]);

export const helpArticleStatusEnum = pgEnum("help_article_status", [
  "draft",
  "published",
]);

export const helpArticleVisibilityEnum = pgEnum("help_article_visibility", [
  "public",
  "internal",
]);

/**
 * A help center collection.
 *
 * The collection is tenant- and product-scoped. `visibility` controls whether
 * the collection is exposed on the public portal; an internal collection is
 * still editable and can still be cited by internal Juno tooling, but its
 * articles are never projected into a public knowledge source.
 */
export const helpCollections = pgTable(
  "help_collections",
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
    visibility: helpCollectionVisibilityEnum("visibility").notNull().default("public"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("help_collections_product_slug_unique").on(t.productId, t.slug),
    index("help_collections_product_order_idx").on(t.productId, t.sortOrder),
    check("help_collections_name_ck", sql`length(${t.name}) between 1 and 120`),
    check("help_collections_slug_ck", sql`${t.slug} ~ '^[a-z0-9][a-z0-9-]{0,79}$'`),
  ],
);

/**
 * An article is the canonical content row. The portal reads it directly and a
 * published public article is what the collection-to-Juno projector reads, so
 * there is no second copy of the body to drift from the page.
 *
 * A revision is written on every save, while `status` is the publication
 * switch. `publishedAt` records the last publish, not the last edit.
 */
export const helpArticles = pgTable(
  "help_articles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => helpCollections.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    /** Operator-authored variants; the canonical title/body stay the default. */
    translations: jsonb("translations").$type<HelpTranslations>().notNull().default({}),
    status: helpArticleStatusEnum("status").notNull().default("draft"),
    visibility: helpArticleVisibilityEnum("visibility").notNull().default("public"),
    publishedAt: timestamp("published_at", tz),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("help_articles_collection_slug_unique").on(t.collectionId, t.slug),
    index("help_articles_product_status_idx").on(t.productId, t.status, t.visibility),
    check("help_articles_title_ck", sql`length(${t.title}) between 1 and 200`),
    check("help_articles_slug_ck", sql`${t.slug} ~ '^[a-z0-9][a-z0-9-]{0,79}$'`),
    check("help_articles_body_ck", sql`length(${t.body}) between 1 and 500000`),
  ],
);

/** Immutable snapshot of an article at one save. */
export const helpArticleRevisions = pgTable(
  "help_article_revisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    articleId: uuid("article_id")
      .notNull()
      .references(() => helpArticles.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    revisionNumber: integer("revision_number").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    translations: jsonb("translations").$type<HelpTranslations>().notNull().default({}),
    visibility: helpArticleVisibilityEnum("visibility").notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("help_article_revisions_number_unique").on(t.articleId, t.revisionNumber),
    index("help_article_revisions_article_idx").on(t.articleId, t.revisionNumber),
  ],
);

export type HelpCollection = typeof helpCollections.$inferSelect;
export type HelpArticle = typeof helpArticles.$inferSelect;
export type HelpArticleRevision = typeof helpArticleRevisions.$inferSelect;
