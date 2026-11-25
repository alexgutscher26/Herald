import { NextResponse } from "next/server";

import { scanConversationSlaBreaches } from "@/features/conversations/sla";
import { getRecentFailedJobs, getRecentJobRuns } from "@/features/jobs/history";
import { enqueueJob, runDueJobs } from "@/features/jobs/queue";
import { scheduleJunoAutoResolve } from "@/features/juno/schedule";
import { scheduleKnowledgeRecrawls } from "@/features/juno/freshness";
import { enqueueTrialReminders } from "@/features/billing/schedule";
import { cronAuthError, cronJson } from "@/lib/cron";
import { reportError } from "@/lib/error-report";
import { attachRequestId, requestIdFor } from "@/lib/request-context";
import { withRouteInstrumentation } from "@/lib/observability/route";

/**
 * Background job runner.
 *
 * Point a scheduler at this endpoint with `Authorization: Bearer $CRON_SECRET`.
 * Each invocation claims at most 20 due jobs using `FOR UPDATE SKIP LOCKED` and
 * returns counts only — per job type and in total, plus one id/type/status row
 * per job. Payloads, tenant identifiers and error details are never returned.
 *
 * `?view=history` returns the last runs and the jobs that exhausted their
 * attempts, so a failure is visible with one curl instead of a database
 * console. It requires the same secret and runs no work.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function run(request: Request): Promise<NextResponse> {
  const authError = cronAuthError(request);
  if (authError) return authError;

  const url = new URL(request.url);
  if (url.searchParams.get("view") === "history") {
    const [runs, failedJobs] = await Promise.all([
      getRecentJobRuns(10),
      getRecentFailedJobs(20),
    ]);

    return cronJson({ ok: true, runs, failedJobs }, 200);
  }

  // Queue the Mira auto-resolve sweep at most once per minute, and only when
  // an active Mira thread exists. A queue hiccup must not stop other jobs.
  await scheduleJunoAutoResolve().catch(() => ({ scheduled: false }));

  // Recrawl only the sources whose own interval is due. A crawl is queued as a
  // new version, so the live index keeps serving until the diff is complete.
  const recrawls = await scheduleKnowledgeRecrawls().catch(() => ({
    queued: 0,
    checked: 0,
  }));

  // The business-hours clock is evaluated from stored timestamps, so this is a
  // cheap idempotent sweep rather than a timer row per conversation. A failure
  // is reported in the summary, never by blocking the other jobs.
  const sla = await scanConversationSlaBreaches().catch(() => ({
    checked: 0,
    breached: 0,
  }));

  // Daily operational jobs use a UTC date in the dedupe key, so a scheduler
  // that runs more than once per day cannot recalculate or prune repeatedly.
  const day = new Date().toISOString().slice(0, 10);
  await Promise.all([
    enqueueJob({
      type: "schedule_outbound_messages",
      dedupeKey: `outbound-schedule:${Math.floor(Date.now() / 60_000)}`,
    }).catch(() => null),
    enqueueJob({
      type: "recalculate_analytics",
      dedupeKey: `analytics:${day}`,
    }).catch(() => null),
    enqueueJob({
      type: "purge_workspaces",
      dedupeKey: `purge-workspaces:${day}`,
    }).catch(() => null),
    enqueueJob({
      type: "prune_audit_events",
      dedupeKey: `prune-audit:${day}`,
    }).catch(() => null),
    enqueueJob({
      type: "send_onboarding_emails",
      // The sequence is paced, but the sweep should react to a new signup
      // within minutes rather than waiting for the next UTC day.
      dedupeKey: `onboarding-emails:${Math.floor(Date.now() / 300_000)}`,
    }).catch(() => null),
    enqueueJob({
      type: "schedule_crm_sync",
      dedupeKey: `crm-schedule:${day}`,
    }).catch(() => null),
    enqueueJob({
      type: "export_saved_reports",
      dedupeKey: `saved-reports:${day}`,
    }).catch(() => null),
    enqueueJob({
      type: "verify_backups",
      dedupeKey: `backup-verification:${day}`,
    }).catch(() => null),
    enqueueJob({
      type: "prune_observability",
      dedupeKey: `observability-prune:${day}`,
    }).catch(() => null),
    // Aggregate alerts are cheap and benefit from a short cadence. A five
    // minute bucket caps the evaluation cost while keeping detection inside a
    // normal on-call acknowledgement window.
    enqueueJob({
      type: "evaluate_alerts",
      dedupeKey: `alert-evaluation:${Math.floor(Date.now() / 300_000)}`,
    }).catch(() => null),
    enqueueTrialReminders().catch(() => ({ queued: 0 })),
  ]);

  const summary = await runDueJobs(20);
  return cronJson(
    {
      ok: summary.failed === 0,
      checkedAt: summary.checkedAt,
      claimed: summary.claimed,
      succeeded: summary.succeeded,
      failed: summary.failed,
      retrying: summary.retrying,
      byType: summary.byType,
      sla: { checked: sla.checked, breached: sla.breached },
      knowledgeRecrawls: recrawls,
      jobs: summary.results.map((job) => ({
        id: job.id,
        type: job.type,
        status: job.status,
      })),
    },
    summary.failed === 0 ? 200 : 500,
  );
}

async function handle(request: Request): Promise<NextResponse> {
  const requestId = requestIdFor(request);
  let response: NextResponse;

  try {
    response = await run(request);
  } catch (error) {
    await reportError(error, { requestId, route: "/api/cron/jobs" }, "cron.jobs.failed");
    response = cronJson({ ok: false, error: "Could not run background jobs." }, 500);
  }

  return attachRequestId(response, requestId);
}

export const GET = withRouteInstrumentation("GET /api/cron/jobs", handle);

export const POST = withRouteInstrumentation("POST /api/cron/jobs", handle);
