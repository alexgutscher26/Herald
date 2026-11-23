import { auditDetail, type AuditMetadata } from "./audit-detail";

/**
 * CSV export for the owner-only audit log.
 *
 * Pure: the route handler resolves the authorized rows and this module only
 * formats them. Fields are always quoted, so an email address, a workspace name
 * or a metadata value containing a comma or a newline cannot break the shape.
 */

export type AuditCsvEntry = {
  createdAt: string;
  action: string;
  actorName: string | null;
  actorEmail: string | null;
  targetType: string | null;
  targetId: string | null;
  metadata: AuditMetadata | null;
};

export const AUDIT_CSV_HEADERS = [
  "timestamp",
  "action",
  "detail",
  "target_type",
  "target_id",
  "actor_name",
  "actor_email",
] as const;

function cell(value: string | null | undefined): string {
  // A leading =, +, - or @ is a spreadsheet formula; prefixing it with a quote
  // keeps an exported audit row from executing when opened in Excel or Sheets.
  const raw = value ?? "";
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function toAuditCsv(entries: readonly AuditCsvEntry[]): string {
  const lines = [AUDIT_CSV_HEADERS.join(",")];
  for (const entry of entries) {
    lines.push(
      [
        cell(entry.createdAt),
        cell(entry.action),
        cell(auditDetail(entry)),
        cell(entry.targetType),
        cell(entry.targetId),
        cell(entry.actorName),
        cell(entry.actorEmail),
      ].join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}
