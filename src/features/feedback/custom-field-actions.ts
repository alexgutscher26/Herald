"use server";

import { and, desc, eq, isNull, max } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { customFields, feedbackCustomFieldValues } from "@/db/schema/custom-fields";
import { feedbackPosts } from "@/db/schema/feedback";
import { feedbackPrioritisation } from "@/db/schema/prioritisation";
import {
  CUSTOM_FIELD_LIMITS,
  customFieldKeyFromLabel,
  isCustomFieldType,
  isValidCustomFieldKey,
  normalizeCustomFieldOptions,
  parseCustomFieldValues,
} from "@/features/feedback/custom-fields";
import { normalizeScaleValue } from "@/features/feedback/prioritisation";
import { authorizeProductAction } from "@/features/live/action-auth";
import type { ActionResult } from "@/features/live/action-result";
import type { CustomFieldDefinition } from "@/types";

/**
 * Custom field and prioritisation writes.
 *
 * Definitions are product configuration (`settings:manage`); values and the
 * 1–5 prioritisation inputs are day-to-day feedback work (`feedback:write`).
 * Each action resolves the product from the URL slugs, never from a
 * client-supplied product id.
 */

const targetSchema = z.object({
  workspaceSlug: z.string().min(1),
  productSlug: z.string().min(1),
});

function revalidate(workspaceSlug: string, productSlug: string) {
  revalidatePath(`/app/${workspaceSlug}/${productSlug}`, "layout");
}

const optionsSchema = z.array(z.string()).max(CUSTOM_FIELD_LIMITS.options).optional();

const createSchema = targetSchema.extend({
  label: z.string().trim().min(1, "Give the field a label.").max(CUSTOM_FIELD_LIMITS.label),
  key: z.string().trim().max(CUSTOM_FIELD_LIMITS.key).optional(),
  description: z
    .string()
    .trim()
    .max(CUSTOM_FIELD_LIMITS.description)
    .nullable()
    .optional(),
  type: z.string().refine(isCustomFieldType, "Choose text, number, select or date."),
  options: optionsSchema,
  required: z.boolean().default(false),
});

export async function createCustomFieldAction(input: {
  workspaceSlug: string;
  productSlug: string;
  label: string;
  key?: string;
  description?: string | null;
  type: string;
  options?: string[];
  required?: boolean;
}): Promise<ActionResult<{ field: CustomFieldDefinition }>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the field." };
  }

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "settings:manage",
  );
  if ("error" in authorized) return authorized.error;
  const { product } = authorized.context;

  const key = parsed.data.key?.trim() || customFieldKeyFromLabel(parsed.data.label);
  if (!isValidCustomFieldKey(key)) {
    return {
      ok: false,
      error: "The key must be lowercase letters, numbers and underscores, starting with a letter.",
    };
  }

  const options =
    parsed.data.type === "select" ? normalizeCustomFieldOptions(parsed.data.options) : [];
  if (parsed.data.type === "select" && options.length === 0) {
    return { ok: false, error: "Add at least one option to a select field." };
  }

  try {
    const existing = await db
      .select({ value: max(customFields.position) })
      .from(customFields)
      .where(eq(customFields.productId, product.id));

    const inserted = await db
      .insert(customFields)
      .values({
        productId: product.id,
        key,
        label: parsed.data.label,
        description: parsed.data.description?.trim() || null,
        type: parsed.data.type,
        options,
        required: parsed.data.required ?? false,
        position: (existing[0]?.value ?? 0) + 1,
      })
      .onConflictDoNothing()
      .returning();

    const row = inserted[0];
    if (!row) {
      return { ok: false, error: "This product already has a field with that key." };
    }

    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return {
      ok: true,
      data: {
        field: {
          id: row.id,
          productId: row.productId,
          key: row.key,
          label: row.label,
          description: row.description,
          type: row.type,
          options: row.options,
          required: row.required,
          position: row.position,
          archivedAt: null,
        },
      },
    };
  } catch (error) {
    console.error("[custom-fields] create failed", error);
    return { ok: false, error: "Could not create that field. Please try again." };
  }
}

