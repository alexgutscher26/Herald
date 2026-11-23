/**
 * Backup manifest shape.
 *
 * Kept separate from the job so the manifest contract and its checksum can be
 * unit-tested without a database or a storage driver. A manifest is the
 * verifiable record that a backup pass actually saw the data it claims to.
 */

import { createHash } from "node:crypto";

export type BackupManifest = {
  version: 1;
  generatedAt: string;
  release: string;
  database: {
    migrations: number | null;
    bytes: number | null;
    counts: Record<string, number>;
  };
  storage: {
    objects: number;
    bytes: number;
    attachmentsChecked: number;
    attachmentsFailed: number;
  };
};

export function buildBackupManifest(input: {
  generatedAt: Date;
  release: string;
  migrations: number | null;
  databaseBytes: number | null;
  counts: Record<string, number>;
  objects: number;
  bytes: number;
  attachmentsChecked: number;
  attachmentsFailed: number;
}): BackupManifest {
  return {
    version: 1,
    generatedAt: input.generatedAt.toISOString(),
    release: input.release,
    database: {
      migrations: input.migrations,
      bytes: input.databaseBytes,
      counts: input.counts,
    },
    storage: {
      objects: input.objects,
      bytes: input.bytes,
      attachmentsChecked: input.attachmentsChecked,
      attachmentsFailed: input.attachmentsFailed,
    },
  };
}

export function manifestChecksum(body: Uint8Array): string {
  return createHash("sha256").update(body).digest("hex");
}
