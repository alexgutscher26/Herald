import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
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
  date,
} from "drizzle-orm/pg-core";

import { feedbackPosts } from "@/db/schema/feedback";
import { products } from "@/db/schema/workspaces";

const tz = { withTimezone: true } as const;

/**
 * Custom fields are product-level metadata collected with every request.
 *
 * Four types are supported because they are the four a feedback team can
 * filter on without a second query language: free text, a number, one value
 * from a fixed option list, and a calendar date. Anything more structured
 * belongs in tags or a dedicated integration, not in a JSON blob.
 *
 * `key` is the stable machine name used by filters and `/api/v1`; `label` is
 * what a customer reads. Renaming the label never breaks an API caller.
 */
export const customFieldTypeEnum = pgEnum("custom_field_type", [
  "text",
  "number",
  "select",
  "date",
]);

export const customFields = pgTable(
  "custom_fields",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** Stable snake_case name; unique per product and never reused after archive. */
    key: text("key").notNull(),
    label: text("label").notNull(),
    description: text("description"),
    type: customFieldTypeEnum("type").notNull(),
    /** Allowed values for `select`; empty for the other types. */
    options: jsonb("options").$type<string[]>().notNull().default([]),
    /** A submission without this field is rejected, not silently stored. */
    required: boolean("required").notNull().default(false),
    position: integer("position").notNull().default(0),
    /** Archived fields keep their values readable but leave the submit form. */
    archivedAt: timestamp("archived_at", tz),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("custom_fields_product_key_unique").on(t.productId, t.key),
    // FK target so values cannot pair a field with another product's request.
    unique("custom_fields_id_product_unique").on(t.id, t.productId),
    index("custom_fields_product_position_idx").on(t.productId, t.position),
    check(
      "custom_fields_key_ck",
      sql`${t.key} ~ '^[a-z][a-z0-9_]{0,39}$'`,
    ),
    check(
      "custom_fields_select_options_ck",
      sql`${t.type} <> 'select' or jsonb_array_length(${t.options}) >= 1`,
    ),
  ],
);

/**
 * One value per (request, field).
 *
 * The typed columns, rather than a single text blob, are what make filtering
 * and range queries possible: a number compares as a number and a date as a
 * date. Exactly one column is populated, chosen by the field's type, and the
 * check constraint keeps a bad writer from storing two.
 */
export const feedbackCustomFieldValues = pgTable(
  "feedback_custom_field_values",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    feedbackPostId: uuid("feedback_post_id").notNull(),
    fieldId: uuid("field_id").notNull(),
    textValue: text("text_value"),
    numberValue: doublePrecision("number_value"),
    /** Calendar date as `YYYY-MM-DD`; no timezone applies to a date field. */
    dateValue: date("date_value", { mode: "string" }),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("feedback_custom_field_values_post_field_unique").on(
      t.feedbackPostId,
      t.fieldId,
    ),
    foreignKey({
      name: "feedback_custom_field_values_post_fk",
      columns: [t.feedbackPostId, t.productId],
      foreignColumns: [feedbackPosts.id, feedbackPosts.productId],
    }).onDelete("cascade"),
    foreignKey({
      name: "feedback_custom_field_values_field_fk",
      columns: [t.fieldId, t.productId],
      foreignColumns: [customFields.id, customFields.productId],
    }).onDelete("cascade"),
    check(
      "feedback_custom_field_values_one_value_ck",
      sql`num_nonnulls(${t.textValue}, ${t.numberValue}, ${t.dateValue}) = 1`,
    ),
    index("feedback_custom_field_values_field_text_idx").on(
      t.fieldId,
      t.textValue,
    ),
    index("feedback_custom_field_values_field_number_idx").on(
      t.fieldId,
      t.numberValue,
    ),
    index("feedback_custom_field_values_field_date_idx").on(t.fieldId, t.dateValue),
    index("feedback_custom_field_values_post_idx").on(t.feedbackPostId),
  ],
);

export type CustomFieldRow = typeof customFields.$inferSelect;
export type NewCustomFieldRow = typeof customFields.$inferInsert;
export type CustomFieldValueRow = typeof feedbackCustomFieldValues.$inferSelect;
export type NewCustomFieldValueRow = typeof feedbackCustomFieldValues.$inferInsert;
