import { describe, expect, test } from "bun:test";

import { jobTypeEnum } from "@/db/schema/jobs";

/**
 * The `job_type` enum and the handler map must not drift.
 *
 * `handlers.ts` imports `server-only` and the whole server feature graph, so
 * importing it inside the unit runner throws ("This module cannot be imported
 * from a Client Component module"). The check therefore runs in a short-lived
 * bun process started with the same `react-server` condition the app uses, so
 * it calls the real `getJobHandler` for every enum value instead of pattern
 * matching the source. It needs no database: enqueueing is what touches one.
 */
describe("job handler coverage", () => {
  test("getJobHandler resolves every jobTypeEnum value", () => {
    const script = [
      'import { jobTypeEnum } from "@/db/schema/jobs";',
      'import { getJobHandler } from "@/features/jobs/handlers";',
      "const missing = jobTypeEnum.enumValues.filter((type) => !getJobHandler(type));",
      "if (missing.length > 0) {",
      '  console.error("No handler registered for: " + missing.join(", "));',
      "  process.exit(1);",
      "}",
      "console.log(String(jobTypeEnum.enumValues.length));",
    ].join("\n");

    const result = Bun.spawnSync({
      cmd: [process.execPath, "--conditions=react-server", "-e", script],
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = result.stdout.toString().trim();
    const stderr = result.stderr.toString().trim();

    // The child prints its count on success, which proves it evaluated the map
    // rather than exiting early. A non-zero exit carries the missing types.
    expect({ exitCode: result.exitCode, stdout, stderr }).toEqual({
      exitCode: 0,
      stdout: String(jobTypeEnum.enumValues.length),
      stderr: "",
    });
    expect(jobTypeEnum.enumValues.length).toBeGreaterThan(0);
  });
});
