import { describe, expect, test } from "bun:test";

import {
  buildSentryEvent,
  parseStackFrames,
} from "@/lib/observability/sentry";

describe("Sentry-compatible events", () => {
  test("carry release, environment and correlation tags", () => {
    const event = buildSentryEvent({
      event: "http.route_failed",
      error: {
        name: "TypeError",
        message: "Cannot read properties of undefined",
        stack:
          "TypeError: Cannot read properties of undefined\n" +
          "    at handler (/app/src/features/x.ts:10:7)\n" +
          "    at process (/app/node_modules/next/dist/x.js:1:1)",
      },
      release: "2026.11.21",
      environment: "production",
      requestId: "req_01JABCDEF234",
      route: "/api/v1/requests",
      occurredAt: new Date("2026-11-21T12:00:00.000Z"),
    });

    expect(event.release).toBe("2026.11.21");
    expect(event.environment).toBe("production");
    expect(event.timestamp).toBe("2026-11-21T12:00:00.000Z");
    expect(event.tags.request_id).toBe("req_01JABCDEF234");
    expect(event.tags.route).toBe("/api/v1/requests");
    expect(event.fingerprint).toEqual(["http.route_failed", "TypeError"]);
    expect(event.event_id).toHaveLength(32);
    expect(event.exception.values[0]?.type).toBe("TypeError");
  });

  test("scrub messages, stack frames and tenant identifiers from extra", () => {
    const event = buildSentryEvent({
      event: "job.failed",
      error: {
        name: "Error",
        message: "send to person@example.com failed with Bearer sk_" + "live_abcdefgh",
        stack:
          'Error: send to person@example.com failed\n    at run (/app/src/x.ts:1:1)',
      },
      release: "dev",
      environment: "test",
      fields: {
        workspaceId: "11111111-1111-4111-8111-111111111111",
        productId: "22222222-2222-4222-8222-222222222222",
        email: "person@example.com",
        authorization: "Bearer sk_" + "live_abcdefgh",
        route: "/api/v1/requests?token=abc123",
      },
    });

    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("person@example.com");
    expect(serialized).not.toContain("sk_live");
    expect(serialized).not.toContain("11111111-1111-4111-8111-111111111111");
    expect(serialized).not.toContain("22222222-2222-4222-8222-222222222222");
    expect(event.extra.workspaceId).toBe("[redacted]");
    expect(event.extra.productId).toBe("[redacted]");
    expect(event.extra.authorization).toBe("[redacted]");
  });

  test("a stack is reduced to file/line/function, oldest frame first", () => {
    const frames = parseStackFrames(
      "Error: boom\n" +
        "    at inner (/app/src/inner.ts:12:4)\n" +
        "    at outer (/app/src/outer.ts:20:9)",
    );

    expect(frames).toHaveLength(2);
    expect(frames[0]?.filename).toBe("/app/src/outer.ts");
    expect(frames[0]?.function).toBe("outer");
    expect(frames[0]?.lineno).toBe(20);
    expect(frames[1]?.filename).toBe("/app/src/inner.ts");
    expect(frames[1]?.in_app).toBe(true);
  });

  test("a Windows build path becomes the uploaded server artifact name", () => {
    const frames = parseStackFrames(
      "Error: boom\n" +
        "    at t (C:\\app\\.next\\server\\chunks\\a_b._.js:2:6472)",
    );

    expect(frames[0]?.filename).toBe("app:///_next/server/chunks/a_b._.js");
    expect(frames[0]?.lineno).toBe(2);
    expect(frames[0]?.colno).toBe(6472);
  });

  test("an event without a stack still has a valid exception", () => {
    const event = buildSentryEvent({
      event: "config.invalid",
      error: { name: "Error", message: "missing DATABASE_URL" },
      release: "dev",
      environment: "test",
    });
    expect(event.exception.values[0]?.stacktrace).toBeUndefined();
    expect(event.tags.route).toBeUndefined();
  });
});
