import { describe, expect, test } from "bun:test";

import { nextAttemptAt } from "@/features/jobs/backoff";

const now = new Date("2026-01-01T00:00:00.000Z");

describe("nextAttemptAt", () => {
  test("starts at 30 seconds and doubles per attempt", () => {
    expect(nextAttemptAt(1, now).toISOString()).toBe("2026-01-01T00:00:30.000Z");
    expect(nextAttemptAt(2, now).toISOString()).toBe("2026-01-01T00:01:00.000Z");
    expect(nextAttemptAt(3, now).toISOString()).toBe("2026-01-01T00:02:00.000Z");
    expect(nextAttemptAt(4, now).toISOString()).toBe("2026-01-01T00:04:00.000Z");
  });

  test("treats zero attempts like the first attempt", () => {
    expect(nextAttemptAt(0, now).toISOString()).toBe("2026-01-01T00:00:30.000Z");
  });

  test("caps the delay at one hour", () => {
    expect(nextAttemptAt(20, now).toISOString()).toBe("2026-01-01T01:00:00.000Z");
  });
});
