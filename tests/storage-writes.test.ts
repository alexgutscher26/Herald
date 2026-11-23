import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * The storage module is the only writer of bytes on disk.
 *
 * `src/features/storage/local.ts` owns the filesystem so that upload rules,
 * key generation and object metadata all live in one place. A filesystem write
 * anywhere else in `src/` means a second writer exists — a cache file, a temp
 * dump, a migration shortcut — and the storage guarantees stop being true.
 *
 * Reads are a different matter and deliberately allowed: the public docs are
 * read from `docs/` at build time, and observability reads build chunks to
 * resolve source-map debug ids. What must not happen is a module outside
 * `src/features/storage` importing a write API, calling one, or taking an
 * unqualified handle on the module (`import fs from "node:fs"`), which would
 * hide the usage from both checks below.
 */

const SRC = path.join(process.cwd(), "src");
const STORAGE_DIR = path.join(SRC, "features", "storage");

const FS_MODULE = String.raw`(?:node:fs|fs)(?:\/promises)?`;
const FS_IMPORT = new RegExp(String.raw`import\s+([^;]*?)\s+from\s+["']${FS_MODULE}["']`, "g");
// Bare names that also occur in prose (`Copy link (`) or in unrelated APIs
// (`clipboard.write(`) are only checked when namespace-qualified. The import
// check above already catches a named import of any of these.
const FS_WRITE_CALL =
  /\b(?:fs|fsp|fsPromises)\.(?:write|writeSync|writev|writevSync|link|linkSync|cp|cpSync|rm|rmSync|mkdir|mkdirSync|opendir)\s*\(|\b(?:writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|copyFile|copyFileSync|rename|renameSync|truncate|truncateSync|ftruncate|ftruncateSync|mkdtemp|mkdtempSync|unlink|unlinkSync|rmdir|rmdirSync|chmod|chmodSync|chown|chownSync|lchmod|lchown|symlink|symlinkSync|utimes|utimesSync)\s*\(/;

/** Namespace or default imports cannot be audited from the import alone. */
const UNSAFE_HANDLE = /^(?:\*\s+as\s+\w+|\w+)$/;

const WRITE_APIS = new Set([
  "writeFile",
  "writeFileSync",
  "appendFile",
  "appendFileSync",
  "createWriteStream",
  "copyFile",
  "copyFileSync",
  "rename",
  "renameSync",
  "truncate",
  "truncateSync",
  "ftruncate",
  "ftruncateSync",
  "mkdtemp",
  "mkdtempSync",
  "mkdir",
  "mkdirSync",
  "rm",
  "rmSync",
  "rmdir",
  "rmdirSync",
  "unlink",
  "unlinkSync",
  "chmod",
  "chmodSync",
  "chown",
  "chownSync",
  "lchmod",
  "lchown",
  "symlink",
  "symlinkSync",
  "link",
  "linkSync",
  "cp",
  "cpSync",
  "utimes",
  "utimesSync",
  "write",
  "writeSync",
  "writev",
  "writevSync",
]);

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

/** The names imported from a filesystem module, or `null` for a bare handle. */
function importedFsNames(clause: string): string[] | null {
  const braces = /\{([^}]*)\}/.exec(clause);
  if (braces) {
    return (braces[1] ?? "")
      .split(",")
      .map((part) => part.trim().split(/\s+as\s+/)[0]?.trim() ?? "")
      .filter(Boolean);
  }
  return UNSAFE_HANDLE.test(clause.trim()) ? null : [];
}

function writeImports(): string[] {
  const offenders: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(FS_IMPORT)) {
      const names = importedFsNames(match[1] ?? "");
      // A default/namespace import hides which functions are used; the call
      // scan below still catches direct writes, but a handle itself is a
      // second writer waiting to happen.
      if (names === null || names.some((name) => WRITE_APIS.has(name))) {
        offenders.push(path.relative(process.cwd(), file));
        break;
      }
    }
  }
  return offenders;
}

describe("disk writes stay inside the storage module", () => {
  test("no other module imports a filesystem write API", () => {
    expect(writeImports()).toEqual([]);
  });

  test("no other module calls a filesystem write", () => {
    expect(matches(FS_WRITE_CALL)).toEqual([]);
  });

  test("the storage module still owns the write", () => {
    const local = readFileSync(path.join(STORAGE_DIR, "local.ts"), "utf8");
    expect(local).toMatch(/from\s+["'](?:node:fs|fs)(?:\/promises)?["']/);
    expect(local).toContain("writeFile");
  });
});
