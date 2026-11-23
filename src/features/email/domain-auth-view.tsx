import { BadgeCheck, ShieldQuestion } from "lucide-react";

import { SettingsSection } from "@/components/shared/settings-section";
import { StatusBadge, type StatusTone } from "@/components/shared/status-badge";
import type { DomainAuthReport, DomainAuthStatus } from "./domain-auth";

/**
 * DNS authentication status for the sending domain.
 *
 * Read-only and informational: the app cannot publish DNS records, so the card
 * reports what already resolves and what is still missing. A record that could
 * not be read is shown as unknown rather than as a failure.
 */

const STATUS_LABEL: Record<DomainAuthStatus, string> = {
  ok: "Verified",
  missing: "Not found",
  unknown: "Not checked",
};

const STATUS_TONE: Record<DomainAuthStatus, StatusTone> = {
  ok: "success",
  missing: "warning",
  unknown: "neutral",
};

export function EmailDomainAuthView({ report }: { report: DomainAuthReport }) {
  const verified = report.records.filter((record) => record.status === "ok").length;
  const total = report.records.length;

  return (
    <SettingsSection
      id="email-authentication"
      icon={BadgeCheck}
      title="Sender authentication"
      description="SPF, DKIM and DMARC decide whether inbox providers trust the domain your workspace sends from. Bounces and complaints from the provider webhook suppress the address, so a bad address is not retried."
      badge={
        report.ready ? (
          <StatusBadge tone="success">Ready to send</StatusBadge>
        ) : report.configured ? (
          <StatusBadge tone="warning">Records missing</StatusBadge>
        ) : (
          <StatusBadge tone="neutral">Not configured</StatusBadge>
        )
      }
    >
      {!report.configured || !report.domain ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/15 px-4 py-5 text-sm leading-6 text-muted-foreground">
          Save a From address in Sender identity, or set <code>EMAIL_FROM</code> as the
          deployment fallback, to check its DNS records.
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-2.5 sm:grid-cols-3">
            <div className="rounded-lg border border-border/80 bg-muted/20 p-3.5">
              <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Domain
              </p>
              <p className="mt-1 truncate text-sm font-medium text-foreground">
                {report.domain}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {report.source === "workspace"
                  ? "Workspace sender"
                  : "Deployment fallback"}
              </p>
            </div>
            <div className="rounded-lg border border-border/80 bg-muted/20 p-3.5">
              <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Verified records
              </p>
              <p className="mt-1 text-sm font-medium tabular-nums text-foreground">
                {verified} of {total}
              </p>
            </div>
            <div className="rounded-lg border border-border/80 bg-muted/20 p-3.5">
              <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Inbox trust
              </p>
              <div className="mt-1.5">
                <StatusBadge tone={report.ready ? "success" : "warning"}>
                  {report.ready ? "All records found" : "Needs attention"}
                </StatusBadge>
              </div>
            </div>
          </div>

          <p className="text-[13px] leading-5 text-muted-foreground">
            Checking <span className="font-medium text-foreground">{report.domain}</span>{" "}
            {report.ready ? (
              <span className="text-success">— all three records resolve.</span>
            ) : (
              <span>— a missing record means more mail lands in spam.</span>
            )}
          </p>

          <div className="rounded-lg border border-border/80 bg-muted/15 px-4 py-3.5">
            <p className="text-xs font-semibold text-foreground">Guided setup</p>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-xs leading-5 text-muted-foreground">
              <li>
                Add <span className="font-medium text-foreground">{report.domain}</span> in
                Resend → Domains.
              </li>
              <li>
                Copy Resend&apos;s MX and SPF records for{" "}
                <code className="font-mono">send.{report.domain}</code>. Resend puts the
                envelope sender there.
              </li>
              <li>
                Add the DKIM TXT record at{" "}
                <code className="font-mono">resend._domainkey.{report.domain}</code> using
                the exact <code className="font-mono">p=…</code> value Resend shows.
              </li>
              <li>
                Add a DMARC TXT record at <code className="font-mono">_dmarc.{report.domain}</code>{" "}
                starting with <code className="font-mono">v=DMARC1; p=none;</code> and a
                reporting address you monitor.
              </li>
              <li>Reload this page after DNS propagates; verification can take up to an hour.</li>
            </ol>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border/80">
            <table className="w-full min-w-[560px] text-left text-sm">
              <caption className="sr-only">
                SPF, DKIM and DMARC records for the sending domain
              </caption>
              <thead className="border-b border-border/70 bg-muted/25 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3.5 py-2.5 font-medium">Record</th>
                  <th scope="col" className="px-3.5 py-2.5 font-medium">Name</th>
                  <th scope="col" className="px-3.5 py-2.5 font-medium">Status</th>
                  <th scope="col" className="px-3.5 py-2.5 font-medium">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {report.records.map((record) => (
                  <tr key={record.key} className="align-top">
                    <td className="px-3.5 py-3 font-medium text-foreground">
                      {record.label}
                    </td>
                    <td className="px-3.5 py-3 font-mono text-xs text-muted-foreground">
                      {record.host}
                    </td>
                    <td className="px-3.5 py-3">
                      <StatusBadge tone={STATUS_TONE[record.status]}>
                        {STATUS_LABEL[record.status]}
                      </StatusBadge>
                    </td>
                    <td className="max-w-72 px-3.5 py-3 font-mono text-xs break-words text-muted-foreground">
                      {record.value ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="flex items-start gap-2 rounded-lg border border-border/80 bg-muted/15 px-3.5 py-3 text-xs leading-5 text-muted-foreground">
            <ShieldQuestion className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            Add the missing records at your DNS host using the values your email provider
            gives you. Verification can take up to an hour after a change; reload this page
            to re-check.
          </p>
        </div>
      )}
    </SettingsSection>
  );
}
