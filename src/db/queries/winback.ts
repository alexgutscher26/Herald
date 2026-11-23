import "server-only";

import { asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { cancellationReasons } from "@/db/schema/winback";
import type { CancellationReason } from "@/types";

/**
 * Cancellation reasons are workspace-scoped in Postgres, while the current
 * release editor groups them by product. The caller passes the selected
 * product id so the view model stays consistent; authorization for the
 * workspace happened before this call.
 */
export async function listCancellationReasonsForProduct(
  workspaceId: string,
  productId: string,
): Promise<CancellationReason[]> {
  const rows = await db
    .select()
    .from(cancellationReasons)
    .where(eq(cancellationReasons.workspaceId, workspaceId))
    .orderBy(asc(cancellationReasons.position), asc(cancellationReasons.label));

  return rows.map((row) => ({
    id: row.id,
    productId,
    label: row.label,
    description: row.description ?? "",
    createdAt: row.createdAt.toISOString(),
  }));
}
