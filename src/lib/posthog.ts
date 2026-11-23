import "server-only";

import { createHash } from "node:crypto";

import { after } from "next/server";
import { PostHog } from "posthog-node";

import { getPostHogConfig } from "@/lib/env";
import { log } from "@/lib/logger";

/**
 * Server-side PostHog capture.
 *
 * Herald already records privacy-reviewed events for its own dashboards. This
 * module forwards those same events to PostHog so funnels can be explored
 * there. There is deliberately no browser SDK: no PostHog cookie, local storage
 * entry or visitor identifier is created on anyone's device, and no
 * third-party script is loaded into a page.
 *
 * Every call is best-effort. Without `POSTHOG_API_KEY` capture is a no-op, and
 * a misconfiguration or transport failure is logged and swallowed, so analytics
 * can never fail a page view, vote, sign-up or widget install.
 */

const DISTINCT_ID_PREFIX = "herald:posthog:";

let cached: PostHog | null | undefined;

function postHogClient(): PostHog | null {
  if (cached !== undefined) return cached;

  let config: { apiKey: string; host: string } | null = null;
  try {
    config = getPostHogConfig();
  } catch (error) {
    log.warn("analytics.posthog_misconfigured", {
      error: error instanceof Error ? error.message : "unknown",
    });
  }

  if (!config) {
    cached = null;
    return cached;
  }

  cached = new PostHog(config.apiKey, {
    host: config.host,
    // Serverless: a queued event can be frozen before it is flushed, so every
    // capture is sent immediately instead.
    flushAt: 1,
    flushInterval: 0,
    maxQueueSize: 100,
    requestTimeout: 3_000,
    // Let the Node SDK own process-level uncaught exception and rejection
    // listeners. Edge runtimes cannot register those listeners.
    enableExceptionAutocapture: process.env.NEXT_RUNTIME === "nodejs",
    disableGeoip: true,
    captureTracingHeaders: false,
  });
  return cached;
}

/**
 * A one-way 32-character key for a PostHog person.
 *
 * It is derived from a subject Herald already treats as non-identifying — a
 * day-scoped visitor hash, a hashed funnel subject or a product id — so PostHog
 * can count distinct visitors and products without ever receiving an email
 * address, a raw account id, an IP address or a user agent.
 */
export function postHogDistinctId(subject: string): string {
  return createHash("sha256")
    .update(`${DISTINCT_ID_PREFIX}${subject}`)
    .digest("hex")
    .slice(0, 32);
}

export type PostHogProperty = string | number | boolean;

/** Send an exception immediately. Returns whether PostHog accepted it; never throws. */
export async function captureServerException(error: unknown): Promise<boolean> {
  const posthog = postHogClient();
  if (!posthog) return false;

  try {
    await posthog.captureExceptionImmediate(error);
    return true;
  } catch (captureError) {
    log.warn("analytics.posthog_exception_capture_failed", {
      error: captureError instanceof Error ? captureError.message : "unknown",
    });
    return false;
  }
}

/** Send one event immediately. Returns whether PostHog accepted it; never throws. */
export async function captureServerEvent(input: {
  event: string;
  distinctId: string;
  properties?: Record<string, PostHogProperty> | undefined;
}): Promise<boolean> {
  const posthog = postHogClient();
  if (!posthog) return false;

  try {
    await posthog.captureImmediate({
      distinctId: input.distinctId,
      event: input.event,
      properties: { ...input.properties, source: "herald-server" },
      sendFeatureFlags: false,
    });
    return true;
  } catch (error) {
    log.warn("analytics.posthog_capture_failed", {
      event: input.event,
      error: error instanceof Error ? error.message : "unknown",
    });
    return false;
  }
}

/**
 * Send one event after the response has been produced.
 *
 * `after` keeps the work inside the request lifecycle on a serverless host, so
 * the request is not held open for a third-party round trip and the send is not
 * dropped when the response ends. A render outside a Next request (a script or
 * an integration test) has no such scope, so it falls back to a floating
 * promise instead of throwing.
 */
export function captureServerEventAfterResponse(input: {
  event: string;
  distinctId: string;
  properties?: Record<string, PostHogProperty> | undefined;
}): void {
  const send = async () => {
    await captureServerEvent(input);
  };

  try {
    after(send);
  } catch {
    void send();
  }
}
