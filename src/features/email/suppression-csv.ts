import { parseCsv } from "@/features/import/csv";
import { isValidEmail, normalizeEmail } from "@/lib/email";

/**
 * Suppression CSV transport.
 *
 * Exports use `email,reason,note,created_at`. Imports understand that shape and
 * a minimal `email`-only file. Unknown reasons fall back to `manual` and are
 * counted, rather than dropping a row an operator deliberately listed.
 */

export const SUPPRESSION_REASONS = [
  "hard_bounce",
  "complaint",
  "manual",
  "unsubscribe",
] as const;

export type SuppressionReasonValue = (typeof SUPPRESSION_REASONS)[number];

export type SuppressionImportRow = {
  email: string;
  emailNormalized: string;
  reason: SuppressionReasonValue;
  note: string | null;
};

export type SuppressionCsvParseResult = {
  rows: SuppressionImportRow[];
  invalidRows: number;
  unknownReasons: number;
  totalRows: number;
};

const EMAIL_HEADERS = ["email", "e-mail", "email address", "address"];
const REASON_HEADERS = ["reason", "suppression reason"];
const NOTE_HEADERS = ["note", "notes", "comment"];

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

function asReason(value: string): SuppressionReasonValue | null {
  if (value === "") return "manual";
  const normalized = value.toLowerCase().replaceAll(" ", "_").replaceAll("-", "_");
  return (SUPPRESSION_REASONS as readonly string[]).includes(normalized)
    ? (normalized as SuppressionReasonValue)
    : null;
}

export function parseSuppressionCsv(input: string): SuppressionCsvParseResult {
  const parsed = parseCsv(input);
  const emailIndex = headerIndex(parsed.headers, EMAIL_HEADERS);
  if (emailIndex < 0) throw new Error("The file needs an email column.");

  const reasonIndex = headerIndex(parsed.headers, REASON_HEADERS);
  const noteIndex = headerIndex(parsed.headers, NOTE_HEADERS);

  const byEmail = new Map<string, SuppressionImportRow>();
  let invalidRows = 0;
  let unknownReasons = 0;

  for (const cells of parsed.rows) {
    const email = valueAt(cells, emailIndex);
    const normalized = normalizeEmail(email);
    if (normalized === "" || !isValidEmail(email)) {
      invalidRows += 1;
      continue;
    }

    const reason = asReason(valueAt(cells, reasonIndex));
    if (reason === null) unknownReasons += 1;
    byEmail.set(normalized, {
      email: email.slice(0, 254),
      emailNormalized: normalized,
      reason: reason ?? "manual",
      note: valueAt(cells, noteIndex).slice(0, 500) || null,
    });
  }

  return {
    rows: [...byEmail.values()],
    invalidRows,
    unknownReasons,
    totalRows: parsed.rows.length,
  };
}

function csvCell(value: string | null): string {
  const text = value ?? "";
  if (!/[" ,\n\r]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

export function toSuppressionCsv(
  rows: {
    email: string;
    reason: string;
    note: string | null;
    createdAt: string | Date;
  }[],
): string {
  const lines = [["email", "reason", "note", "created_at"].join(",")];
  for (const row of rows) {
    lines.push(
      [
        csvCell(row.email),
        csvCell(row.reason),
        csvCell(row.note),
        csvCell(new Date(row.createdAt).toISOString()),
      ].join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}
