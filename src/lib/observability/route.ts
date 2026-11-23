import "server-only";

import { after, NextResponse } from "next/server";

import { reportError } from "@/lib/error-report";
import { logEvent } from "@/lib/logger";
import { REQUEST_ID_HEADER, attachRequestId, requestIdFor } from "@/lib/request-context";

import { getObservabilitySettings } from "./config";
import { runWithRequestId } from "./context";
import {
  isDatabaseUnavailable,
  serviceUnavailableBody,
} from "./pool-errors";
import { recordRequestMetric } from "./route-metrics";
import { withSpan } from "./tracing";

/**
 * Instrument one API route.
 *
 * The wrapper guarantees a single request id (generated once and injected into
 * the request the handler receives), runs the handler inside a trace span and
 * async context, records one aggregate metric and returns a friendly JSON 503
 * when the database pool is exhausted or unreachable instead of letting a
 * stack trace become the response.
 *
 * It deliberately does not change successful responses or handled errors: a
 * route that already returns a typed 4xx/5xx keeps doing so.
 */

export type InstrumentedHandler = (
  request: Request,
  context?: unknown,
) => Promise<Response> | Response;

const NO_STORE = { "cache-control": "no-store" } as const;

function friendlyUnavailable(requestId: string): NextResponse {
  return NextResponse.json(serviceUnavailableBody(requestId), {
    status: 503,
    headers: {
      ...NO_STORE,
      "retry-after": "3",
    },
  });
}

function internalError(requestId: string): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: "internal_error",
        message: "Something went wrong. Please retry.",
        request_id: requestId,
      },
    },
    { status: 500, headers: NO_STORE },
  );
}

export function withRouteInstrumentation(
  route: string,
  handler: InstrumentedHandler,
): InstrumentedHandler {
  return async (request: Request, context?: unknown): Promise<Response> => {
    const requestId = requestIdFor(request);
    const startedAt = performance.now();

    return runWithRequestId(requestId, () =>
      withSpan(`http ${route}`, { route, method: request.method }, async () => {
        let response: Response;

        try {
          // Give the handler the same id the wrapper will echo, so a nested
          // `requestIdFor` does not generate a second, different one.
          let scoped = request;
          if (request.headers.get(REQUEST_ID_HEADER) !== requestId) {
            try {
              const headers = new Headers(request.headers);
              headers.set(REQUEST_ID_HEADER, requestId);
              scoped = new Request(request, { headers });
            } catch {
              scoped = request;
            }
          }
          response = await handler(scoped, context);
        } catch (error) {
          if (isDatabaseUnavailable(error)) {
            logEvent("warn", "http.service_unavailable", {
              route,
              method: request.method,
              requestId,
            });
            response = friendlyUnavailable(requestId);
          } else {
            await reportError(
              error,
              { requestId, route, method: request.method },
              "http.route_failed",
            );
            response = internalError(requestId);
          }
        }

        const durationMs = Math.max(0, performance.now() - startedAt);
        attachRequestId(response, requestId);
        response.headers.set("server-timing", `app;dur=${Math.round(durationMs)}`);

        // Run after the response is finished: a metric write must not add
        // latency, and `after` keeps it inside the request lifecycle on a
        // serverless host instead of dropping a floating promise.
        const metric = () =>
          recordRequestMetric({
            route,
            method: request.method,
            status: response.status,
            durationMs,
          });
        try {
          after(metric);
        } catch {
          // A route handler invoked directly (an integration test or a script)
          // has no Next request scope; still attempt the best-effort write.
          void metric();
        }

        const settings = getObservabilitySettings();
        const fields = {
          route,
          method: request.method,
          status: response.status,
          durationMs: Math.round(durationMs),
          requestId,
        };
        if (durationMs >= settings.slowRouteMs) {
          logEvent("warn", "http.slow_route", fields);
        } else if (response.status >= 500) {
          logEvent("error", "http.server_error", fields);
        }

        return response;
      }),
    );
  };
}
