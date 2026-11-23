import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * The storage module is the only writer of bytes on disk.
 *
 * `src/features/storage/local.ts` owns the filesystem so that upload rules,
 * key generation and object metadata all live in one place. A `node:fs` import
 * anywhere else in `src/` means a second writer exists — a cache file, a temp
 * dump, a migration shortcut — and the storage guarantees stop being true.
 */

const SRC = path.join(process.cwd(), "src");
const STORAGE_DIR = path.join(SRC, "features", "storage");

const FS_IMPORT = /from\s+["'](?:node:fs|fs)(?:\/promises)?["']/;
const FS_WRITE_CALL =
  /\b(?:writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|copyFile|rename|truncate|ftruncate|mkdtemp)\s*\(/;

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(full));
    else if (/\.(?:ts|tsx|mts|cts)$/.test(entry.name)) files.push(full);
  }
  return files;
}

const files = sourceFiles(SRC).filter(
  (file) => !file.startsWith(`${STORAGE_DIR}${path.sep}`),
);

function matches(pattern: RegExp): string[] {
  return files
    .filter((file) => pattern.test(readFileSync(file, "utf8")))
    .map((file) => path.relative(process.cwd(), file));
}

describe("disk writes stay inside the storage module", () => {
  test("no other module imports node:fs", () => {
    expect(matches(FS_IMPORT)).toEqual([]);
  });

  test("no other module calls a filesystem write", () => {
    expect(matches(FS_WRITE_CALL)).toEqual([]);
  });

  test("the storage module still owns the write", () => {
    const local = readFileSync(path.join(STORAGE_DIR, "local.ts"), "utf8");
    expect(local).toMatch(FS_IMPORT);
    expect(local).toContain("writeFile");
  });
});
