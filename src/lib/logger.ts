/**
 * Structured server logs.
 *
 * One JSON object per line, so a log drain can filter by `event` and `level`
 * without parsing prose. Three rules keep the format safe:
 *
 *  - a field whose key looks like a credential is replaced, never printed;
 *  - every string value is scanned for email addresses, tokens, cookies, IPs,
 *    phone numbers and card numbers (see observability/scrub.ts);
 *  - an `Error` is reduced to name/message/stack rather than serialized raw.
 *
 * Long strings are truncated so one oversized payload cannot flood a drain.
 * This module has no Node-only imports and can run in any server runtime.
 */

import { getReleaseInfo } from "@/lib/observability/release";
import { REDACTED, SENSITIVE_KEY, scrubText, scrubValue } from "@/lib/observability/scrub";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

const MAX_STRING = 500;
const MAX_DEPTH = 3;
const MAX_ARRAY = 20;

export type SerializedError = {
  name: string;
  message: string;
  code?: string;
  stack?: string;
};

export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    const serialized: SerializedError = {
      name: error.name,
      message: scrubText(error.message).slice(0, MAX_STRING),
    };
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" || typeof code === "number") {
      serialized.code = scrubText(String(code));
    }
    if (error.stack) serialized.stack = scrubText(error.stack).slice(0, 2_000);
    return serialized;
  }

  if (typeof error === "string") {
    return { name: "Error", message: scrubText(error).slice(0, MAX_STRING) };
  }

  return { name: "Error", message: "Non-error value thrown." };
}

function redactValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return scrubText(value).slice(0, MAX_STRING);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return serializeError(value);
  if (typeof value === "function" || typeof value === "symbol") return undefined;

  if (depth >= MAX_DEPTH) return "[truncated]";

  if (typeof value === "object") {
    if (seen.has(value)) return "[circular]";
    seen.add(value);
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY)
      .map((item) => redactValue(item, depth + 1, seen));
  }

  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(key)) {
        output[key] = REDACTED;
        continue;
      }
      const redacted = redactValue(inner, depth + 1, seen);
      if (redacted !== undefined) output[key] = redacted;
    }
    return output;
  }

  return scrubText(String(value)).slice(0, MAX_STRING);
}

export function redactFields(fields: LogFields): LogFields {
  const seen = new WeakSet<object>();
  const output: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (SENSITIVE_KEY.test(key)) {
      output[key] = REDACTED;
      continue;
    }
    const redacted = redactValue(value, 1, seen);
    if (redacted !== undefined) output[key] = redacted;
  }
  return output;
}

/** Normalise an event name to `some.event` without newlines. */
export function normalizeEvent(event: string): string {
  const cleaned = event.replace(/[\r\n\t]+/g, " ").trim().slice(0, 120);
  return cleaned.length > 0 ? cleaned : "unknown";
}

export type LogEntry = {
  time: string;
  level: LogLevel;
  event: string;
  release: string;
} & LogFields;

/** Build the serializable entry. Exported so tests can assert its shape. */
export function buildLogEntry(
  level: LogLevel,
  event: string,
  fields: LogFields = {},
  now: Date = new Date(),
): LogEntry {
  return {
    time: now.toISOString(),
    level,
    event: normalizeEvent(event),
    release: getReleaseInfo().release,
    ...redactFields(fields),
  };
}

export function formatLogEntry(
  level: LogLevel,
  event: string,
  fields: LogFields = {},
  now: Date = new Date(),
): string {
  return JSON.stringify(buildLogEntry(level, event, fields, now));
}

export function logEvent(level: LogLevel, event: string, fields: LogFields = {}): void {
  const line = formatLogEntry(level, event, fields);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (event: string, fields?: LogFields) => logEvent("debug", event, fields),
  info: (event: string, fields?: LogFields) => logEvent("info", event, fields),
  warn: (event: string, fields?: LogFields) => logEvent("warn", event, fields),
  error: (event: string, fields?: LogFields) => logEvent("error", event, fields),
};

/** Re-exported for callers that scrub a value outside a log line. */
export { scrubValue };
