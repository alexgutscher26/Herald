import {
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { boards } from "@/db/schema/boards";
import { feedbackPosts } from "@/db/schema/feedback";
import { releases } from "@/db/schema/releases";
import { products, workspaces } from "@/db/schema/workspaces";

const tz = { withTimezone: true } as const;

/**
 * A published roadmap is a lens over public boards, not a second item model.
 * Every card is still `feedback_posts.status`; the roadmap only decides which
 * boards are in scope and whether it is listed in navigation and crawlers.
 */
export const roadmapVisibilityEnum = pgEnum("roadmap_visibility", [
  "public",
  "unlisted",
]);

export const publicRoadmaps = pgTable(
  "public_roadmaps",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    visibility: roadmapVisibilityEnum("visibility").notNull().default("public"),
    position: integer("position").notNull().default(0),
    /** Null means saved but not published; only published views are public. */
    publishedAt: timestamp("published_at", tz),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("public_roadmaps_product_slug_unique").on(t.productId, t.slug),
    unique("public_roadmaps_id_product_unique").on(t.id, t.productId),
    index("public_roadmaps_product_position_idx").on(t.productId, t.position),
    index("public_roadmaps_workspace_idx").on(t.workspaceId),
  ],
);

/** Boards included in a roadmap. The composite keys keep both sides scoped. */
export const roadmapBoards = pgTable(
  "roadmap_boards",
  {
    roadmapId: uuid("roadmap_id").notNull(),
    boardId: uuid("board_id").notNull(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "roadmap_boards_pk", columns: [t.roadmapId, t.boardId] }),
    foreignKey({
      name: "roadmap_boards_roadmap_fk",
      columns: [t.roadmapId, t.productId],
      foreignColumns: [publicRoadmaps.id, publicRoadmaps.productId],
    }).onDelete("cascade"),
    foreignKey({
      name: "roadmap_boards_board_fk",
      columns: [t.boardId, t.productId],
      foreignColumns: [boards.id, boards.productId],
    }).onDelete("cascade"),
    index("roadmap_boards_board_idx").on(t.boardId),
  ],
);

export type PublicRoadmap = typeof publicRoadmaps.$inferSelect;
export type RoadmapBoard = typeof roadmapBoards.$inferSelect;

/**
 * The roadmap no longer has its own item table. Feedback status is the only
 * source of roadmap state, so this module now owns the release link and the
 * published views.
 */
export const releaseFeedbackLinks = pgTable(
  "release_feedback_links",
  {
    /** Same cross-product guard as `roadmap_feedback_links` used to have. */
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    releaseId: uuid("release_id").notNull(),
    feedbackPostId: uuid("feedback_post_id").notNull(),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: "release_feedback_links_pk",
      columns: [t.releaseId, t.feedbackPostId],
    }),
    foreignKey({
      name: "release_feedback_links_release_fk",
      columns: [t.releaseId, t.productId],
      foreignColumns: [releases.id, releases.productId],
    }).onDelete("cascade"),
    foreignKey({
      name: "release_feedback_links_feedback_fk",
      columns: [t.feedbackPostId, t.productId],
      foreignColumns: [feedbackPosts.id, feedbackPosts.productId],
    }).onDelete("cascade"),
    index("release_feedback_links_feedback_idx").on(t.feedbackPostId),
    index("release_feedback_links_product_idx").on(t.productId),
  ],
);

export type ReleaseFeedbackLink = typeof releaseFeedbackLinks.$inferSelect;
