/**
 * Database unavailability classification.
 *
 * A saturated or temporarily unreachable pool is a capacity condition, not a
 * bug in the request. Turning it into a friendly 503 with `Retry-After` keeps
 * a stack trace away from the browser and tells a load balancer the instance is
 * not ready to take work.
 *
 * The checks cover explicit SQLSTATE codes, node-postgres pool messages and
 * network error codes. A query error that is a genuine bug (syntax, constraint)
 * must not be classified as capacity, so the message list is narrow.
 */

const UNAVAILABLE_CODES = new Set([
  "53300", // too_many_connections
  "53400", // configuration_limit_exceeded
  "53200", // out_of_memory
  "57P03", // cannot_connect_now
  "57P02", // crash_shutdown
  "57P01", // admin_shutdown
  "08000", // connection_exception
  "08001", // sqlclient_unable_to_establish_sqlconnection
  "08003", // connection_does_not_exist
  "08004", // sqlserver_rejected_establishment_of_sqlconnection
  "08006", // connection_failure
  "08007", // transaction_resolution_unknown
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ETIMEDOUT",
  "EPIPE",
]);

const UNAVAILABLE_MESSAGES = [
  "timeout exceeded when trying to connect",
  "too many clients already",
  "remaining connection slots are reserved",
  "connection terminated unexpectedly",
  "connection terminated due to connection timeout",
  "pool is closed",
  "the connection is closed",
  "database system is starting up",
  "database system is in recovery mode",
  "could not connect to server",
];

function textOf(error: unknown): string {
  if (!(error instanceof Error)) return "";
  return error.message.toLowerCase();
}

export function isDatabaseUnavailable(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error) {
      const code = (current as { code?: unknown }).code;
      if (typeof code === "string" && UNAVAILABLE_CODES.has(code)) return true;
      if (typeof code === "number" && UNAVAILABLE_CODES.has(String(code))) return true;

      const message = textOf(current);
      if (UNAVAILABLE_MESSAGES.some((needle) => message.includes(needle))) return true;
    }
    current = (current as { cause?: unknown }).cause;
  }

  return false;
}

export class ServiceUnavailableError extends Error {
  readonly code = "service_unavailable";
  readonly retryAfterSeconds: number;

  constructor(message = "The service is temporarily busy. Please retry shortly.") {
    super(message);
    this.name = "ServiceUnavailableError";
    this.retryAfterSeconds = 3;
  }
}

/** JSON body used by API routes; keeps the v1 error shape. */
export function serviceUnavailableBody(requestId: string, message?: string) {
  return {
    error: {
      code: "service_unavailable",
      message:
        message ?? "The service is temporarily busy. Please retry in a few seconds.",
      request_id: requestId,
    },
  };
}
