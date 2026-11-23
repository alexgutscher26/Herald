import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readFile, readdir, rm, statfs, writeFile } from "node:fs/promises";
import path from "node:path";

import { isSafeStorageKey } from "./limits";
import type {
  PutObjectInput,
  StorageHealth,
  StorageProvider,
  StoredObject,
  StoredObjectWithBody,
} from "./types";

/**
 * Local filesystem driver.
 *
 * Suitable for development and single-node deployments; a serverless host
 * needs a cloud driver because its filesystem is ephemeral. Objects are
 * content-addressed by checksum metadata and verified on every read.
 */
export class LocalStorageProvider implements StorageProvider {
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private resolveKey(key: string): string {
    if (!isSafeStorageKey(key)) throw new Error("Invalid storage key.");
    const full = path.resolve(this.root, key);
    if (full !== this.root && !full.startsWith(`${this.root}${path.sep}`)) {
      throw new Error("Storage key escapes the storage root.");
    }
    return full;
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    const full = this.resolveKey(input.key);
    await mkdir(path.dirname(full), { recursive: true });

    const checksum = createHash("sha256").update(input.body).digest("hex");
    const object: StoredObject = {
      key: input.key,
      fileName: input.fileName,
      contentType: input.contentType,
      byteSize: input.body.byteLength,
      checksum,
      createdAt: new Date().toISOString(),
    };

    try {
      await writeFile(full, input.body, { flag: "wx" });
      await writeFile(`${full}.meta.json`, JSON.stringify(object), { flag: "wx" });
    } catch (error) {
      await rm(full, { force: true });
      await rm(`${full}.meta.json`, { force: true });
      throw error;
    }

    return object;
  }

  async get(key: string): Promise<StoredObjectWithBody | null> {
    const full = this.resolveKey(key);

    let meta: string;
    let body: Buffer;
    try {
      [meta, body] = await Promise.all([readFile(`${full}.meta.json`, "utf8"), readFile(full)]);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }

    const object = JSON.parse(meta) as StoredObject;
    if (object.key !== key) throw new Error("Storage metadata does not match the key.");
    if (object.byteSize !== body.byteLength) throw new Error("Stored object is truncated.");

    const checksum = createHash("sha256").update(body).digest("hex");
    if (checksum !== object.checksum) throw new Error("Stored object failed its checksum.");

    return { object, body };
  }

  async delete(key: string): Promise<void> {
    const full = this.resolveKey(key);
    await rm(full, { force: true });
    await rm(`${full}.meta.json`, { force: true });
  }

  /**
   * Walk the storage root and return the metadata records.
   *
   * Symlinks are not followed (a `Dirent` for a link is neither a directory nor
   * a regular file here), and a malformed sidecar is skipped rather than making
   * the whole inventory fail.
   */
  async list(prefix = ""): Promise<StoredObject[]> {
    const results: StoredObject[] = [];

    const walk = async (directory: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }

      for (const entry of entries) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
          continue;
        }
        if (!entry.isFile() || !entry.name.endsWith(".meta.json")) continue;

        try {
          const object = JSON.parse(await readFile(full, "utf8")) as StoredObject;
          if (!object.key.startsWith(prefix)) continue;
          if (!isSafeStorageKey(object.key)) continue;
          results.push(object);
        } catch {
          // A half-written sidecar is not a reason to fail a backup inventory.
        }
      }
    };

    await mkdir(this.root, { recursive: true });
    await walk(this.root);
    return results.sort((left, right) => left.key.localeCompare(right.key));
  }

  /**
   * Read/write probe.
   *
   * `access` alone can be fooled by a read-only mount, so this writes one
   * uniquely named byte and removes it. The probe key is not a storage object
   * and is never returned by `list`.
   */
  async health(): Promise<StorageHealth> {
    const startedAt = performance.now();
    try {
      await mkdir(this.root, { recursive: true });
      await access(this.root, constants.R_OK | constants.W_OK);

      const probe = path.join(this.root, `.health-${randomUUID()}.tmp`);
      await writeFile(probe, "ok", { flag: "wx" });
      await rm(probe, { force: true });

      let freeBytes: number | null = null;
      try {
        const stats = await statfs(this.root);
        freeBytes = Number(stats.bavail) * Number(stats.bsize);
      } catch {
        freeBytes = null;
      }

      return {
        ok: true,
        detail: `Storage probe passed in ${Math.max(1, Math.round(performance.now() - startedAt))} ms.`,
        freeBytes,
      };
    } catch {
      return { ok: false, detail: "Storage is not writable." };
    }
  }
}
