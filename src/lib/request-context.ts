/**
 * Request correlation.
 *
 * A request id is accepted from an upstream proxy only when it looks like one;
 * otherwise a fresh UUID is generated. The id is written back on the response
 * and included in structured logs, so a log drain and a browser network tab can
 * be joined without exposing anything else about the request.
 *
 * No Node-only imports: this module is used from the proxy, which may run in a
 * non-Node runtime.
 */

export const REQUEST_ID_HEADER = "x-request-id";

/** Deliberately narrow: no spaces, quotes, slashes or control characters. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;

export function sanitizeRequestId(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  return SAFE_REQUEST_ID.test(candidate) ? candidate : null;
}

export function newRequestId(): string {
  return globalThis.crypto.randomUUID();
}

/** Prefer a trustworthy inbound id; otherwise generate one. */
export function requestIdFor(request: Request): string {
  return sanitizeRequestId(request.headers.get(REQUEST_ID_HEADER)) ?? newRequestId();
}

export function requestIdFromHeaders(headers: Headers): string {
  return sanitizeRequestId(headers.get(REQUEST_ID_HEADER)) ?? newRequestId();
}

/** Echo the id so a client or log can correlate the response. */
export function attachRequestId<T extends { headers: Headers }>(response: T, id: string): T {
  response.headers.set(REQUEST_ID_HEADER, id);
  return response;
}
