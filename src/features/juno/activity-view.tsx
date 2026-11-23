import { Activity } from "lucide-react";

import { SettingsSection } from "@/components/shared/settings-section";
import { StatusBadge } from "@/components/shared/status-badge";

import type { JunoActivity } from "./activity";

/** The 30-day Juno meter: volume, handoffs, resolutions and spend. */
export function JunoActivityView({ activity }: { activity: JunoActivity }) {
  const stats = [
    {
      label: "Handled by Juno",
      value: String(activity.answers),
      hint: `${activity.windowDays}-day answers, handoffs and skips`,
    },
    {
      label: "Handoff rate",
      value: `${Math.round(activity.handoffRate * 100)}%`,
      hint: `${activity.handoffs} of ${activity.answers} pickups`,
    },
    {
      label: "Resolved without team",
      value: `${Math.round(activity.resolvedWithoutTeamShare * 100)}%`,
      hint: `${activity.resolvedWithoutTeam} of ${activity.resolved} Juno-resolved threads`,
    },
    {
      label: "AI cost",
      value: `$${(activity.costCents / 100).toFixed(2)}`,
      hint:
        activity.resolved > 0
          ? `${(activity.costPerResolvedCents / 100).toFixed(2)} per resolved thread`
          : "No resolved thread yet",
    },
  ];

  return (
    <SettingsSection
      icon={Activity}
      title="Juno activity"
      description="Derived from the answer log, not a separate counter. A thread counts as resolved without the team when no human replied after Juno."
      badge={<StatusBadge tone="neutral">Last {activity.windowDays} days</StatusBadge>}
    >
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-lg border border-border/80 bg-muted/20 p-3.5"
          >
            <dt className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
              {stat.label}
            </dt>
            <dd className="mt-1.5 text-2xl font-semibold tracking-[-0.02em] tabular-nums text-foreground">
              {stat.value}
            </dd>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{stat.hint}</p>
          </div>
        ))}
      </dl>

      <div className="mt-5 rounded-lg border border-border/80 bg-muted/20 p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
            Daily AI budget
          </h3>
          <span className="text-xs font-medium tabular-nums text-foreground">
            ${(activity.dailyBudget.spentCents / 100).toFixed(2)} of $
            {(activity.dailyBudget.limitCents / 100).toFixed(2)}
          </span>
        </div>
        {activity.dailyBudget.limitCents > 0 ? (
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-border"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={activity.dailyBudget.percent}
            aria-label="Daily Juno budget used"
          >
            <div
              className={
                activity.dailyBudget.spentCents >= activity.dailyBudget.limitCents
                  ? "h-full rounded-full bg-destructive"
                  : activity.dailyBudget.thresholdCents !== null &&
                      activity.dailyBudget.spentCents >=
                        activity.dailyBudget.thresholdCents
                    ? "h-full rounded-full bg-warning"
                    : "h-full rounded-full bg-primary"
              }
              style={{ width: `${activity.dailyBudget.percent}%` }}
            />
          </div>
        ) : null}
        {activity.dailyBudget.limitCents <= 0 ? (
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            The daily budget is zero, so paid generation is off. Juno still hands
            off and logs the reason.
          </p>
        ) : activity.dailyBudget.spentCents >= activity.dailyBudget.limitCents ? (
          <p
            role="alert"
            className="mt-2 rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-2 text-xs leading-5 text-destructive"
          >
            The daily budget is exhausted. Juno now hands off instead of calling
            the model until the next UTC day.
          </p>
        ) : activity.dailyBudget.thresholdCents !== null &&
          activity.dailyBudget.spentCents >= activity.dailyBudget.thresholdCents ? (
          <p
            role="alert"
            className="mt-2 rounded-md border border-warning/40 bg-warning-muted/50 px-2.5 py-2 text-xs leading-5 text-foreground"
          >
            {activity.dailyBudget.percent}% of today&apos;s budget is used. Juno
            stops at 100%; this alert is recorded once per day.
            {activity.dailyBudget.alertedAt
              ? ` First fired ${new Date(
                  activity.dailyBudget.alertedAt,
                ).toLocaleString()}.`
              : ""}
          </p>
        ) : (
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            An alert appears here at 80%; at 100% Juno hands off rather than
            degrading silently.
          </p>
        )}
      </div>

      <div className="mt-5 border-t border-border/70 pt-4">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
          Handoff reasons
        </h3>
        {activity.handoffReasons.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No handoffs in this window.</p>
        ) : (
          <ul className="mt-2.5 flex flex-wrap gap-2">
            {activity.handoffReasons.map((entry) => (
              <li
                key={entry.reason}
                className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-muted/25 px-3 py-1 text-xs text-muted-foreground"
              >
                <span className="capitalize">{entry.reason.replace(/_/g, " ")}</span>
                <span className="font-medium tabular-nums text-foreground">{entry.count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SettingsSection>
  );
}
