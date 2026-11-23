import { NextResponse } from "next/server";

import { runJobNow } from "@/features/jobs/queue";
import type { PublishDueReleasesResult } from "@/features/releases/publisher";
import { cronAuthError, cronJson } from "@/lib/cron";
import { reportError } from "@/lib/error-report";
import { attachRequestId, requestIdFor } from "@/lib/request-context";
import { withRouteInstrumentation } from "@/lib/observability/route";

/**
 * Scheduled-release publisher.
 *
 * The endpoint contract is unchanged: callers still get `published` and
 * `failed` arrays. Internally, publishing is now the `publish_releases` job
 * type, run once per minute through the queue (the dedupe key makes
 * overlapping scheduler calls return the stored result).
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function run(request: Request): Promise<NextResponse> {
  const authError = cronAuthError(request);
  if (authError) return authError;

  const minute = Math.floor(Date.now() / 60_000);
  const job = await runJobNow({
    type: "publish_releases",
    dedupeKey: `publish-releases:${minute}`,
  });

  if (job.status === "running") {
    return cronJson(
      { ok: false, error: "A publish run is already in progress." },
      503,
    );
  }

  if (job.status !== "succeeded" || !job.result) {
    return cronJson(
      { ok: false, error: "Could not publish scheduled releases." },
      500,
    );
  }

  const result = job.result as unknown as Partial<PublishDueReleasesResult>;
  const published = Array.isArray(result.published) ? result.published : [];
  const failed = Array.isArray(result.failed) ? result.failed : [];
  const checkedAt =
    typeof result.checkedAt === "string" ? result.checkedAt : new Date().toISOString();

  return cronJson(
    {
      ok: failed.length === 0,
      checkedAt,
      published,
      publishedCount: published.length,
      failed,
      failedCount: failed.length,
    },
    failed.length === 0 ? 200 : 500,
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
      { requestId, route: "/api/cron/publish-releases" },
      "cron.publish_releases.failed",
    );
    response = cronJson({ ok: false, error: "Could not publish scheduled releases." }, 500);
  }

  return attachRequestId(response, requestId);
}

export const GET = withRouteInstrumentation("GET /api/cron/publish-releases", handle);

export const POST = withRouteInstrumentation("POST /api/cron/publish-releases", handle);
