import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "@/db/schema/auth";
import { customers } from "@/db/schema/customers";
import { products } from "@/db/schema/workspaces";
import type { ReleaseTranslations } from "@/features/i18n/content";
import type { ReleaseChannels, ReleaseCover } from "@/types";

const tz = { withTimezone: true } as const;

export const releaseStatusEnum = pgEnum("release_status", [
  "draft",
  "scheduled",
  "published",
  "archived",
]);

export const releaseCategoryEnum = pgEnum("release_category", [
  "feature",
  "improvement",
  "fix",
]);

export const releases = pgTable(
  "releases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** Unique within the product, used in the public widget URL. */
    slug: text("slug").notNull(),
    summary: text("summary"),
    bodyMarkdown: text("body_markdown"),
    /** Operator-authored locale variants; the canonical columns stay the default. */
    translations: jsonb("translations").$type<ReleaseTranslations>().notNull().default({}),
    status: releaseStatusEnum("status").notNull().default("draft"),
    category: releaseCategoryEnum("category").notNull().default("feature"),
    /**
     * Preset, uploaded image or no cover. Stored as JSON so the editor can
     * round-trip its exact shape without adding one column per variant.
     */
    cover: jsonb("cover").$type<ReleaseCover>().notNull().default({ kind: "none" }),
    /** Optional uploaded Open Graph image; null keeps the generated card. */
    ogImageKey: text("og_image_key"),
    channelPublicChangelog: boolean("channel_public_changelog").notNull().default(true),
    channelInAppWidget: boolean("channel_in_app_widget").notNull().default(true),
    channelSubscriberEmail: boolean("channel_subscriber_email").notNull().default(true),
    version: text("version"),
    /** Optional YouTube link; only YouTube URLs are accepted by the editor. */
    youtubeUrl: text("youtube_url"),
    publishedAt: timestamp("published_at", tz),
    scheduledFor: timestamp("scheduled_for", tz),
    authorId: text("author_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    // A cover is a preset or a storage key; an inline image belongs in the
    // storage module, never in a row.
    check(
      "releases_cover_inline_ck",
      sql`${t.cover}::text not like '%"data:%' and ${t.cover}::text not like '%"blob:%'`,
    ),
    check(
      "releases_og_image_key_ck",
      sql`${t.ogImageKey} is null or (${t.ogImageKey} not like '%..%' and ${t.ogImageKey} like 'workspaces/%/social/%')`,
    ),
    unique("releases_product_slug_unique").on(t.productId, t.slug),
    // FK target so join tables can assert "release and feedback share a product".
    unique("releases_id_product_unique").on(t.id, t.productId),
    index("releases_product_status_published_idx").on(t.productId, t.status, t.publishedAt),
  ],
);

/**
 * Changelog tags are product-scoped and reusable across releases. `slug` is
 * the normalized unique key; `name` preserves the casing the team typed.
 */
export const releaseTags = pgTable(
  "release_tags",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("release_tags_product_slug_unique").on(t.productId, t.slug),
    unique("release_tags_id_product_unique").on(t.id, t.productId),
    index("release_tags_product_idx").on(t.productId),
  ],
);

/** Multiple authors per release, ordered; the first is the byline. */
export const releaseAuthors = pgTable(
  "release_authors",
  {
    releaseId: uuid("release_id").notNull(),
    productId: uuid("product_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: "release_authors_pk",
      columns: [t.releaseId, t.userId],
    }),
    foreignKey({
      name: "release_authors_release_fk",
      columns: [t.releaseId, t.productId],
      foreignColumns: [releases.id, releases.productId],
    }).onDelete("cascade"),
    index("release_authors_user_idx").on(t.userId),
    index("release_authors_product_idx").on(t.productId),
  ],
);

/** The release↔tag bridge, with the same product guard as other links. */
export const releaseTagLinks = pgTable(
  "release_tag_links",
  {
    releaseId: uuid("release_id").notNull(),
    tagId: uuid("tag_id").notNull(),
    productId: uuid("product_id").notNull(),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: "release_tag_links_pk",
      columns: [t.releaseId, t.tagId],
    }),
    foreignKey({
      name: "release_tag_links_release_fk",
      columns: [t.releaseId, t.productId],
      foreignColumns: [releases.id, releases.productId],
    }).onDelete("cascade"),
    foreignKey({
      name: "release_tag_links_tag_fk",
      columns: [t.tagId, t.productId],
      foreignColumns: [releaseTags.id, releaseTags.productId],
    }).onDelete("cascade"),
    index("release_tag_links_release_idx").on(t.releaseId),
    index("release_tag_links_product_idx").on(t.productId),
  ],
);

/**
 * Immutable snapshots of a release's editable content.
 *
 * A revision is written by every save path (autosave, explicit save,
 * schedule, publish, archive and restore) and deduplicated by `content_hash`,
 * so the history answers "what did this entry look like, and when?" without
 * an audit trail per keystroke. The earliest revision of an existing entry is
 * captured before the first change, which keeps the last published state
 * available for a pre-publish diff.
 *
 * Covers keep only their kind, preset and a fingerprint of the storage key: a
 * custom image's bytes stay in the storage module.
 */
