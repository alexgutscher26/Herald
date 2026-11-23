import { parseCsv } from "@/features/import/csv";
import { isValidEmail, normalizeEmail } from "@/lib/email";

/**
 * Cancellation CSV transport.
 *
 * The import is an eligibility builder, not a second customer database. A row
 * creates or updates the product-scoped customer account, marks it cancelled,
 * and records one cancellation event with the optional reason and feedback.
 */

export type CancellationImportRow = {
  email: string;
  emailNormalized: string;
  name: string | null;
  externalId: string;
  cancelledAt: Date;
  cancelledAtExplicit: boolean;
  reason: string | null;
  feedback: string | null;
};

export type CancellationCsvParseResult = {
  rows: CancellationImportRow[];
  invalidRows: number;
  totalRows: number;
};

const EMAIL_HEADERS = ["email", "e-mail", "email address", "customer email"];
const NAME_HEADERS = ["name", "customer name", "full name"];
const EXTERNAL_ID_HEADERS = ["external_id", "customer_id", "id", "stripe_customer_id"];
const CANCELLED_AT_HEADERS = ["cancelled_at", "cancelled at", "canceled_at", "canceled at"];
const REASON_HEADERS = ["reason", "cancellation_reason", "cancellation reason"];
const FEEDBACK_HEADERS = ["feedback", "comment", "details", "note"];

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

export function parseCancellationCsv(input: string): CancellationCsvParseResult {
  const parsed = parseCsv(input);
  const emailIndex = headerIndex(parsed.headers, EMAIL_HEADERS);
  if (emailIndex < 0) throw new Error("The file needs an email column.");

  const nameIndex = headerIndex(parsed.headers, NAME_HEADERS);
  const externalIndex = headerIndex(parsed.headers, EXTERNAL_ID_HEADERS);
  const cancelledIndex = headerIndex(parsed.headers, CANCELLED_AT_HEADERS);
  const reasonIndex = headerIndex(parsed.headers, REASON_HEADERS);
  const feedbackIndex = headerIndex(parsed.headers, FEEDBACK_HEADERS);

  const rows: CancellationImportRow[] = [];
  let invalidRows = 0;

  for (const cells of parsed.rows) {
    const email = valueAt(cells, emailIndex);
    const normalized = normalizeEmail(email);
    if (!isValidEmail(email) || normalized === "") {
      invalidRows += 1;
      continue;
    }

    const cancelledRaw = valueAt(cells, cancelledIndex);
    const cancelledAt = cancelledRaw === "" ? new Date() : new Date(cancelledRaw);
    if (Number.isNaN(cancelledAt.getTime())) {
      invalidRows += 1;
      continue;
    }

    const reason = valueAt(cells, reasonIndex).slice(0, 120) || null;
    const feedback = valueAt(cells, feedbackIndex).slice(0, 2000) || null;
    const externalId =
      valueAt(cells, externalIndex).slice(0, 200) || `import:${normalized}`;

    rows.push({
      email: email.slice(0, 254),
      emailNormalized: normalized,
      name: valueAt(cells, nameIndex).slice(0, 120) || null,
      externalId,
      cancelledAt,
      cancelledAtExplicit: cancelledRaw !== "",
      reason,
      feedback,
    });
  }

  return { rows, invalidRows, totalRows: parsed.rows.length };
}
