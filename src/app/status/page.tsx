import type { Metadata } from "next";
import Link from "next/link";

import {
  getPublicStatus,
  type StatusHistoryDay,
  type StatusState,
} from "@/features/status/service";

export const metadata: Metadata = {
  title: "Service status",
  description:
    "Live health of Herald's dashboard, API, database, background jobs and email delivery.",
};

export const dynamic = "force-dynamic";

const STATE_LABEL: Record<StatusState, string> = {
  operational: "Operational",
  degraded: "Degraded performance",
  outage: "Service outage",
};

const OVERALL_LABEL: Record<StatusState, string> = {
  operational: "All systems operational",
  degraded: "Partially degraded service",
  outage: "Active service outage",
};

const OVERALL_STYLE: Record<StatusState, string> = {
  operational: "border-emerald-500/40 bg-emerald-500/5 text-emerald-700",
  degraded: "border-warning/40 bg-warning-muted text-warning",
  outage: "border-destructive/40 bg-destructive/5 text-destructive",
};

const DOT_STYLE: Record<StatusState, string> = {
  operational: "bg-emerald-500",
  degraded: "bg-amber-500",
  outage: "bg-destructive",
};

const HISTORY_STYLE: Record<StatusHistoryDay["state"], string> = {
  operational: "bg-emerald-500",
  degraded: "bg-amber-500",
  outage: "bg-destructive",
  "no-data": "bg-muted-foreground/20",
};

function historyLabel(day: StatusHistoryDay): string {
  const date = new Date(`${day.date}T00:00:00Z`).toLocaleDateString("en", {
    dateStyle: "medium",
    timeZone: "UTC",
  });
  if (day.state === "no-data") return `${date}: no worker runs recorded`;
  return `${date}: ${day.runs} worker run${day.runs === 1 ? "" : "s"}, ${day.failed} failed`;
}

export default async function StatusPage() {
  const status = await getPublicStatus();
  const failingDays = status.history.filter(
    (day) => day.state === "degraded" || day.state === "outage",
  ).length;
  const missingDays = status.history.filter((day) => day.state === "no-data").length;

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-12 sm:px-6">
      <header className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Herald
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Service status</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Live checks against the application and its dependencies. Only aggregate service signals
          are published here — never workspace names, customer data or error details.
        </p>
      </header>

      <section
        aria-live="polite"
        className={`mt-8 rounded-lg border p-4 ${OVERALL_STYLE[status.overall]}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">{OVERALL_LABEL[status.overall]}</p>
          <p className="text-xs">
            Checked{" "}
            <time dateTime={status.checkedAt}>
              {new Date(status.checkedAt).toLocaleTimeString("en", {
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "UTC",
                timeZoneName: "short",
              })}
            </time>
          </p>
        </div>
      </section>

      <section className="mt-6" aria-labelledby="components-heading">
        <h2 id="components-heading" className="text-sm font-semibold">
          Components
        </h2>
        <ul className="mt-3 divide-y rounded-lg border bg-card">
          {status.components.map((component) => (
            <li key={component.id} className="flex items-start justify-between gap-4 p-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">{component.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{component.description}</p>
                <p className="mt-1 text-xs text-muted-foreground">{component.detail}</p>
              </div>
              <span className="flex shrink-0 items-center gap-2 text-xs font-medium">
                <span
                  className={`size-2 rounded-full ${DOT_STYLE[component.state]}`}
                  aria-hidden="true"
                />
                {STATE_LABEL[component.state]}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8" aria-labelledby="history-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="history-heading" className="text-sm font-semibold">
            Background jobs, last 14 days
          </h2>
          <p className="text-xs text-muted-foreground">
            {status.history.length === 0
              ? "No worker history available."
              : `${failingDays} day${failingDays === 1 ? "" : "s"} with failed jobs${
                  missingDays > 0 ? ` · ${missingDays} without runs` : ""
                }`}
          </p>
        </div>
        <div className="mt-3 rounded-lg border bg-card p-4">
          {status.history.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Worker history could not be read. This does not by itself indicate an outage.
            </p>
          ) : (
            <>
              <div className="flex items-end gap-1" aria-hidden="true">
                {status.history.map((day) => (
                  <div
                    key={day.date}
                    className={`h-10 flex-1 rounded-sm ${HISTORY_STYLE[day.state]}`}
                    title={historyLabel(day)}
                  />
                ))}
              </div>
              <ul className="sr-only">
                {status.history.map((day) => (
                  <li key={day.date}>{historyLabel(day)}</li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-sm bg-emerald-500" aria-hidden="true" /> No failed
                  jobs
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-sm bg-amber-500" aria-hidden="true" /> Failed jobs
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-sm bg-muted-foreground/20" aria-hidden="true" /> No
                  runs recorded
                </span>
              </div>
            </>
          )}
        </div>
      </section>

      <section className="mt-8 rounded-lg border bg-card p-4" aria-labelledby="runbook-heading">
        <h2 id="runbook-heading" className="text-sm font-semibold">
          Something looks wrong?
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The incident runbook explains severity, what operators check first, how to read
          a degraded component and what customers can expect. It is the public half of the
          on-call procedure, not a static health list.
        </p>
        <p className="mt-2 text-sm">
          <Link className="text-primary hover:underline" href="/status/incidents">
            Open the incident runbook
          </Link>
        </p>
      </section>

      <footer className="mt-10 space-y-2 border-t pt-6 text-xs text-muted-foreground">
        <p>
          This page reads live dependency checks on every request. A component marked degraded is
          still serving; an outage means it is not. The response is not cached.
        </p>
        <p>
          <Link className="text-primary hover:underline" href="/status/incidents">
            Incident runbook
          </Link>
          {" · "}
          <Link className="text-primary hover:underline" href="/">
            Herald home
          </Link>
          {" · "}
          <Link className="text-primary hover:underline" href="/sign-in">
            Sign in
          </Link>
        </p>
      </footer>
    </main>
  );
}
