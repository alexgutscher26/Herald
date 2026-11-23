import { describe, expect, test } from "bun:test";

import {
  DEFAULT_POOL_MAX,
  MAX_POOL_MAX,
  POOL_APPLICATION_NAME,
  POOL_CONNECTION_TIMEOUT_MS,
  POOL_IDLE_TIMEOUT_MS,
  poolSettings,
  readPoolMax,
} from "@/db/pool-settings";

describe("database pool settings", () => {
  test("defaults to a small per-instance pool", () => {
    expect(readPoolMax({})).toBe(DEFAULT_POOL_MAX);
    expect(poolSettings({})).toEqual({
      max: DEFAULT_POOL_MAX,
      idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS,
      connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT_MS,
      application_name: POOL_APPLICATION_NAME,
    });
  });

  test("reads DATABASE_POOL_MAX within a safe range", () => {
    expect(readPoolMax({ DATABASE_POOL_MAX: "4" })).toBe(4);
    expect(readPoolMax({ DATABASE_POOL_MAX: " 12 " })).toBe(12);
    expect(readPoolMax({ DATABASE_POOL_MAX: "0" })).toBe(1);
    expect(readPoolMax({ DATABASE_POOL_MAX: "-5" })).toBe(1);
    expect(readPoolMax({ DATABASE_POOL_MAX: "500" })).toBe(MAX_POOL_MAX);
  });

  test("ignores malformed and empty values instead of guessing", () => {
    expect(readPoolMax({ DATABASE_POOL_MAX: "ten" })).toBe(DEFAULT_POOL_MAX);
    expect(readPoolMax({ DATABASE_POOL_MAX: "" })).toBe(DEFAULT_POOL_MAX);
    expect(readPoolMax({ DATABASE_POOL_MAX: "2.9" })).toBe(2);
  });
});