const updateSchema = targetSchema.extend({
  fieldId: z.uuid(),
  label: z.string().trim().min(1).max(CUSTOM_FIELD_LIMITS.label).optional(),
  description: z
    .string()
    .trim()
    .max(CUSTOM_FIELD_LIMITS.description)
    .nullable()
    .optional(),
  options: optionsSchema,
  required: z.boolean().optional(),
  archived: z.boolean().optional(),
});

export async function updateCustomFieldAction(input: {
  workspaceSlug: string;
  productSlug: string;
  fieldId: string;
  label?: string;
  description?: string | null;
  options?: string[];
  required?: boolean;
  archived?: boolean;
}): Promise<ActionResult<{ fieldId: string }>> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the field." };
  }

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "settings:manage",
  );
  if ("error" in authorized) return authorized.error;
  const { product } = authorized.context;

  const rows = await db
    .select()
    .from(customFields)
    .where(
      and(eq(customFields.id, parsed.data.fieldId), eq(customFields.productId, product.id)),
    )
    .limit(1);
  const field = rows[0];
  if (!field) return { ok: false, error: "That field no longer exists." };

  const options =
    parsed.data.options === undefined
      ? undefined
      : normalizeCustomFieldOptions(parsed.data.options);
  if (field.type === "select" && options !== undefined && options.length === 0) {
    return { ok: false, error: "A select field needs at least one option." };
  }

  try {
    await db
      .update(customFields)
      .set({
        ...(parsed.data.label === undefined ? {} : { label: parsed.data.label }),
        ...(parsed.data.description === undefined
          ? {}
          : { description: parsed.data.description?.trim() || null }),
        ...(options === undefined ? {} : { options }),
        ...(parsed.data.required === undefined ? {} : { required: parsed.data.required }),
        ...(parsed.data.archived === undefined
          ? {}
          : { archivedAt: parsed.data.archived ? new Date() : null }),
        updatedAt: new Date(),
      })
      .where(eq(customFields.id, field.id));

    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return { ok: true, data: { fieldId: field.id } };
  } catch (error) {
    console.error("[custom-fields] update failed", error);
    return { ok: false, error: "Could not update that field. Please try again." };
  }
}

const valuesSchema = targetSchema.extend({
  postId: z.uuid(),
  values: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
});

/**
 * Replace every custom-field value on one request.
 *
 * Parsing uses the product's active definitions, so an archived field's stored
 * value survives on old requests while the editor stops offering it. The
 * write is a delete-then-insert inside one transaction: a blank input removes
 * the value instead of storing an empty string that would look like data.
 */
export async function setCustomFieldValuesAction(input: {
  workspaceSlug: string;
  productSlug: string;
  postId: string;
  values: Record<string, string | number | null>;
}): Promise<ActionResult<{ postId: string }>> {
  const parsed = valuesSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the values." };
  }

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "feedback:write",
  );
  if ("error" in authorized) return authorized.error;
  const { product } = authorized.context;

  const post = await db
    .select({ id: feedbackPosts.id })
    .from(feedbackPosts)
    .where(
      and(eq(feedbackPosts.id, parsed.data.postId), eq(feedbackPosts.productId, product.id)),
    )
    .limit(1);
  if (!post[0]) return { ok: false, error: "That feedback request no longer exists." };

  const fieldRows = await db
    .select()
    .from(customFields)
    .where(and(eq(customFields.productId, product.id), isNull(customFields.archivedAt)))
    .orderBy(customFields.position);

  const definitions = fieldRows.map((row) => ({
    id: row.id,
    productId: row.productId,
    key: row.key,
    label: row.label,
    description: row.description,
    type: row.type,
    options: row.options,
    required: row.required,
    position: row.position,
    archivedAt: null,
  })) satisfies CustomFieldDefinition[];

  const result = parseCustomFieldValues(definitions, parsed.data.values);
  if (!result.ok) {
    const first = Object.values(result.errors)[0];
    return { ok: false, error: first ?? "Check the custom field values." };
  }

  try {
    await db.transaction(async (tx) => {
      await tx
        .delete(feedbackCustomFieldValues)
        .where(eq(feedbackCustomFieldValues.feedbackPostId, parsed.data.postId));

      const inserts = definitions
        .filter((field) => result.values.has(field.id))
        .map((field) => {
          const value = result.values.get(field.id);
          return {
            productId: product.id,
            feedbackPostId: parsed.data.postId,
            fieldId: field.id,
            textValue: field.type === "text" || field.type === "select" ? String(value) : null,
            numberValue: field.type === "number" ? Number(value) : null,
            dateValue: field.type === "date" ? String(value) : null,
          };
        });

      if (inserts.length > 0) {
        await tx.insert(feedbackCustomFieldValues).values(inserts);
      }

      await tx
        .update(feedbackPosts)
        .set({ updatedAt: new Date() })
        .where(eq(feedbackPosts.id, parsed.data.postId));
    });

    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return { ok: true, data: { postId: parsed.data.postId } };
  } catch (error) {
    console.error("[custom-fields] value save failed", error);
    return { ok: false, error: "Could not save the custom field values. Please try again." };
  }
}

