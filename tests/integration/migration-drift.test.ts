import { describe, expect, test } from "bun:test";

import { execFileSync, spawnSync } from "node:child_process";

/**
 * Fresh install vs upgrade must agree.
 *
 * `scripts/migration-drift.ts` builds two disposable databases: one from every
 * migration in the journal (the install path) and one from the previous
 * release tag plus everything added since (the upgrade path). It compares
 * columns, indexes, constraints and enum labels.
 *
 * The baseline comes from git, so a checkout without tags cannot run it. That
 * is reported as a skip here; CI sets MIGRATION_REQUIRE_BASELINE=1 and runs the
 * script directly, where a missing baseline is a failure rather than a skip.
 */

function hasReleaseTag(): boolean {
  try {
    return (
      execFileSync("git", ["describe", "--tags", "--abbrev=0", "HEAD"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim().length > 0
    );
  } catch {
    return false;
  }
}

const baselineAvailable =
  hasReleaseTag() ||
  Boolean(process.env.MIGRATION_BASELINE_TAG) ||
  Boolean(process.env.MIGRATION_BASELINE_DIR);

describe.skipIf(!baselineAvailable)("migration drift", () => {
  test(
    "a from-zero build and an upgrade from the previous release have the same schema",
    () => {
      const result = spawnSync("bun", ["scripts/migration-drift.ts"], {
        encoding: "utf8",
        env: { ...process.env, MIGRATION_REQUIRE_BASELINE: "1" },
        timeout: 180_000,
      });

      if (result.status !== 0) {
        throw new Error(
          `migration-drift failed with ${result.status}\n${result.stdout}\n${result.stderr}`,
        );
      }

      const output = JSON.parse(result.stdout) as { drift: number; baselineTag: string };
      expect(output.drift).toBe(0);
      expect(output.baselineTag.length).toBeGreaterThan(0);
    },
    200_000,
  );
});
