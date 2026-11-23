import { NextResponse } from "next/server";

import { runJobNow } from "@/features/jobs/queue";
import {
  digestDayKey,
  weeklyDigestWeekKey,
  type DueDigestSummary,
  type DigestQueueSummary,
} from "@/features/notifications/digest";
import { cronAuthError, cronJson } from "@/lib/cron";
import { reportError } from "@/lib/error-report";
import { attachRequestId, requestIdFor } from "@/lib/request-context";
import { withRouteInstrumentation } from "@/lib/observability/route";

/**
 * Email digest scheduler.
 *
 * Point a daily scheduler at this endpoint with
 * `Authorization: Bearer $CRON_SECRET`. It queues due daily and weekly digest
 * outbox rows; the weekly query is deduped per ISO week and the daily query per
 * UTC day, so calling it every day cannot send a weekly digest twice. Queueing
 * only writes outbox rows; the normal delivery sweep sends them.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function summaryOf(value: unknown): DigestQueueSummary | null {
  if (!value || typeof value !== "object") return null;
  return value as DigestQueueSummary;
}

async function run(request: Request): Promise<NextResponse> {
  const authError = cronAuthError(request);
  if (authError) return authError;

  const now = new Date();
  const dayKey = digestDayKey(now);
  const weekKey = weeklyDigestWeekKey(now);
  const job = await runJobNow({
    type: "send_weekly_digest",
    dedupeKey: `email-digests:${dayKey}`,
  });

  if (job.status === "running") {
    return cronJson({ ok: false, error: "A digest run is already in progress." }, 503);
  }

  if (job.status !== "succeeded" || !job.result) {
    return cronJson({ ok: false, error: "Could not queue email digests." }, 500);
  }

  const result = job.result as unknown as Partial<DueDigestSummary>;
  const daily = summaryOf(result.daily);
  const weekly = summaryOf(result.weekly);
  return cronJson(
    {
      ok: true,
      checkedAt:
        typeof result.checkedAt === "string" ? result.checkedAt : now.toISOString(),
      dayKey: daily?.dayKey ?? dayKey,
      weekKey: weekly?.weekKey ?? weekKey,
      queued: (daily?.queued ?? 0) + (weekly?.queued ?? 0),
      dailyQueued: daily?.queued ?? 0,
      weeklyQueued: weekly?.queued ?? 0,
      products: [...new Set([...(daily?.products ?? []), ...(weekly?.products ?? [])])],
      emptyProducts: [
        ...new Set([...(daily?.emptyProducts ?? []), ...(weekly?.emptyProducts ?? [])]),
      ],
    },
    200,
  );
}

async function handle(request: Request): Promise<NextResponse> {
  const requestId = requestIdFor(request);
  let response: NextResponse;

  try {
    response = await run(request);
  } catch (error) {
    await reportError(
      error,
      { requestId, route: "/api/cron/weekly-digest" },
      "cron.email_digests.failed",
    );
    response = cronJson({ ok: false, error: "Could not queue email digests." }, 500);
  }

  return attachRequestId(response, requestId);
}

export const GET = withRouteInstrumentation("GET /api/cron/weekly-digest", handle);

export const POST = withRouteInstrumentation("POST /api/cron/weekly-digest", handle);
