"use client";

import { Mail, ShieldAlert, UserRound, Users } from "lucide-react";

import { StatusBadge } from "@/components/shared/status-badge";
import { formatNumber } from "@/lib/format";

import {
  SUPPRESSION_REASONS,
  type AudienceSource,
  type AudienceSuppressionReason,
  type ReleaseAudiencePreview,
} from "./audience-types";

const SOURCE_LABELS: Record<AudienceSource, string> = {
  widget: "Widget signup",
  import: "CSV import",
  api: "API",
  manual: "Added manually",
  follower: "Follower sync",
};

const SUPPRESSION_LABELS: Record<AudienceSuppressionReason, string> = {
  hard_bounce: "Hard bounce",
  complaint: "Complaint",
  manual: "Added manually",
  unsubscribe: "Unsubscribed link",
};

export function AudiencePreviewContent({
  preview,
  loading,
  error,
  compact = false,
}: {
  preview: ReleaseAudiencePreview | null;
  loading: boolean;
  error: string | null;
  compact?: boolean;
}) {
  if (loading) {
    return (
      <div className="space-y-2" aria-live="polite">
        <p className="text-xs text-muted-foreground">Checking who would receive this email…</p>
        <div className="h-16 animate-pulse rounded-md bg-muted" />
      </div>
    );
  }

  if (error) {
    return (
      <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
        {error}
      </p>
    );
  }

  if (!preview) return null;

  const recipientLimit = compact ? 5 : 200;
  const suppressedLimit = compact ? 3 : 50;
  const recipients = preview.recipients.slice(0, recipientLimit);
  const suppressedAddresses = preview.suppressedAddresses.slice(0, suppressedLimit);

  return (
    <div className="space-y-4">
      {!preview.emailEnabled ? (
        <p className="rounded-md border border-warning/30 bg-warning-muted/40 px-3 py-2 text-xs leading-relaxed text-warning">
          Subscriber email is off for this release. This is the list that would receive it if you
          turn the channel on; nothing is queued today.
        </p>
      ) : null}

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-md border p-2.5">
          <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Will receive
          </dt>
          <dd className="mt-0.5 flex items-baseline gap-1.5 text-lg font-semibold tabular-nums">
            <Mail className="size-4 self-center text-muted-foreground" aria-hidden="true" />
            {formatNumber(preview.eligible)}
          </dd>
          <p className="text-[11px] text-muted-foreground">
            Active, not suppressed
            {preview.mutedByTag > 0
              ? ` · ${formatNumber(preview.mutedByTag)} muted this tag`
              : ""}
          </p>
        </div>
        <div className="rounded-md border p-2.5">
          <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Suppressed</dt>
          <dd className="mt-0.5 flex items-baseline gap-1.5 text-lg font-semibold tabular-nums">
            <ShieldAlert className="size-4 self-center text-warning" aria-hidden="true" />
            {formatNumber(preview.suppressed)}
          </dd>
          <p className="text-[11px] text-muted-foreground">Skipped at send time</p>
        </div>
        <div className="rounded-md border p-2.5">
          <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Unsubscribed
          </dt>
          <dd className="mt-0.5 text-lg font-semibold tabular-nums">
            {formatNumber(preview.unsubscribed)}
          </dd>
          <p className="text-[11px] text-muted-foreground">Never emailed again</p>
        </div>
        <div className="rounded-md border p-2.5">
          <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Pending</dt>
          <dd className="mt-0.5 text-lg font-semibold tabular-nums">
            {formatNumber(preview.pending)}
          </dd>
          <p className="text-[11px] text-muted-foreground">Not opted in yet</p>
        </div>
      </dl>

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Users className="size-3.5" aria-hidden="true" />
            Who will receive this
          </p>
          <span className="text-[11px] text-muted-foreground">
            {preview.followersInAudience > 0
              ? `${formatNumber(preview.followersInAudience)} follow a linked request`
              : null}
          </span>
        </div>

        {recipients.length === 0 ? (
          <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            No active, unsuppressed subscribers would receive this email.
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {recipients.map((recipient) => (
              <li
                key={recipient.email}
                className="flex flex-wrap items-start justify-between gap-2 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm">
                    {recipient.name ? `${recipient.name} · ` : null}
                    <span className="text-muted-foreground">{recipient.email}</span>
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                    <UserRound className="size-3" aria-hidden="true" />
                    Active subscriber · {SOURCE_LABELS[recipient.source] ?? recipient.source}
                  </p>
                </div>
                {recipient.followsLinkedRequest ? (
                  <StatusBadge tone="accent">Follows a linked request</StatusBadge>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {preview.eligible > recipients.length ? (
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Showing the first {formatNumber(recipients.length)} of{" "}
            {formatNumber(preview.eligible)} recipients.
          </p>
        ) : null}
      </div>

      {preview.suppressed > 0 ? (
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <ShieldAlert className="size-3.5" aria-hidden="true" />
            Suppressed addresses
          </p>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {SUPPRESSION_REASONS.filter((reason) => preview.suppressedByReason[reason] > 0).map(
              (reason) => (
                <StatusBadge key={reason} tone="warning">
                  {SUPPRESSION_LABELS[reason]} ·{" "}
                  {formatNumber(preview.suppressedByReason[reason])}
                </StatusBadge>
              ),
            )}
          </div>
          {suppressedAddresses.length > 0 ? (
            <ul className="divide-y rounded-md border border-warning/30 bg-warning-muted/20">
              {suppressedAddresses.map((address) => (
                <li
                  key={address.email}
                  className="flex flex-wrap items-start justify-between gap-2 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-muted-foreground">{address.email}</p>
                    {address.note ? (
                      <p className="text-[11px] text-muted-foreground">{address.note}</p>
                    ) : null}
                  </div>
                  <StatusBadge tone="warning">
                    {SUPPRESSION_LABELS[address.reason]}
                  </StatusBadge>
                </li>
              ))}
            </ul>
          ) : null}
          {preview.suppressed > suppressedAddresses.length ? (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Showing the first {formatNumber(suppressedAddresses.length)} of{" "}
              {formatNumber(preview.suppressed)} suppressed addresses.
            </p>
          ) : null}
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
            Suppression is enforced immediately before every send, so these addresses are skipped
            even if a pending delivery row is recorded.
          </p>
        </div>
      ) : null}

      {!compact ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Counts cover the whole product. The lists are capped previews; no email is sent from
          this screen.
        </p>
      ) : null}
    </div>
  );
}
