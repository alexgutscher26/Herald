import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { emailSuppressions } from "@/db/schema";
import { normalizeEmail } from "@/lib/email";

import type { SuppressionImportRow } from "./suppression-csv";

export type SuppressionReason = "hard_bounce" | "complaint" | "manual" | "unsubscribe";

export async function isEmailSuppressed(
  workspaceId: string,
  email: string,
): Promise<boolean> {
  const normalized = normalizeEmail(email);
  if (normalized === "") return false;

  const rows = await db
    .select({ id: emailSuppressions.id })
    .from(emailSuppressions)
    .where(
      and(
        eq(emailSuppressions.workspaceId, workspaceId),
        eq(emailSuppressions.emailNormalized, normalized),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

/**
 * Add or update a suppression. Re-suppressing an address updates the reason
 * instead of failing, so webhook replays are safe.
 */
export async function suppressEmail(input: {
  workspaceId: string;
  email: string;
  reason: SuppressionReason;
  note?: string | null;
  createdBy?: string | null;
}): Promise<void> {
  const email = input.email.trim();
  const emailNormalized = normalizeEmail(email);
  if (emailNormalized === "") throw new Error("Cannot suppress an empty address.");

  await db
    .insert(emailSuppressions)
    .values({
      workspaceId: input.workspaceId,
      email,
      emailNormalized,
      reason: input.reason,
      note: input.note ?? null,
      createdBy: input.createdBy ?? null,
    })
    .onConflictDoUpdate({
      target: [emailSuppressions.workspaceId, emailSuppressions.emailNormalized],
      set: { reason: input.reason, note: input.note ?? null },
    });
}

/**
 * Import a parsed suppression file in bounded batches. Re-importing updates the
 * reason and note, which makes correcting a file safe.
 */
export async function importSuppressions(input: {
  workspaceId: string;
  rows: SuppressionImportRow[];
  createdBy?: string | null;
}): Promise<number> {
  if (input.rows.length === 0) return 0;

  return db.transaction(async (tx) => {
    let imported = 0;
    for (let index = 0; index < input.rows.length; index += 500) {
      const batch = input.rows.slice(index, index + 500);
      await tx
        .insert(emailSuppressions)
        .values(
          batch.map((row) => ({
            workspaceId: input.workspaceId,
            email: row.email,
            emailNormalized: row.emailNormalized,
            reason: row.reason,
            note: row.note,
            createdBy: input.createdBy ?? null,
          })),
        )
        .onConflictDoUpdate({
          target: [emailSuppressions.workspaceId, emailSuppressions.emailNormalized],
          set: {
            reason: sql`excluded.reason`,
            note: sql`excluded.note`,
          },
        });
      imported += batch.length;
    }
    return imported;
  });
}
