import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  SETUP_TIMEOUT_MS,
  applyMigrationsAgain,
  setupTestDatabase,
  teardownTestDatabase,
  testDatabaseInfo,
} from "./harness";

/**
 * The harness is the safety net for every other integration test, so its own
 * assumptions are tested: a disposable database is created, every committed
 * migration is applied, and a second run is a no-op.
 */

beforeAll(async () => {
  await setupTestDatabase();
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await teardownTestDatabase();
}, SETUP_TIMEOUT_MS);

describe("disposable test database", () => {
  test("is uniquely named and fully migrated", async () => {
    const info = testDatabaseInfo();
    expect(info.name.startsWith("herald_test_")).toBe(true);
    expect(info.migrationTags.length).toBeGreaterThanOrEqual(6);
    expect(info.migrationTags).toContain("0000_chubby_wonder_man");
    expect(info.migrationTags).toContain("0005_open_magma");
  }, 30_000);

  test("re-applying the journal applies nothing", async () => {
    expect(await applyMigrationsAgain()).toBe(0);
  }, 30_000);
});
