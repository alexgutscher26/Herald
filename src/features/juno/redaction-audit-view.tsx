import { ShieldCheck } from "lucide-react";

import { SettingsSection } from "@/components/shared/settings-section";
import { StatusBadge } from "@/components/shared/status-badge";

import type { WorkspaceRedactionReport } from "./audit";

const KIND_LABELS: Array<[keyof WorkspaceRedactionReport["counts"], string]> = [
  ["email", "Email addresses"],
  ["phone", "Phone numbers"],
  ["card", "Card numbers"],
  ["iban", "IBANs"],
  ["ssn", "SSNs"],
  ["secret", "Secrets"],
];

/**
 * Workspace-scoped redaction counts.
 *
 * The table stores counts only, never the matched values. Keeping the report at
 * workspace level matches the privacy boundary: an owner can answer "are we
 * redacting anything?" without reading another product's customer text.
 */
export function JunoRedactionAuditView({
  report,
}: {
  report: WorkspaceRedactionReport;
}) {
  return (
    <SettingsSection
      id="juno-redaction-audit"
      icon={ShieldCheck}
      title="Redaction audit"
      description="Counts of personal data and credentials removed before Juno sees a customer message. This report never stores the matched text."
      badge={<StatusBadge tone="neutral">Last {report.windowDays} days</StatusBadge>}
    >
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {KIND_LABELS.map(([kind, label]) => (
          <div
            key={kind}
            className="rounded-lg border border-border/80 bg-muted/20 p-3"
          >
            <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
              {label}
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">
              {report.counts[kind]}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        {report.total} redaction{report.total === 1 ? "" : "s"} across{" "}
        {report.messages} message{report.messages === 1 ? "" : "s"}.
        {report.lastEventAt
          ? ` Last sample ${new Date(report.lastEventAt).toLocaleString()}.`
          : " No personal data has been removed in this window."}
      </p>
    </SettingsSection>
  );
}
