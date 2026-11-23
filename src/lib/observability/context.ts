import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-request context.
 *
 * `requestId` is the same value returned in `x-request-id`; it is propagated
 * into job rows and provider calls so one customer request can be followed
 * through the queue and into Resend, an AI provider or a webhook receiver.
 * `traceId` is independent so a background job that did not start from an HTTP
 * request still has one correlation value.
 *
 * AsyncLocalStorage is Node-only; every caller is a route handler, server
 * action, job or provider, never the proxy.
 */

export type RequestContext = {
  requestId: string | null;
  traceId: string;
  spanId: string | null;
};

const storage = new AsyncLocalStorage<RequestContext>();

function newId(): string {
  return globalThis.crypto.randomUUID();
}

export function currentContext(): RequestContext | null {
  return storage.getStore() ?? null;
}

export function currentRequestId(): string | null {
  return storage.getStore()?.requestId ?? null;
}

export function currentTraceId(): string | null {
  return storage.getStore()?.traceId ?? null;
}

/**
 * Run work under a request id. Nested calls inherit the existing trace and do
 * not replace a request id with null.
 */
export function runWithRequestId<T>(requestId: string | null, fn: () => T): T {
  const existing = storage.getStore();
  if (existing && existing.requestId === requestId) return fn();

  return storage.run(
    {
      requestId: requestId ?? existing?.requestId ?? null,
      traceId: existing?.traceId ?? newId(),
      spanId: existing?.spanId ?? null,
    },
    fn,
  );
}

/** Run work under a fresh trace when no request boundary exists. */
export function runWithTrace<T>(fn: () => T): T {
  const existing = storage.getStore();
  if (existing) return fn();
  return storage.run({ requestId: null, traceId: newId(), spanId: null }, fn);
}

export function setCurrentSpanId(spanId: string | null): void {
  const context = storage.getStore();
  if (context) context.spanId = spanId;
}

export function currentSpanId(): string | null {
  return storage.getStore()?.spanId ?? null;
}

/** Test-only: read the context through an explicitly created scope. */
export function withRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}
