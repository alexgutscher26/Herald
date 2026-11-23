import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Nothing durable is an inline image payload.
 *
 * Uploaded bytes belong to the storage module, and every image the product
 * persists is a key or a URL. These checks fail if an editor or composer starts
 * turning a file into a `data:` URL again, or if a write contract begins to
 * accept one.
 */

const SRC = path.join(process.cwd(), "src");

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(full));
    else if (/\.(?:ts|tsx|mts|cts)$/.test(entry.name)) files.push(full);
  }
  return files;
}

function matching(pattern: RegExp): string[] {
  return sourceFiles(SRC)
    .filter((file) => pattern.test(readFileSync(file, "utf8")))
    .map((file) => path.relative(process.cwd(), file));
}

describe("no inline image persistence", () => {
  test("no module reads a file into a base64 data: URL", () => {
    expect(matching(/readAsDataURL/)).toEqual([]);
  });

  test("no schema accepts a data: image", () => {
    expect(matching(/startsWith\(\s*["']data:/)).toEqual([]);
  });

  test("attachment rows record storage keys, not payloads", () => {
    const schema = readFileSync(path.join(SRC, "db/schema/feedback-extensions.ts"), "utf8");
    expect(schema).toContain('storageKey: text("storage_key")');
    expect(schema).not.toMatch(/dataUrl/i);
  });
});
