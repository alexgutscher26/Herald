/**
 * Run the automated backup verification by hand.
 *
 * Usage: `bun run backups:verify`
 *
 * This is the same check the daily `verify_backups` job runs: it inventories
 * storage, re-reads a sample of attachments, records the database inventory,
 * and writes and verifies a manifest. It is a freshness and integrity check,
 * not a provider point-in-time restore. A green result here does not replace
 * the PITR drill in docs/operations.md.
 */

import { runBackupVerification } from "@/features/observability/backups";

try {
  const result = await runBackupVerification();
  console.log("Backup verification passed.");
  console.log(JSON.stringify(result, null, 2));
  console.log(
    "This checks database inventory, storage and manifest integrity. It does not exercise the hosting provider's PITR restore path.",
  );
} catch (error) {
  console.error(
    "Backup verification failed:",
    error instanceof Error ? error.message : "unknown error",
  );
  process.exit(1);
}
