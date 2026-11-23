import "server-only";

import { and, eq, gte, lte } from "drizzle-orm";

import { db } from "@/db";
import { workspaceSubscriptions } from "@/db/schema";
import { enqueueJob } from "@/features/jobs/queue";
import { logEvent, serializeError } from "@/lib/logger";

const REMINDER_WINDOW_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Queue one trial-ending notice per workspace and trial period.
 *
 * The job dedupe key is the trial end date, so running the cron every minute
 * cannot send the reminder more than once. A failed job remains visible in the
 * operations dashboard; the next day's cron does not silently create a second
 * successful send for the same trial.
 */
export async function enqueueTrialReminders(
  now = new Date(),
): Promise<{ queued: number }> {
  const until = new Date(now.getTime() + REMINDER_WINDOW_DAYS * DAY_MS);
  const rows = await db
    .select({
      workspaceId: workspaceSubscriptions.workspaceId,
      trialEndsAt: workspaceSubscriptions.trialEndsAt,
    })
    .from(workspaceSubscriptions)
    .where(
      and(
        eq(workspaceSubscriptions.status, "trialing"),
        eq(workspaceSubscriptions.cancelAtPeriodEnd, false),
        gte(workspaceSubscriptions.trialEndsAt, now),
        lte(workspaceSubscriptions.trialEndsAt, until),
      ),
    );

  let queued = 0;
  for (const row of rows) {
    if (!row.trialEndsAt) continue;
    const trialEndsAt = row.trialEndsAt.toISOString();
    const noticeKey = trialEndsAt.slice(0, 10);
    try {
      const job = await enqueueJob({
        type: "send_billing_email",
        payload: {
          workspaceId: row.workspaceId,
          kind: "trial_ending",
          noticeKey,
          trialEndsAt,
        },
        dedupeKey: `billing-trial:${row.workspaceId}:${noticeKey}`,
      });
      if (job.created) queued += 1;
    } catch (error) {
      logEvent("error", "billing.trial_reminder_enqueue_failed", {
        workspaceId: row.workspaceId,
        error: serializeError(error),
      });
    }
  }

  return { queued };
}
