import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { workspaceSubscriptions, workspaces } from "@/db/schema";

/**
 * End a dunning grace window.
 *
 * The job is scheduled once per dunning cycle. It is deliberately separate
 * from `service.ts` so the job handler does not import the module that enqueues
 * jobs (which would create a require cycle). A successful payment changes the
 * status first, so this job becomes a no-op rather than downgrading a recovered
 * workspace.
 */
export async function expireDunning(input: {
  workspaceId: string;
  graceUntil: string;
}): Promise<{ expired: boolean }> {
  const graceUntil = new Date(input.graceUntil);
  if (Number.isNaN(graceUntil.getTime())) return { expired: false };

  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        status: workspaceSubscriptions.status,
        dunningGraceUntil: workspaceSubscriptions.dunningGraceUntil,
      })
      .from(workspaceSubscriptions)
      .where(eq(workspaceSubscriptions.workspaceId, input.workspaceId))
      .limit(1);
    const row = rows[0];
    const now = new Date();
    if (
      !row ||
      (row.status !== "past_due" && row.status !== "unpaid") ||
      !row.dunningGraceUntil ||
      row.dunningGraceUntil.getTime() > now.getTime()
    ) {
      return { expired: false };
    }

    await tx
      .update(workspaceSubscriptions)
      .set({ status: "unpaid", updatedAt: now })
      .where(eq(workspaceSubscriptions.workspaceId, input.workspaceId));
    await tx
      .update(workspaces)
      .set({ plan: "free", updatedAt: now })
      .where(eq(workspaces.id, input.workspaceId));
    return { expired: true };
  });
}