const prioritisationSchema = targetSchema.extend({
  postId: z.uuid(),
  impact: z.number().int().nullable(),
  businessValue: z.number().int().nullable(),
  effort: z.number().int().nullable(),
});

/**
 * Store the team's 1–5 inputs for one request.
 *
 * All three are nullable: clearing a judgement is a real operation and leaves
 * the derived signals unset rather than silently zero.
 */
export async function setPrioritisationAction(input: {
  workspaceSlug: string;
  productSlug: string;
  postId: string;
  impact: number | null;
  businessValue: number | null;
  effort: number | null;
}): Promise<ActionResult<{ postId: string }>> {
  const parsed = prioritisationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Impact, value and effort must be 1–5 or empty." };
  }

  const authorized = await authorizeProductAction(
    parsed.data.workspaceSlug,
    parsed.data.productSlug,
    "feedback:write",
  );
  if ("error" in authorized) return authorized.error;
  const { product, user } = authorized.context;

  const post = await db
    .select({ id: feedbackPosts.id })
    .from(feedbackPosts)
    .where(
      and(eq(feedbackPosts.id, parsed.data.postId), eq(feedbackPosts.productId, product.id)),
    )
    .limit(1);
  if (!post[0]) return { ok: false, error: "That feedback request no longer exists." };

  const impact = parsed.data.impact === null ? null : normalizeScaleValue(parsed.data.impact);
  const businessValue =
    parsed.data.businessValue === null
      ? null
      : normalizeScaleValue(parsed.data.businessValue);
  const effort = parsed.data.effort === null ? null : normalizeScaleValue(parsed.data.effort);

  if (
    (parsed.data.impact !== null && impact === null) ||
    (parsed.data.businessValue !== null && businessValue === null) ||
    (parsed.data.effort !== null && effort === null)
  ) {
    return { ok: false, error: "Impact, value and effort must be whole numbers from 1 to 5." };
  }

  try {
    const existing = await db
      .select({ postId: feedbackPrioritisation.feedbackPostId })
      .from(feedbackPrioritisation)
      .where(eq(feedbackPrioritisation.feedbackPostId, parsed.data.postId))
      .limit(1);

    if (existing[0]) {
      await db
        .update(feedbackPrioritisation)
        .set({ impact, businessValue, effort, updatedBy: user.id, updatedAt: new Date() })
        .where(eq(feedbackPrioritisation.feedbackPostId, parsed.data.postId));
    } else {
      await db.insert(feedbackPrioritisation).values({
        feedbackPostId: parsed.data.postId,
        productId: product.id,
        impact,
        businessValue,
        effort,
        updatedBy: user.id,
      });
    }

    revalidate(parsed.data.workspaceSlug, parsed.data.productSlug);
    return { ok: true, data: { postId: parsed.data.postId } };
  } catch (error) {
    console.error("[prioritisation] save failed", error);
    return { ok: false, error: "Could not save the prioritisation inputs. Please try again." };
  }
}

/** Read helper for settings, so the page does not duplicate the query. */
export async function listCustomFields(productId: string) {
  return db
    .select()
    .from(customFields)
    .where(eq(customFields.productId, productId))
    .orderBy(desc(customFields.createdAt));
}
