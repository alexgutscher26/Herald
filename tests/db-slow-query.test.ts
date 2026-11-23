import { describe, expect, test } from "bun:test";

import {
  DEFAULT_SLOW_QUERY_ALERT_MS,
  DEFAULT_SLOW_QUERY_MS,
  SLOW_QUERY_LOG_INTERVAL_MS,
  SlowQueryThrottle,
  isSlowQuery,
  needsAlert,
  normalizeStatement,
  slowQuerySettings,
} from "@/db/slow-query";

describe("slow query classification", () => {
  test("defaults to 200 ms logging and 1 s alerting", () => {
    expect(slowQuerySettings({})).toEqual({
      slowMs: DEFAULT_SLOW_QUERY_MS,
      alertMs: DEFAULT_SLOW_QUERY_ALERT_MS,
    });
  });

  test("reads thresholds from the environment and clamps them", () => {
    expect(slowQuerySettings({ SLOW_QUERY_MS: "50" }).slowMs).toBe(50);
    expect(slowQuerySettings({ SLOW_QUERY_MS: "0" }).slowMs).toBe(1);
    expect(slowQuerySettings({ SLOW_QUERY_MS: "abc" }).slowMs).toBe(
      DEFAULT_SLOW_QUERY_MS,
    );
    // An alert threshold below the log threshold is raised to it.
    expect(
      slowQuerySettings({ SLOW_QUERY_MS: "500", SLOW_QUERY_ALERT_MS: "100" }),
    ).toEqual({ slowMs: 500, alertMs: 500 });
  });

  test("classifies at the threshold, not above it", () => {
    const settings = { slowMs: 200, alertMs: 1_000 };
    expect(isSlowQuery(199, settings)).toBe(false);
    expect(isSlowQuery(200, settings)).toBe(true);
    expect(needsAlert(999, settings)).toBe(false);
    expect(needsAlert(1_000, settings)).toBe(true);
  });

  test("normalises whitespace and truncates long statements", () => {
    expect(normalizeStatement("SELECT\n  *\n FROM  t")).toBe("SELECT * FROM t");
    expect(normalizeStatement(null)).toBe("[unknown statement]");
    const long = normalizeStatement(`SELECT ${"x".repeat(400)}`);
    expect(long.length).toBeLessThanOrEqual(301);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("slow query throttle", () => {
  test("logs a repeated statement once per interval", () => {
    const throttle = new SlowQueryThrottle();
    expect(throttle.shouldLog("SELECT 1", 1_000)).toBe(true);
    expect(throttle.shouldLog("SELECT 1", 1_000 + SLOW_QUERY_LOG_INTERVAL_MS - 1)).toBe(
      false,
    );
    expect(throttle.shouldLog("SELECT 1", 1_000 + SLOW_QUERY_LOG_INTERVAL_MS)).toBe(true);
    expect(throttle.shouldLog("SELECT 2", 1_000)).toBe(true);
    expect(throttle.size).toBe(2);
    throttle.clear();
    expect(throttle.size).toBe(0);
  });
});
