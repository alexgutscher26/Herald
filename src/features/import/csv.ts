import type { ParsedCsv } from "./types";

/**
 * CSV parsing and writing.
 *
 * The browser uses `parseCsv` to preview a file and suggest a mapping; the
 * server uses the same function again before copying rows into the database, so
 * the preview and the import cannot disagree. Quoted cells may contain the
 * delimiter, escaped quotes and newlines, which is what every export from
 * Canny, Productboard and Nolt actually does.
 */

const DELIMITERS = [",", ";", "\t"] as const;

function parseWith(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field.length === 0) {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char === "\r") {
      // CRLF: the LF branch above handles the line break. A lone CR is also a
      // line break, which some spreadsheet exports emit.
      if (text[index + 1] !== "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      }
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((line) => line.some((cell) => cell.trim() !== ""));
}

/** A file may repeat a heading; give each one a distinct name for mapping. */
function dedupeHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((header, index) => {
    const base = header.replace(/^\uFEFF/, "").trim() || `Column ${index + 1}`;
    const count = (seen.get(base.toLowerCase()) ?? 0) + 1;
    seen.set(base.toLowerCase(), count);
    return count === 1 ? base : `${base} (${count})`;
  });
}

function score(table: string[][]): number {
  if (table.length === 0) return -1;
  const width = table[0]?.length ?? 0;
  if (width === 0) return -1;

  const sample = table.slice(0, 20);
  let consistent = 0;
  for (const row of sample) {
    if (row.length === width) consistent += 1;
  }

  return width * 10 + consistent + (table.length > 1 ? 5 : 0);
}

/**
 * Parse a CSV file, choosing the delimiter that produces the widest,
 * most consistent table. Throws a user-facing error for empty input.
 */
export function parseCsv(input: string): ParsedCsv {
  const text = input.replace(/^\uFEFF/, "");
  if (text.trim() === "") throw new Error("The file is empty.");

  let best: { delimiter: (typeof DELIMITERS)[number]; table: string[][]; score: number } | null =
    null;

  for (const delimiter of DELIMITERS) {
    const table = parseWith(text, delimiter);
    const value = score(table);
    if (!best || value > best.score) best = { delimiter, table, score: value };
  }

  const table = best?.table ?? [];
  const headerRow = table[0] ?? [];
  if (headerRow.length < 2) {
    throw new Error("The file does not look like a CSV with a header row.");
  }

  return {
    headers: dedupeHeaders(headerRow),
    rows: table.slice(1),
    delimiter: best?.delimiter ?? ",",
  };
}

function cell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  if (!/[",\n\r;]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

/** Serialize rows for a downloadable CSV. */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return `${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}
