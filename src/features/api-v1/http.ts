import { NextResponse } from "next/server";
import { z } from "zod";

import {
  REQUEST_ID_HEADER,
  newRequestId,
  sanitizeRequestId,
} from "@/lib/request-context";

/**
 * HTTP helpers for the v1 API.
 *
 * Every response is JSON, uncached, and carries the request id plus the API
 * version. Errors use one shape — `{ error: { code, message, request_id } }` —
 * so a client can branch on `code` without parsing prose.
 *
 * Handlers signal expected failures by throwing `ApiFailure`; the router
 * turns that into the response. Anything else becomes a logged 500 and never
 * leaks an internal message.
 */

export const API_VERSION = "1";
export const API_VERSION_HEADER = "x-api-version";
export const API_NO_STORE = "private, no-store";

/** Standard response headers for an operation that is being retired. */
export const API_DEPRECATION_HEADER = "deprecation";
export const API_SUNSET_HEADER = "sunset";

/**
 * Deprecation headers for a dated retirement.
 *
 * The policy is documented in `docs/api-versioning.md`: an old version or an
 * individual operation gets at least 12 months of notice, a `Deprecation`
 * timestamp, a `Sunset` timestamp and a `Link` to the replacement. Keeping the
 * construction here means the dates always serialize as HTTP-date, never as a
 * locale string.
 */
export function apiDeprecationHeaders(input: {
  deprecatedAt: Date;
  sunsetAt: Date;
  replacementUrl: string;
}): Record<string, string> {
  return {
    [API_DEPRECATION_HEADER]: input.deprecatedAt.toUTCString(),
    [API_SUNSET_HEADER]: input.sunsetAt.toUTCString(),
    link: `<${input.replacementUrl}>; rel="successor-version"`,
  };
}

export type ApiErrorCode =
  | "api_disabled"
  | "unauthorized"
  | "forbidden"
  | "plan_required"
  | "not_found"
  | "invalid_request"
  | "invalid_json"
  | "validation_failed"
  | "conflict"
  | "idempotency_key_reused"
  | "idempotency_in_progress"
  | "rate_limited"
  | "internal_error";

export class ApiFailure extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details?: unknown;
  readonly headers?: Record<string, string> | undefined;

  constructor(
    status: number,
    code: ApiErrorCode,
    message: string,
    options: { details?: unknown; headers?: Record<string, string> | undefined } = {},
  ) {
    super(message);
    this.name = "ApiFailure";
    this.status = status;
    this.code = code;
    this.details = options.details;
    this.headers = options.headers;
  }
}

export function apiRequestId(request: Request): string {
  return sanitizeRequestId(request.headers.get(REQUEST_ID_HEADER)) ?? newRequestId();
}

export function apiJson(
  body: unknown,
  input: { status?: number | undefined; requestId: string; headers?: Record<string, string> | undefined } = {
    requestId: "",
  },
): NextResponse {
  const headers = new Headers(input.headers);
  headers.set("cache-control", API_NO_STORE);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set(REQUEST_ID_HEADER, input.requestId);
  headers.set(API_VERSION_HEADER, API_VERSION);

  return new NextResponse(JSON.stringify(body), {
    status: input.status ?? 200,
    headers,
  });
}

export function apiErrorResponse(input: {
  status: number;
  code: ApiErrorCode;
  message: string;
  requestId: string;
  details?: unknown;
  headers?: Record<string, string> | undefined;
}): NextResponse {
  const payload: Record<string, unknown> = {
    error: {
      code: input.code,
      message: input.message,
      request_id: input.requestId,
    },
  };
  if (input.details !== undefined) payload.error = { ...payload.error as object, details: input.details };

  return apiJson(payload, {
    status: input.status,
    requestId: input.requestId,
    headers: input.headers,
  });
}

export function apiNotFound(requestId: string, what = "Resource"): ApiFailure {
  return new ApiFailure(404, "not_found", `${what} not found.`);
}

export function readJsonBody(bodyText: string): unknown {
  if (bodyText.trim() === "") {
    throw new ApiFailure(400, "invalid_json", "Send a JSON request body.");
  }
  try {
    return JSON.parse(bodyText);
  } catch {
    throw new ApiFailure(400, "invalid_json", "The request body is not valid JSON.");
  }
}

/**
 * Validate a body and translate Zod issues into per-field details.
 *
 * The message stays generic; `details` maps field paths to messages so a
 * client can show them next to the control.
 */
export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;

  const details: Record<string, string[]> = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path.join(".") || "body";
    details[key] = [...(details[key] ?? []), issue.message];
  }

  throw new ApiFailure(400, "validation_failed", "Check the request fields.", {
    details,
  });
}

export function fieldErrors(error: z.ZodError): Record<string, string[]> {
  const details: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "body";
    details[key] = [...(details[key] ?? []), issue.message];
  }
  return details;
}
