import "server-only";

import { and, asc, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { customFields } from "@/db/schema/custom-fields";
import type { CustomFieldDefinition } from "@/types";

/**
 * Read custom field definitions for a product.
 *
 * `archived` fields are still returned by default because requests keep their
 * stored values; only the submit form and the API's writable set exclude them.
 */

export function mapCustomFieldRow(row: typeof customFields.$inferSelect): CustomFieldDefinition {
  return {
    id: row.id,
    productId: row.productId,
    key: row.key,
    label: row.label,
    description: row.description,
    type: row.type,
    options: Array.isArray(row.options) ? row.options : [],
    required: row.required,
    position: row.position,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
  };
}

export async function listCustomFieldsForProduct(
  productId: string,
  options: { includeArchived?: boolean } = {},
): Promise<CustomFieldDefinition[]> {
  const includeArchived = options.includeArchived ?? true;

  const rows = await db
    .select()
    .from(customFields)
    .where(
      includeArchived
        ? eq(customFields.productId, productId)
        : and(eq(customFields.productId, productId), isNull(customFields.archivedAt)),
    )
    .orderBy(asc(customFields.position), asc(customFields.label));

  return rows.map(mapCustomFieldRow);
}

export async function listActiveCustomFields(
  productId: string,
): Promise<CustomFieldDefinition[]> {
  return listCustomFieldsForProduct(productId, { includeArchived: false });
}
