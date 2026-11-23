import {
  boolean,
  foreignKey,
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

import { products } from "@/db/schema/workspaces";

const tz = { withTimezone: true } as const;

export const boardVisibilityEnum = pgEnum("board_visibility", ["public", "private"]);

/** Moderation is configured per board, not per workspace. */
export type BoardModerationSettings = {
  /** Who must be approved before a request is visible. */
  requireApproval: "none" | "first_time" | "all";
  /** Comment policy for the board. */
  comments: "open" | "moderated" | "closed";
  /** Reject content that appears to contain credentials or payment data. */
  blockSensitiveInfo: boolean;
};

export type BoardSettings = {
  moderation: BoardModerationSettings;
};

export const defaultBoardSettings: BoardSettings = {
  moderation: {
    requireApproval: "none",
    comments: "open",
    blockSensitiveInfo: false,
  },
};

/**
 * The public feedback surface for a product.
 *
 * A board owns its URL, visibility, guest-posting policy and moderation
 * settings. Posts move under a board during the W0 backfill, which is why
 * `feedback_posts.board_id` is nullable at this stage.
 */
export const boards = pgTable(
  "boards",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    icon: text("icon"),
    color: text("color"),
    visibility: boardVisibilityEnum("visibility").notNull().default("public"),
    /** Allows unauthenticated submissions and votes on this board. */
    guestPosting: boolean("guest_posting").notNull().default(false),
    settings: jsonb("settings").$type<BoardSettings>().notNull().default(defaultBoardSettings),
    position: integer("position").notNull().default(0),
    archivedAt: timestamp("archived_at", tz),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("boards_product_slug_unique").on(t.productId, t.slug),
    // FK target so tags and posts can prove they belong to the same product.
    unique("boards_id_product_unique").on(t.id, t.productId),
    index("boards_product_position_idx").on(t.productId, t.position),
    index("boards_product_visibility_idx").on(t.productId, t.visibility),
  ],
);

/**
 * Tags are board-scoped: the same word on two boards is two independent tags,
 * so renaming or deleting one never changes the other. `product_id` is carried
 * for the composite keys that keep tag links inside one product.
 */
export const boardTags = pgTable(
  "board_tags",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    boardId: uuid("board_id").notNull(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("board_tags_board_name_unique").on(t.boardId, t.name),
    // FK target used by `feedback_tag_links`.
    unique("board_tags_id_product_unique").on(t.id, t.productId),
    foreignKey({
      name: "board_tags_board_product_fk",
      columns: [t.boardId, t.productId],
      foreignColumns: [boards.id, boards.productId],
    }).onDelete("cascade"),
    index("board_tags_board_position_idx").on(t.boardId, t.position),
  ],
);

/**
 * A condition a visitor must meet to see a gated board.
 *
 * Rules are additive: a board with any rules is visible only to visitors who
 * match at least one of them. An empty rule set means the board keeps its
 * plain `visibility` behaviour, so turning this on never changes an existing
 * public board by accident.
 */
export const boardAccessMatchEnum = pgEnum("board_access_match", [
  "company",
  "email_domain",
  "trait",
]);

export const boardAccessRules = pgTable(
  "board_access_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    boardId: uuid("board_id").notNull(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    match: boardAccessMatchEnum("match").notNull(),
    /**
     * Company id for `company`, a bare domain for `email_domain`, and the
     * expected value for `trait`. Stored lowercase where case is meaningless.
     */
    value: text("value").notNull(),
    /** Attribute name for `trait`; empty for the other matches. */
    traitKey: text("trait_key").notNull().default(""),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "board_access_rules_board_product_fk",
      columns: [t.boardId, t.productId],
      foreignColumns: [boards.id, boards.productId],
    }).onDelete("cascade"),
    // Empty string instead of NULL so Postgres' uniqueness actually applies.
    unique("board_access_rules_unique").on(t.boardId, t.match, t.traitKey, t.value),
    index("board_access_rules_board_idx").on(t.boardId),
  ],
);

export type Board = typeof boards.$inferSelect;
export type BoardAccessRule = typeof boardAccessRules.$inferSelect;
export type NewBoardAccessRule = typeof boardAccessRules.$inferInsert;
export type NewBoard = typeof boards.$inferInsert;
export type BoardTag = typeof boardTags.$inferSelect;
export type NewBoardTag = typeof boardTags.$inferInsert;
