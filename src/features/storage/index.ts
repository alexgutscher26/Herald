import "server-only";

import path from "node:path";

import { LocalStorageProvider } from "./local";
import type { StorageProvider } from "./types";

/**
 * Storage driver factory.
 *
 * `STORAGE_DIR` can point at a persistent volume. Without it, development uses
 * `.storage/` beside the project. Serverless deployments must provide a cloud
 * driver (the interface in `types.ts` is the seam) or a writable persistent
 * mount, because their default filesystem is ephemeral.
 */
let cached: StorageProvider | null = null;

export function getStorage(): StorageProvider {
  if (cached) return cached;

  const configured = process.env.STORAGE_DIR?.trim();
  const root = configured && configured.length > 0
    ? configured
    : path.join(process.cwd(), ".storage");

  cached = new LocalStorageProvider(root);
  return cached;
}
