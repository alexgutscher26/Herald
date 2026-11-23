import { NextResponse } from "next/server";

import { cronAuthError, cronJson } from "@/lib/cron";
import { reportError } from "@/lib/error-report";
import { attachRequestId, requestIdFor } from "@/lib/request-context";
import { withRouteInstrumentation } from "@/lib/observability/route";
import { deliverDueWebhooks } from "@/features/webhooks/service";

/**
 * Scheduled webhook delivery.
 *
 * Point a scheduler at this endpoint with `Authorization: Bearer $CRON_SECRET`.
 * Each invocation claims at most 20 due deliveries with `FOR UPDATE SKIP
 * LOCKED`, signs the stored payload and retries failures with backoff. The
 * response contains counts only; payloads and URLs never appear.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function run(request: Request): Promise<NextResponse> {
  const authError = cronAuthError(request);
  if (authError) return authError;

  const summary = await deliverDueWebhooks({ limit: 20 });
  return cronJson(
    {
      ok: summary.failed === 0,
      checkedAt: summary.checkedAt,
      claimed: summary.claimed,
      succeeded: summary.succeeded,
      failed: summary.failed,
      retrying: summary.retrying,
      skipped: summary.skipped,
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
    await reportError(error, { requestId, route: "/api/cron/webhooks" }, "cron.webhooks.failed");
    response = cronJson({ ok: false, error: "Could not deliver webhooks." }, 500);
  }
  return attachRequestId(response, requestId);
}

export const GET = withRouteInstrumentation("GET /api/cron/webhooks", handle);

export const POST = withRouteInstrumentation("POST /api/cron/webhooks", handle);
