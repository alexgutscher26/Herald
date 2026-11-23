/**
 * Next.js server instrumentation.
 *
 * `onRequestError` is the one hook that sees every unhandled error raised by a
 * page render, route handler or server action. Routing it through the same
 * reporter as explicit `reportError` call sites means release tagging, PII
 * scrubbing and the configured collector apply everywhere, not only where a
 * developer remembered to add a try/catch.
 *
 * The imports are dynamic and guarded by runtime so the module also compiles for
 * the edge bundle, where Node-only modules are unavailable.
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    const [{ getReleaseInfo }, { logEvent }] = await Promise.all([
      import("./lib/observability/release"),
      import("./lib/logger"),
    ]);
    const release = getReleaseInfo();
    logEvent("info", "observability.ready", {
      release: release.release,
      environment: release.environment,
      commit: release.commit,
    });
  } catch {
    // Logging must never prevent the server from starting.
  }
}

type RequestInfo = {
  path?: string;
  method?: string;
  headers?: Record<string, string | string[] | undefined> | Headers;
};

function headerValue(headers: RequestInfo["headers"], name: string): unknown {
  if (!headers) return undefined;
  if (headers instanceof Headers) return headers.get(name);
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

type ErrorContext = {
  routerKind?: string;
  routePath?: string;
  routeType?: string;
};

export async function onRequestError(
  error: unknown,
  request: RequestInfo,
  context: ErrorContext,
): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    const [{ reportError }, { REQUEST_ID_HEADER, sanitizeRequestId }] =
      await Promise.all([
        import("./lib/error-report"),
        import("./lib/request-context"),
      ]);

    const requestId = sanitizeRequestId(
      headerValue(request.headers, REQUEST_ID_HEADER) as string | null | undefined,
    );
    await reportError(
      error,
      {
        requestId,
        route: context.routePath ?? request.path ?? "unknown",
        method: request.method ?? "unknown",
        router: context.routerKind,
        routeType: context.routeType,
      },
      "next.request_error",
    );
  } catch {
    // A failure inside the error reporter must not mask the original error.
  }
}
