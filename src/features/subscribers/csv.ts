import { parseCsv } from "@/features/import/csv";
import { isValidEmail, normalizeEmail } from "@/lib/email";

/**
 * Subscriber CSV transport.
 *
 * The same parser serves the browser preview and the server import. Only a
 * fixed set of columns is understood; unknown columns are ignored rather than
 * guessed at, so an export from another product cannot silently overwrite a
 * field the user did not intend to change.
 */

export const SUBSCRIBER_STATUSES = ["pending", "active", "unsubscribed"] as const;
export const SUBSCRIBER_SOURCES = [
  "widget",
  "import",
  "api",
  "manual",
  "follower",
] as const;

export type SubscriberCsvStatus = (typeof SUBSCRIBER_STATUSES)[number];
export type SubscriberCsvSource = (typeof SUBSCRIBER_SOURCES)[number];

export type SubscriberImportRow = {
  email: string;
  emailNormalized: string;
  name: string | null;
  status: SubscriberCsvStatus;
  source: SubscriberCsvSource;
};

export type SubscriberCsvParseResult = {
  rows: SubscriberImportRow[];
  invalidRows: number;
  totalRows: number;
};

const EMAIL_HEADERS = ["email", "e-mail", "email address", "address"];
const NAME_HEADERS = ["name", "full name", "customer name"];
const STATUS_HEADERS = ["status", "subscription status"];
const SOURCE_HEADERS = ["source"];

function headerIndex(headers: string[], candidates: string[]): number {
  const lower = headers.map((header) => header.trim().toLowerCase());
  for (const candidate of candidates) {
    const index = lower.indexOf(candidate);
    if (index >= 0) return index;
  }
  return -1;
}

function valueAt(cells: string[], index: number): string {
  return index >= 0 ? (cells[index] ?? "").trim() : "";
}

function asStatus(value: string): SubscriberCsvStatus | null {
  if (value === "") return "active";
  return (SUBSCRIBER_STATUSES as readonly string[]).includes(value)
    ? (value as SubscriberCsvStatus)
    : null;
}

function asSource(value: string): SubscriberCsvSource | null {
  if (value === "") return "import";
  return (SUBSCRIBER_SOURCES as readonly string[]).includes(value)
    ? (value as SubscriberCsvSource)
    : null;
}

/**
 * Parse a subscriber file.
 *
 * Invalid addresses and unknown enum values are counted and skipped instead of
 * aborting the whole import: one broken row in a 2,000-contact export should
 * not block the other 1,999. Duplicate addresses keep the last row, which makes
 * re-importing a corrected file predictable.
 */
export function parseSubscriberCsv(input: string): SubscriberCsvParseResult {
  const parsed = parseCsv(input);
  const emailIndex = headerIndex(parsed.headers, EMAIL_HEADERS);
  if (emailIndex < 0) {
    throw new Error("The file needs an email column.");
  }

  const nameIndex = headerIndex(parsed.headers, NAME_HEADERS);
  const statusIndex = headerIndex(parsed.headers, STATUS_HEADERS);
  const sourceIndex = headerIndex(parsed.headers, SOURCE_HEADERS);

  const byEmail = new Map<string, SubscriberImportRow>();
  let invalidRows = 0;

  for (const cells of parsed.rows) {
    const email = valueAt(cells, emailIndex);
    const normalized = normalizeEmail(email);
    const status = asStatus(valueAt(cells, statusIndex).toLowerCase());
    const source = asSource(valueAt(cells, sourceIndex).toLowerCase());

    if (!isValidEmail(email) || normalized === "" || status === null || source === null) {
      invalidRows += 1;
      continue;
    }

    const name = valueAt(cells, nameIndex).slice(0, 120) || null;
    byEmail.set(normalized, {
      email: email.slice(0, 254),
      emailNormalized: normalized,
      name,
      status,
      source,
    });
  }

  return {
    rows: [...byEmail.values()],
    invalidRows,
    totalRows: parsed.rows.length,
  };
}

function csvCell(value: string | null): string {
  const text = value ?? "";
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

export function toSubscriberCsv(
  rows: {
    email: string;
    name: string | null;
    status: string;
    source: string;
    createdAt: string | Date;
    unsubscribedAt: string | Date | null;
  }[],
): string {
  const lines = [
    ["email", "name", "status", "source", "created_at", "unsubscribed_at"].join(","),
  ];

  for (const row of rows) {
    lines.push(
      [
        csvCell(row.email),
        csvCell(row.name),
        csvCell(row.status),
        csvCell(row.source),
        csvCell(new Date(row.createdAt).toISOString()),
        csvCell(row.unsubscribedAt ? new Date(row.unsubscribedAt).toISOString() : null),
      ].join(","),
    );
  }

  return `${lines.join("\n")}\n`;
}
