/**
 * Shared import vocabulary.
 *
 * Pure and framework-free so the mapping UI, the CSV parser, the adapters and
 * the server job all agree on one list of fields. Nothing here reads the
 * database or a request.
 */

export const IMPORT_FORMATS = [
  "generic",
  "canny",
  "productboard",
  "nolt",
  "frill",
  "beamer",
] as const;
export type ImportFormat = (typeof IMPORT_FORMATS)[number];

export const IMPORT_FORMAT_LABELS: Record<ImportFormat, string> = {
  generic: "Generic CSV",
  canny: "Canny export",
  productboard: "Productboard export",
  nolt: "Nolt export",
  frill: "Frill export",
  beamer: "Beamer export",
};

export const IMPORT_SOURCES = ["csv", "github", "herald"] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

export const IMPORT_SOURCE_LABELS: Record<ImportSource, string> = {
  csv: "CSV file",
  github: "GitHub Issues",
  herald: "Herald API",
};

export const IMPORT_FIELDS = [
  "title",
  "body",
  "board",
  "status",
  "category",
  "authorName",
  "authorEmail",
  "votes",
  "createdAt",
  "imageUrl",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  title: "Title",
  body: "Details",
  board: "Board",
  status: "Status",
  category: "Type",
  authorName: "Author name",
  authorEmail: "Author email",
  votes: "Votes",
  createdAt: "Created date",
  imageUrl: "Cover image URL",
};

export const IMPORT_FIELD_HINTS: Record<ImportField, string> = {
  title: "Required. Rows without a title are reported as failed.",
  body: "Optional. The request body; empty rows import with no details.",
  board: "Optional. A board name or URL slug in this product; otherwise the target board is used.",
  status: "Optional. Unknown words import as Open and keep the original in the report.",
  category: "Optional. Feature request, bug, improvement or question.",
  authorName: "Optional. Shown on the public request.",
  authorEmail: "Optional. Reuses an existing customer with that address or creates one.",
  votes: "Optional. Preserved as an imported vote total.",
  createdAt: "Optional. ISO dates or anything the server can parse.",
  imageUrl:
    "Optional. A public https image URL, fetched once and stored; private and loopback addresses are refused.",
};

/** Import field → source column header. */
export type ImportMapping = Partial<Record<ImportField, string>>;

export type ImportRowData = Partial<Record<ImportField, string>>;

export type ParsedCsv = {
  headers: string[];
  rows: string[][];
  /** The delimiter that produced the widest consistent table. */
  delimiter: "," | ";" | "\t";
};

/** Bump when a preset's stored mapping shape changes. */
export const IMPORT_PRESET_VERSION = 1;

export function presetSignature(headers: string[]): string {
  return headers.map(headerKey).sort().join("|");
}

export const MAX_IMPORT_BYTES = 8 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 20_000;

export function isImportFormat(value: unknown): value is ImportFormat {
  return typeof value === "string" && (IMPORT_FORMATS as readonly string[]).includes(value);
}

/** Normalize a header for matching: lowercase, letters and digits only. */
export function headerKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** Empty and whitespace-only values count as absent, not as `""`. */
export function cleanCell(value: string | undefined): string {
  return (value ?? "").trim();
}

/**
 * Turn a parsed row into the import vocabulary.
 *
 * One header may only feed one field in the UI; if the mapping repeats a header
 * the first field wins so a row cannot be counted twice.
 */
export function rowToData(
  headers: string[],
  row: string[],
  mapping: ImportMapping,
): ImportRowData {
  const indexes = new Map<string, number>();
  headers.forEach((header, index) => {
    if (!indexes.has(header)) indexes.set(header, index);
  });

  const data: ImportRowData = {};
  const used = new Set<string>();

  for (const field of IMPORT_FIELDS) {
    const header = mapping[field];
    if (!header || used.has(header)) continue;
    const index = indexes.get(header);
    if (index === undefined) continue;

    const value = cleanCell(row[index]);
    if (value !== "") {
      data[field] = value;
      used.add(header);
    }
  }

  return data;
}
