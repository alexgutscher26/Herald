import { slugify } from "@/lib/slug";

/**
 * Pure import parsers for the help center.
 *
 * Both formats return the same item shape so the importer has one validation
 * and one database path. Markdown is a single article with optional front
 * matter; CSV can carry many articles. No HTML is trusted: it is stored as
 * Markdown/text and rendered through react-markdown, which does not execute
 * embedded HTML.
 */

export type HelpImportItem = {
  title: string;
  slug: string;
  body: string;
  collection: string;
  visibility: "public" | "internal";
};

function safeSlug(value: string, fallback: string): string {
  return slugify(value.trim() || fallback).slice(0, 80) || "article";
}

function readFrontMatter(input: string): { meta: Record<string, string>; body: string } {
  const normalized = input.replace(/\r\n?/g, "\n");
  if (!normalized.startsWith("---\n")) return { meta: {}, body: normalized };

  const end = normalized.indexOf("\n---", 4);
  if (end === -1) return { meta: {}, body: normalized };

  const meta: Record<string, string> = {};
  for (const line of normalized.slice(4, end).split("\n")) {
    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line.trim());
    if (!match?.[1]) continue;
    meta[match[1].toLowerCase()] = (match[2] ?? "").replace(/^["']|["']$/g, "").trim();
  }

  return { meta, body: normalized.slice(end + 4).replace(/^\n/, "") };
}

export function parseMarkdownImport(input: {
  content: string;
  filename?: string;
  defaultCollection?: string;
}): HelpImportItem {
  const { meta, body } = readFrontMatter(input.content);
  const heading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
  const fallbackTitle =
    meta.title ||
    heading ||
    input.filename?.replace(/\.(md|markdown|txt)$/i, "").replace(/[-_]+/g, " ") ||
    "Imported article";

  const withoutHeading = heading
    ? body.replace(/^#\s+.+\n?/m, "").trim()
    : body.trim();

  if (withoutHeading.length === 0) {
    throw new Error("The Markdown document has no article body.");
  }

  return {
    title: fallbackTitle.slice(0, 200),
    slug: safeSlug(meta.slug ?? fallbackTitle, "imported-article"),
    body: withoutHeading.slice(0, 500_000),
    collection: (meta.collection || input.defaultCollection || "Help center").slice(0, 120),
    visibility: meta.visibility === "internal" ? "internal" : "public",
  };
}

/** RFC 4180-ish CSV parser: quoted commas, escaped quotes and embedded newlines. */
export function parseCsvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function parseCsvImport(input: {
  content: string;
  defaultCollection?: string;
}): HelpImportItem[] {
  const rows = parseCsvRows(input.content).filter((row) =>
    row.some((cell) => cell.trim() !== ""),
  );
  const header = rows.shift();
  if (!header) throw new Error("The CSV file is empty.");

  const columns = new Map(
    header.map((name, index) => [name.trim().toLowerCase(), index]),
  );
  if (!columns.has("title") || (!columns.has("body") && !columns.has("content"))) {
    throw new Error("CSV needs title and body columns.");
  }

  const items: HelpImportItem[] = [];
  for (const row of rows) {
    const value = (key: string) => row[columns.get(key) ?? -1]?.trim() ?? "";
    const title = value("title");
    const body = value("body") || value("content");
    if (!title || !body) continue;
    items.push({
      title: title.slice(0, 200),
      slug: safeSlug(value("slug") || title, "imported-article"),
      body: body.slice(0, 500_000),
      collection: (value("collection") || input.defaultCollection || "Help center").slice(
        0,
        120,
      ),
      visibility: value("visibility") === "internal" ? "internal" : "public",
    });
  }

  if (items.length === 0) throw new Error("The CSV had no articles with a title and body.");
  return items;
}
