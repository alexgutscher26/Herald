import "server-only";

import { logEvent, serializeError } from "@/lib/logger";

import { getObservabilitySettings } from "./config";
import {
  currentRequestId,
  currentSpanId,
  currentTraceId,
  setCurrentSpanId,
} from "./context";

/**
 * Lightweight tracing.
 *
 * This is not a full OpenTelemetry exporter. It records a start and end time,
 * a stable trace id and the attributes that answer "which route, job or
 * provider call is slow". A span over `SLOW_SPAN_MS` is always logged as
 * `trace.slow`; with `TRACE_LOG_ALL=on` every span is logged at debug level for
 * a short debugging session. Shipping a full span pipeline is an operator
 * choice: the structured log line is already collector-friendly.
 *
 * Nested spans inherit the trace id and name their parent, so a slow job can
 * be read as job → provider → database without a distributed collector.
 */

export type SpanAttributes = Record<string, unknown>;

export type Span = {
  name: string;
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  requestId: string | null;
  startedAt: number;
  end(attributes?: SpanAttributes): number;
  fail(error: unknown, attributes?: SpanAttributes): number;
};

function spanId(): string {
  return globalThis.crypto.randomUUID().slice(0, 16);
}

export function startSpan(name: string, attributes: SpanAttributes = {}): Span {
  const startedAt = performance.now();
  const traceId = currentTraceId() ?? globalThis.crypto.randomUUID();
  const parentSpanId = currentSpanId();
  const id = spanId();
  const requestId = currentRequestId();
  setCurrentSpanId(id);
  let ended = false;

  const finish = (extra: SpanAttributes, failed: boolean): number => {
    const durationMs = Math.max(0, performance.now() - startedAt);
    // Restore the parent so a sibling span does not inherit this id.
    setCurrentSpanId(parentSpanId);
    if (ended) return durationMs;
    ended = true;

    const settings = getObservabilitySettings();
    const fields = {
      span: name,
      traceId,
      spanId: id,
      ...(parentSpanId ? { parentSpanId } : {}),
      ...(requestId ? { requestId } : {}),
      durationMs: Math.round(durationMs),
      ...(failed ? { failed: true } : {}),
      ...scrubAttributes(attributes),
      ...scrubAttributes(extra),
    };

    if (failed) {
      logEvent("error", "trace.failed", fields);
    } else if (durationMs >= settings.slowSpanMs) {
      logEvent("warn", "trace.slow", fields);
    } else if (settings.logEverySpan) {
      logEvent("debug", "trace.span", fields);
    }

    return durationMs;
  };

  return {
    name,
    traceId,
    spanId: id,
    parentSpanId,
    requestId,
    startedAt,
    end(extra = {}) {
      return finish(extra, false);
    },
    fail(error, extra = {}) {
      return finish({ ...extra, error: serializeError(error) }, true);
    },
  };
}

function scrubAttributes(attributes: SpanAttributes): SpanAttributes {
  const output: SpanAttributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (typeof value === "string") output[key] = value.slice(0, 300);
    else if (typeof value === "number" || typeof value === "boolean") output[key] = value;
    else if (value !== undefined && value !== null) output[key] = "[object]";
  }
  return output;
}

/**
 * Run one unit of work inside a span. Errors are recorded and rethrown, so a
 * caller's existing handling is unchanged.
 */
export async function withSpan<T>(
  name: string,
  attributes: SpanAttributes,
  fn: () => Promise<T> | T,
): Promise<T> {
  const span = startSpan(name, attributes);
  try {
    const result = await fn();
    span.end();
    return result;
  } catch (error) {
    span.fail(error);
    throw error;
  }
}
