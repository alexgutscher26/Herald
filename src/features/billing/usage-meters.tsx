"use client";

import { Gauge } from "lucide-react";

import { formatCurrency, formatNumber } from "@/lib/format";
import { usageStatus, type UsageLevel } from "@/features/entitlements/plans";

type Meter = { used: number; limit: number | null };

export type UsageMetersView = {
  boards: Meter;
  members: Meter;
  integrations: Meter;
  emails: Meter;
  surveyImpressions: Meter;
  aiSpendCents: number;
  viewers: number;
};

function tone(level: UsageLevel): {
  bar: string;
  text: string;
} {
  if (level === "limit") {
    return { bar: "bg-destructive", text: "text-destructive" };
  }
  if (level === "warning") {
    return { bar: "bg-warning", text: "text-warning" };
  }
  return { bar: "bg-primary", text: "text-muted-foreground" };
}

function limitLabel(limit: number | null): string {
  return limit === null ? "Unlimited" : formatNumber(limit);
}

function MeterCard({
  label,
  meter,
  note,
  billingUrl,
}: {
  label: string;
  meter: Meter;
  note?: string;
  billingUrl: string;
}) {
  const status = usageStatus(meter.used, meter.limit);
  const colors = tone(status.level);
  return (
    <div className="rounded-lg border border-border/80 bg-card p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className={`text-xs tabular-nums ${colors.text}`}>
          {formatNumber(meter.used)} / {limitLabel(meter.limit)}
        </p>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${colors.bar}`}
          style={{ width: `${status.percent}%` }}
        />
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        {note ?? (meter.limit === null ? "No cap on this plan" : `${status.percent}% used`)}
        {status.level === "limit" ? (
          <>
            {" "}
            <a className="font-medium text-primary underline" href={billingUrl}>
              Upgrade
            </a>
          </>
        ) : null}
      </p>
    </div>
  );
}

/** Six counters the operator can reason about before a hard block. */
export function UsageMeters({
  meters,
  billingUrl,
}: {
  meters: UsageMetersView;
  billingUrl: string;
}) {
  const rows = [
    { label: "Boards", meter: meters.boards, note: "Across products" },
    { label: "Paid seats", meter: meters.members, note: `${meters.viewers} free viewers` },
    { label: "Integrations", meter: meters.integrations, note: "Active connections" },
    { label: "Emails this month", meter: meters.emails, note: "Provider-confirmed sends" },
    {
      label: "Survey impressions",
      meter: meters.surveyImpressions,
      note: "This month",
    },
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Gauge className="size-4 text-muted-foreground" aria-hidden="true" />
        <h3 className="text-sm font-semibold">Usage this month</h3>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((row) => (
          <MeterCard key={row.label} {...row} billingUrl={billingUrl} />
        ))}
        <div className="rounded-lg border border-border/80 bg-card p-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground">AI spend</p>
            <p className="text-xs tabular-nums text-foreground">
              {formatCurrency(meters.aiSpendCents, "usd")}
            </p>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-muted" />
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            This month · no plan cap; Mira has a daily budget per product
          </p>
        </div>
      </div>
    </div>
  );
}