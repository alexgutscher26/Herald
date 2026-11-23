import "server-only";

import { getErrorWebhookUrl, getSentryDsn } from "@/lib/env";
import { logEvent, redactFields, serializeError, type LogFields } from "@/lib/logger";
import { captureServerException } from "@/lib/posthog";

import { currentRequestId } from "./observability/context";
import { debugImagesForFrames } from "./observability/debug-images";
import { getReleaseInfo } from "./observability/release";
import {
  buildSentryEvent,
  parseSentryDsn,
  parseStackFrames,
  sendSentryEvent,
} from "./observability/sentry";

/**
 * Error reporting.
 *
 * Every error is written to the structured log first — that record is the one
 * that always exists. Then:
 *
 *  - with `SENTRY_DSN` set, a scrubbbed Sentry-compatible event is POSTed with
 *    the deployment's release and environment tags (source maps are uploaded
 *    under the same release by `bun run observability:sourcemaps`);
 *  - otherwise, or when that delivery fails, the compact webhook payload is
 *    posted to `ERROR_WEBHOOK_URL`.
 *
 * Delivery is best-effort and bounded: a slow or broken collector must never
 * delay or fail the request that reported the error, and a delivery failure is
 * itself logged rather than thrown. No cookies, headers, query strings, user
 * identity or tenant identifiers are included in either payload.
 */

const TIMEOUT_MS = 3_000;

function routeFromContext(context: LogFields): string | null {
  const route = context.route ?? context.path;
  return typeof route === "string" ? route : null;
}

export async function reportError(
  error: unknown,
  context: LogFields = {},
  event = "unhandled_error",
): Promise<void> {
  const serialized = serializeError(error);
  const release = getReleaseInfo();
  const requestId =
    typeof context.requestId === "string" ? context.requestId : currentRequestId();

  logEvent("error", event, {
    ...context,
    ...(requestId ? { requestId } : {}),
    release: release.release,
    environment: release.environment,
    error: serialized,
  });

  await captureServerException(error);

  let dsn: string | null;
  let webhookUrl: string | null;
  try {
    dsn = getSentryDsn();
    webhookUrl = getErrorWebhookUrl();
  } catch (configError) {
    logEvent("warn", "error_report.misconfigured", {
      error: serializeError(configError),
    });
    return;
  }

  const target = parseSentryDsn(dsn);
  if (target) {
    const delivered = await sendSentryEvent(
      target,
      buildSentryEvent({
        event,
        error: serialized,
        release: release.release,
        environment: release.environment,
        requestId,
        route: routeFromContext(context),
        fields: context,
        debugImages: debugImagesForFrames(parseStackFrames(serialized.stack)),
      }),
    );
    if (delivered) return;

    logEvent("warn", "error_report.undelivered", {
      channel: "sentry",
      endpoint: target.origin,
    });
    // Fall through to the webhook so one collector outage does not silence
    // every error report.
  }

  if (!webhookUrl) return;

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(requestId ? { "x-request-id": requestId } : {}),
      },
      // `redirect: "error"` stops a misconfigured URL from posting to an
      // unrelated host after a redirect.
      redirect: "error",
      body: JSON.stringify({
        source: "herald",
        event,
        timestamp: new Date().toISOString(),
        release: release.release,
        environment: release.environment,
        ...(requestId ? { request_id: requestId } : {}),
        ...redactFields(context),
        error: serialized,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (transportError) {
    logEvent("warn", "error_report.undelivered", {
      channel: "webhook",
      error: serializeError(transportError),
    });
  }
}
