import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getAdminDashboard } from "@/features/observability/admin-dashboard";
import { requireUser } from "@/lib/authz";
import { isInternalAdminEmail } from "@/lib/observability/config";

export const metadata: Metadata = {
  title: "Internal operations",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

const CARD = "rounded-lg border bg-card p-4";
const LABEL = "text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground";

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div>
      <p className={LABEL}>{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      {detail ? <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

export default async function InternalAdminPage() {
  const user = await requireUser();
  if (!isInternalAdminEmail(user.email)) notFound();

  const dashboard = await getAdminDashboard();
  const latestBackups = new Map<string, (typeof dashboard.backups)[number]>();
  for (const row of dashboard.backups) {
    if (!latestBackups.has(row.kind)) latestBackups.set(row.kind, row);
  }
  const backupRows = [...latestBackups.values()];
  const backupFailed = backupRows.some((row) => row.status === "failed");
  const backupAge = backupRows.reduce<(typeof backupRows)[number] | undefined>(
    (oldest, row) => (!oldest || row.checkedAt < oldest.checkedAt ? row : oldest),
    undefined,
  );

  return (
    <main className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6">
      <header className="space-y-2">
        <p className={LABEL}>Internal · deployment operators only</p>
        <h1 className="text-2xl font-semibold tracking-tight">Operations overview</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Aggregate service signals only. This page contains no workspace names, customer
          records, job payloads or provider error text.
        </p>
        <p className="text-xs text-muted-foreground">
          Release <span className="font-mono">{dashboard.release}</span> ·{" "}
          {dashboard.environment} · checked{" "}
          <time dateTime={dashboard.generatedAt}>
            {new Date(dashboard.generatedAt).toLocaleString("en", { timeZone: "UTC" })} UTC
          </time>
        </p>
      </header>

      <section aria-labelledby="tenants" className={CARD}>
        <h2 id="tenants" className="text-sm font-semibold">Tenants</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-4">
          <Metric label="Workspaces" value={dashboard.tenants.workspaces.toLocaleString()} />
          <Metric label="Products" value={dashboard.tenants.products.toLocaleString()} />
          <Metric label="Users" value={dashboard.tenants.users.toLocaleString()} />
          <Metric label="Customers" value={dashboard.tenants.customers.toLocaleString()} />
        </div>
      </section>

      <section aria-labelledby="jobs" className={CARD}>
        <h2 id="jobs" className="text-sm font-semibold">Queue and jobs</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <Metric label="Pending" value={dashboard.jobs.pending.toLocaleString()} />
          <Metric label="Running" value={dashboard.jobs.running.toLocaleString()} />
          <Metric label="Overdue" value={dashboard.jobs.overdue.toLocaleString()} detail="Due > 10 min" />
          <Metric label="Failed (24h)" value={dashboard.jobs.failed24h.toLocaleString()} />
          <Metric label="Claims (30m)" value={dashboard.jobs.runs30m.toLocaleString()} />
          <Metric label="Failures (30m)" value={dashboard.jobs.runFailures30m.toLocaleString()} />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Oldest pending job:{" "}
          {dashboard.jobs.oldestDueMinutes === null
            ? "none due"
            : `${dashboard.jobs.oldestDueMinutes} minutes past due`}
          . Terminal failures: {dashboard.jobs.failed.toLocaleString()}.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="http" className={CARD}>
          <h2 id="http" className="text-sm font-semibold">HTTP (instrumented routes)</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Metric label="Requests (15m)" value={dashboard.http.requests15m.toLocaleString()} />
            <Metric label="5xx (15m)" value={dashboard.http.errors15m.toLocaleString()} />
            <Metric label="Error rate" value={`${dashboard.http.errorRatePct}%`} />
          </div>
          <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Slowest routes, 24h
          </h3>
          {dashboard.http.slowRoutes.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No instrumented requests yet.</p>
          ) : (
            <ul className="mt-2 divide-y text-sm">
              {dashboard.http.slowRoutes.map((route) => (
                <li key={`${route.method} ${route.route}`} className="flex justify-between gap-3 py-2">
                  <span className="min-w-0 truncate font-mono text-xs">
                    {route.method} {route.route}
                  </span>
                  <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                    avg {route.avgMs} ms · max {route.maxMs} ms · {route.requests}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="delivery" className={CARD}>
          <h2 id="delivery" className="text-sm font-semibold">Email and webhooks</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Metric label="Email sent (24h)" value={dashboard.email.sent24h.toLocaleString()} />
            <Metric
              label="Bounce rate (24h)"
              value={`${dashboard.email.bounceRatePct}%`}
              detail={`${dashboard.email.bounced24h} bounced, ${dashboard.email.complained24h} complained`}
            />
            <Metric label="Webhooks ok (24h)" value={dashboard.webhooks.succeeded24h.toLocaleString()} />
            <Metric
              label="Webhook failures (24h)"
              value={dashboard.webhooks.failed24h.toLocaleString()}
              detail={`${dashboard.webhooks.failureRatePct}% failure rate`}
            />
          </div>
        </section>

        <section aria-labelledby="ai" className={CARD}>
          <h2 id="ai" className="text-sm font-semibold">AI usage</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Metric label="Cost (24h)" value={formatUsd(dashboard.ai.cost24hUsd)} />
            <Metric label="Cost (30d)" value={formatUsd(dashboard.ai.cost30dUsd)} />
            <Metric label="Prompt tokens (24h)" value={dashboard.ai.promptTokens24h.toLocaleString()} />
            <Metric
              label="Completion tokens (24h)"
              value={dashboard.ai.completionTokens24h.toLocaleString()}
            />
          </div>
        </section>

        <section aria-labelledby="infra" className={CARD}>
          <h2 id="infra" className="text-sm font-semibold">Infrastructure</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Metric
              label="Database"
              value={formatBytes(dashboard.database.bytes)}
              detail={`${dashboard.database.migrations ?? "unknown"} migrations`}
            />
            <Metric
              label="Object storage"
              value={formatBytes(dashboard.storage.bytes)}
              detail={`${dashboard.storage.objects.toLocaleString()} objects${dashboard.storage.ok ? "" : " · inventory failed"}`}
            />
            <Metric
              label="Backup verification"
              value={backupFailed ? "failed" : (backupAge?.status ?? "not run")}
              detail={
                backupAge
                  ? `oldest ${backupAge.kind}, ${backupAge.ageHours}h ago`
                  : "The scheduled job has not completed"
              }
            />
            <Metric
              label="Queue depth"
              value={dashboard.jobs.pending.toLocaleString()}
              detail={`${dashboard.jobs.overdue} overdue`}
            />
          </div>
        </section>
      </div>

      <section aria-labelledby="views" className={CARD}>
        <h2 id="views" className="text-sm font-semibold">Settings sections opened (30d)</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Privacy-reviewed product analytics: section slugs only, with a keyed pseudonymous
          actor reference for distinct-people counts. No page content, form values or raw user
          ids. {dashboard.dashboardViews.total.toLocaleString()} events.
        </p>
        {dashboard.dashboardViews.top.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No settings views recorded yet.</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1 font-medium">Surface</th>
                <th className="py-1 font-medium">Section</th>
                <th className="py-1 text-right font-medium">Views</th>
                <th className="py-1 text-right font-medium">People</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {dashboard.dashboardViews.top.map((row) => (
                <tr key={`${row.surface}:${row.section}`}>
                  <td className="py-1.5 text-muted-foreground">{row.surface.replace("_", " ")}</td>
                  <td className="py-1.5 font-mono text-xs">{row.section}</td>
                  <td className="py-1.5 text-right tabular-nums">{row.views}</td>
                  <td className="py-1.5 text-right tabular-nums">{row.people}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="costs" className={CARD}>
        <h2 id="costs" className="text-sm font-semibold">Estimated monthly cost</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Estimates from current usage and configured rates, not an invoice. Database and
          storage use current bytes; email and AI use trailing 30-day volume.
        </p>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="py-1 font-medium">Line</th>
              <th className="py-1 font-medium">Quantity</th>
              <th className="py-1 font-medium">Basis</th>
              <th className="py-1 text-right font-medium">Est. / month</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {dashboard.costs.lineItems.map((item) => (
              <tr key={item.key}>
                <td className="py-1.5">{item.label}</td>
                <td className="py-1.5 tabular-nums text-muted-foreground">
                  {item.quantity.toLocaleString()} {item.unit}
                </td>
                <td className="py-1.5 text-xs text-muted-foreground">{item.basis}</td>
                <td className="py-1.5 text-right tabular-nums">{formatUsd(item.monthlyUsd)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="pt-2 text-sm font-semibold" colSpan={3}>
                Total
              </td>
              <td className="pt-2 text-right text-sm font-semibold tabular-nums">
                {formatUsd(dashboard.costs.totalMonthlyUsd)}
              </td>
            </tr>
          </tfoot>
        </table>
      </section>

      <footer className="flex flex-wrap gap-4 border-t pt-4 text-xs text-muted-foreground">
        <Link className="text-primary hover:underline" href="/status">
          Public status
        </Link>
        <Link className="text-primary hover:underline" href="/status/incidents">
          Incident runbook
        </Link>
        <Link className="text-primary hover:underline" href="/app">
          Back to app
        </Link>
      </footer>
    </main>
  );
}
