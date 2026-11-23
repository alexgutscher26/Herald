import { describe, expect, test } from "bun:test";

import {
  buildLogEntry,
  formatLogEntry,
  normalizeEvent,
  redactFields,
  serializeError,
} from "@/lib/logger";
import {
  REQUEST_ID_HEADER,
  requestIdFor,
  requestIdFromHeaders,
  sanitizeRequestId,
} from "@/lib/request-context";

const UUID = "6f1fbb18-3a8f-4f0f-9a37-2f2b5b1b6f6e";

describe("request ids", () => {
  test("accepts a UUID and other proxy-safe tokens", () => {
    expect(sanitizeRequestId(UUID)).toBe(UUID);
    expect(sanitizeRequestId("req_01JABCDEF234")).toBe("req_01JABCDEF234");
    expect(sanitizeRequestId("  trace-abc.123  ")).toBe("trace-abc.123");
  });

  test("rejects values that could break a log line or a header", () => {
    expect(sanitizeRequestId(null)).toBeNull();
    expect(sanitizeRequestId(undefined)).toBeNull();
    expect(sanitizeRequestId("short")).toBeNull();
    expect(sanitizeRequestId("has space in it")).toBeNull();
    expect(sanitizeRequestId("path/traversal")).toBeNull();
    expect(sanitizeRequestId("line\nbreak")).toBeNull();
    expect(sanitizeRequestId("quote\"break")).toBeNull();
    expect(sanitizeRequestId("x".repeat(129))).toBeNull();
  });

  test("prefers an inbound id and generates one otherwise", () => {
    const withHeader = new Request("http://localhost/api/health", {
      headers: { [REQUEST_ID_HEADER]: "upstream-trace-1" },
    });
    expect(requestIdFor(withHeader)).toBe("upstream-trace-1");

    const withoutHeader = new Request("http://localhost/api/health");
    const generated = requestIdFor(withoutHeader);
    expect(sanitizeRequestId(generated)).toBe(generated);
  });

  test("ignores an unsafe inbound id instead of echoing it", () => {
    const unsafe = "../../etc/passwd?x=1";
    const request = new Request("http://localhost/api/health", {
      headers: { [REQUEST_ID_HEADER]: unsafe },
    });
    const id = requestIdFor(request);
    expect(id).not.toBe(unsafe);
    expect(sanitizeRequestId(id)).toBe(id);
  });

  test("reads the same header from a plain Headers object", () => {
    const headers = new Headers({ [REQUEST_ID_HEADER]: "suite-request-42" });
    expect(requestIdFromHeaders(headers)).toBe("suite-request-42");
  });
});

describe("structured logs", () => {
  test("normalises event names to a single line", () => {
    expect(normalizeEvent(" job.run\n")).toBe("job.run");
    expect(normalizeEvent("\t\n")).toBe("unknown");
    expect(normalizeEvent("x".repeat(500))).toHaveLength(120);
  });

  test("builds one entry with time, level and event first", () => {
    const entry = buildLogEntry("info", "job.run", { claimed: 2 }, new Date(0));
    expect(entry.time).toBe("1970-01-01T00:00:00.000Z");
    expect(entry.level).toBe("info");
    expect(entry.event).toBe("job.run");
    expect(entry.claimed).toBe(2);
  });

  test("redacts credential-looking keys at the top level and nested", () => {
    const redacted = redactFields({
      email: "person@example.com",
      password: "hunter2",
      apiKey: "sk_live_123",
      nested: { authorization: "Bearer abc", token: "t" },
      headers: [{ cookie: "session=abc" }],
    });

    expect(redacted.email).toBe("[redacted]");
    expect(redacted.password).toBe("[redacted]");
    expect(redacted.apiKey).toBe("[redacted]");
    expect(redacted.nested).toEqual({
      authorization: "[redacted]",
      token: "[redacted]",
    });
    expect(redacted.headers).toEqual([{ cookie: "[redacted]" }]);
  });

  test("never prints a secret through an error message", () => {
    const error = new Error("request failed with token abc123");
    const serialized = serializeError(error);
    expect(serialized.name).toBe("Error");
    expect(serialized.message.length).toBeGreaterThan(0);
    expect(redactFields({ error: serialized }).error).toEqual(serialized);
  });

  test("truncates long values and deep structures", () => {
    const redacted = redactFields({
      body: "x".repeat(2_000),
      deep: { a: { b: { c: { d: "too deep" } } } },
      many: Array.from({ length: 30 }, (_, index) => `item-${index}`),
    });

    expect((redacted.body as string).length).toBe(500);
    expect(redacted.deep).toEqual({ a: { b: "[truncated]" } });
    expect((redacted.many as string[]).length).toBe(20);
  });

  test("formats exactly one line of JSON", () => {
    const line = formatLogEntry("error", "cron.jobs.failed", {
      error: new Error("boom"),
    });
    expect(line.includes("\n")).toBe(false);
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed.level).toBe("error");
    expect(parsed.event).toBe("cron.jobs.failed");
    expect((parsed.error as { message: string }).message).toBe("boom");
  });
});
