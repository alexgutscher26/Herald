import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { parseMarkdownImport } from "@/features/help/import-parse";

/**
 * Herald's own help center is imported from `docs/help/*.md` by
 * `scripts/import-herald-help.ts`. A broken front matter block or a duplicate
 * slug would only surface when someone ran the import against a database, so
 * the source files are validated here instead.
 */

const directory = path.join(import.meta.dir, "..", "docs", "help");
const files = (await readdir(directory)).filter((name) => name.endsWith(".md")).sort();
const articles = await Promise.all(
  files.map(async (file) => ({
    file,
    item: parseMarkdownImport({
      content: await readFile(path.join(directory, file), "utf8"),
      filename: file,
    }),
  })),
);

describe("help center sources", () => {
  test("every article parses and carries a title, body and collection", () => {
    expect(articles.length).toBeGreaterThanOrEqual(8);
    for (const { file, item } of articles) {
      expect(item.title.length, file).toBeGreaterThan(0);
      expect(item.title.length, file).toBeLessThanOrEqual(200);
      expect(item.body.length, file).toBeGreaterThan(40);
      expect(item.body.length, file).toBeLessThanOrEqual(500_000);
      expect(item.collection.length, file).toBeGreaterThan(0);
      expect(item.slug, file).toMatch(/^[a-z0-9][a-z0-9-]{0,79}$/);
    }
  });

  test("collection and slug pairs are unique", () => {
    const keys = articles.map(({ item }) => `${item.collection}/${item.slug}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("the getting-started path and every migration guide are present", () => {
    const slugs = new Set(articles.map(({ item }) => item.slug));
    for (const slug of [
      "getting-started",
      "install-the-widget",
      "migrating-from-canny",
      "migrating-from-productboard",
      "migrating-from-nolt",
      "migrating-from-featurebase",
      "migrating-from-userjot",
      "using-the-api",
    ]) {
      expect(slugs.has(slug), slug).toBe(true);
    }
  });

  test("no article depends on a screenshot-only instruction", () => {
    // Help articles are published as Markdown; an image the importer does not
    // receive would render as a broken reference on the public portal.
    for (const { file, item } of articles) {
      expect(item.body.includes("](/"), file).toBe(false);
    }
  });
});