export const releaseRevisionActionEnum = pgEnum("release_revision_action", [
  "autosave",
  "save",
  "publish",
  "update",
  "schedule",
  "archive",
  "restore",
]);

export type ReleaseRevisionCover =
  | { kind: "preset"; preset: "grid" | "orbit" | "waves" | "plain" }
  | { kind: "custom"; fingerprint: string }
  | { kind: "none" };

export const releaseRevisions = pgTable(
  "release_revisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Monotonic insertion order; `createdAt` only has millisecond precision. */
    sequence: bigserial("sequence", { mode: "number" }).notNull(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    releaseId: uuid("release_id").notNull(),
    action: releaseRevisionActionEnum("action").notNull(),
    status: releaseStatusEnum("status").notNull(),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    summary: text("summary").notNull().default(""),
    bodyMarkdown: text("body_markdown").notNull().default(""),
    translations: jsonb("translations").$type<ReleaseTranslations>().notNull().default({}),
    category: releaseCategoryEnum("category").notNull(),
    cover: jsonb("cover").$type<ReleaseRevisionCover>().notNull(),
    /** The uploaded social image key is safe to keep whole; bytes stay in storage. */
    ogImageKey: text("og_image_key"),
    youtubeUrl: text("youtube_url"),
    channels: jsonb("channels").$type<ReleaseChannels>().notNull(),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    authorIds: jsonb("author_ids").$type<string[]>().notNull().default([]),
    linkedFeedbackIds: jsonb("linked_feedback_ids").$type<string[]>().notNull().default([]),
    linkedCancellationReasonIds: jsonb("linked_cancellation_reason_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    scheduledFor: timestamp("scheduled_for", tz),
    publishedAt: timestamp("published_at", tz),
    /** SHA-256 over the canonical snapshot; the dedupe key. */
    contentHash: text("content_hash").notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    check(
      "release_revisions_cover_inline_ck",
      sql`${t.cover}::text not like '%"data:%' and ${t.cover}::text not like '%"blob:%'`,
    ),
    check(
      "release_revisions_og_image_key_ck",
      sql`${t.ogImageKey} is null or (${t.ogImageKey} not like '%..%' and ${t.ogImageKey} like 'workspaces/%/social/%')`,
    ),
    foreignKey({
      name: "release_revisions_release_fk",
      columns: [t.releaseId, t.productId],
      foreignColumns: [releases.id, releases.productId],
    }).onDelete("cascade"),
    index("release_revisions_release_created_idx").on(t.releaseId, t.createdAt),
    index("release_revisions_product_idx").on(t.productId),
  ],
);

export const releaseReactionKindEnum = pgEnum("release_reaction_kind", [
  "like",
  "love",
  "celebrate",
]);

/** One customer's reaction to one published changelog entry. */
export const releaseReactions = pgTable(
  "release_reactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    releaseId: uuid("release_id").notNull(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    kind: releaseReactionKindEnum("kind").notNull().default("like"),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "release_reactions_release_fk",
      columns: [t.releaseId, t.productId],
      foreignColumns: [releases.id, releases.productId],
    }).onDelete("cascade"),
    unique("release_reactions_release_customer_kind_unique").on(
      t.releaseId,
      t.customerId,
      t.kind,
    ),
    index("release_reactions_release_idx").on(t.releaseId),
    index("release_reactions_customer_idx").on(t.customerId),
  ],
);

/** Which published release a signed-in customer opened in the portal. */
export const customerReleaseViews = pgTable(
  "customer_release_views",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    releaseId: uuid("release_id")
      .notNull()
      .references(() => releases.id, { onDelete: "cascade" }),
    firstViewedAt: timestamp("first_viewed_at", tz).notNull().defaultNow(),
    lastViewedAt: timestamp("last_viewed_at", tz).notNull().defaultNow(),
    viewCount: integer("view_count").notNull().default(1),
  },
  (t) => [
    unique("customer_release_views_customer_release_unique").on(
      t.customerId,
      t.releaseId,
    ),
    index("customer_release_views_customer_idx").on(t.customerId, t.lastViewedAt),
  ],
);

export type Release = typeof releases.$inferSelect;
export type NewRelease = typeof releases.$inferInsert;
export type ReleaseTag = typeof releaseTags.$inferSelect;
export type ReleaseAuthor = typeof releaseAuthors.$inferSelect;
export type ReleaseTagLink = typeof releaseTagLinks.$inferSelect;
export type ReleaseRevision = typeof releaseRevisions.$inferSelect;
export type NewReleaseRevision = typeof releaseRevisions.$inferInsert;
export type ReleaseReaction = typeof releaseReactions.$inferSelect;
export type NewReleaseReaction = typeof releaseReactions.$inferInsert;