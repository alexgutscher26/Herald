import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Incident runbook",
  description:
    "What Herald operators check first during an incident, how severity is declared and what customers can expect.",
  robots: { index: true, follow: true },
};

const SEVERITIES = [
  {
    level: "SEV-1",
    definition:
      "Data loss, cross-tenant exposure, an auth bypass, or the whole product is down.",
    response: "Page on-call immediately, declare an incident commander and freeze deploys.",
  },
  {
    level: "SEV-2",
    definition:
      "A major surface is broken for many customers: public boards, sign-in, publishing or billing.",
    response: "Acknowledge within 15 minutes and assign an owner.",
  },
  {
    level: "SEV-3",
    definition: "A single workspace or a non-critical feature is impaired.",
    response: "Handle in business hours; record the cause and the fix.",
  },
];

export default function IncidentRunbookPage() {
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-12 sm:px-6">
      <header className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Herald
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Incident runbook</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          The public half of the on-call procedure. The internal runbook adds provider
          consoles, database commands and contact details; this page is what a customer
          or an on-call engineer can act on without asking for access.
        </p>
        <p className="text-sm">
          <Link className="text-primary hover:underline" href="/status">
            Current service status
          </Link>
        </p>
      </header>

      <section className="mt-8" aria-labelledby="severity">
        <h2 id="severity" className="text-sm font-semibold">Severity</h2>
        <div className="mt-3 overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Level</th>
                <th className="px-3 py-2 font-medium">Definition</th>
                <th className="px-3 py-2 font-medium">Response</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {SEVERITIES.map((severity) => (
                <tr key={severity.level}>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs font-semibold">
                    {severity.level}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{severity.definition}</td>
                  <td className="px-3 py-2 text-muted-foreground">{severity.response}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          A suspected security incident is SEV-1 until proven otherwise, even when the
          functional impact looks small.
        </p>
      </section>

      <section className="mt-8" aria-labelledby="detect">
        <h2 id="detect" className="text-sm font-semibold">Detect</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
          <li>
            <Link className="text-primary hover:underline" href="/status">
              /status
            </Link>{" "}
            shows live component checks: database, storage, background worker age,
            email delivery, backup verification and overdue jobs.
          </li>
          <li>
            <code className="rounded bg-muted px-1 py-0.5 text-xs">/api/health</code> is
            liveness and{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              /api/health?scope=readiness
            </code>{" "}
            is the dependency check used by the load balancer.
          </li>
          <li>
            The alert channel receives rule transitions: HTTP 5xx rate, job failure rate,
            overdue queue depth, email bounce rate, webhook failure rate, AI spend and
            backup freshness.
          </li>
          <li>
            A customer report is a hypothesis until it is confirmed against one of those
            signals.
          </li>
        </ol>
      </section>

      <section className="mt-8" aria-labelledby="first">
        <h2 id="first" className="text-sm font-semibold">First 15 minutes</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
          <li>Declare a severity and open an incident channel. Record the start time in UTC.</li>
          <li>
            Check <Link className="text-primary hover:underline" href="/status">/status</Link>{" "}
            and the readiness endpoint. Write down what they say before changing anything.
          </li>
          <li>
            Identify the failing dependency. A database outage makes readiness 503 while
            liveness stays 200. A stalled queue shows an old worker run and a growing
            overdue depth. An email incident leaves the rest of the product working.
          </li>
          <li>
            Stop the bleeding first: roll back the last deploy, pause the scheduler or
            disable the failing integration. A reversible mitigation beats a perfect
            diagnosis.
          </li>
          <li>
            Post the first public update within 30 minutes for SEV-1/SEV-2. State what is
            affected and what customers should do; do not speculate about cause or promise
            an ETA you cannot keep.
          </li>
        </ol>
      </section>

      <section className="mt-8" aria-labelledby="degrade">
        <h2 id="degrade" className="text-sm font-semibold">Degraded states</h2>
        <dl className="mt-3 space-y-3 text-sm">
          <div>
            <dt className="font-medium">Database unavailable</dt>
            <dd className="text-muted-foreground">
              Readiness is 503 and API routes answer a friendly 503 with{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">Retry-After</code>{" "}
              rather than a stack trace. Check connection limits and the provider status
              page. Restore from point-in-time recovery only when a forward fix is unsafe.
            </dd>
          </div>
          <div>
            <dt className="font-medium">Queue stalled</dt>
            <dd className="text-muted-foreground">
              The worker run age and overdue depth on /status show it without reading a
              payload. A stale running lock is reclaimed after ten minutes; do not reset
              attempts in place.
            </dd>
          </div>
          <div>
            <dt className="font-medium">Email provider failing</dt>
            <dd className="text-muted-foreground">
              Product pages stay up. Failed deliveries retry with backoff and terminal
              failures remain visible. Suppressed addresses are intentional and must not
              be removed to force a send.
            </dd>
          </div>
          <div>
            <dt className="font-medium">Backup verification stale</dt>
            <dd className="text-muted-foreground">
              The scheduled check has not produced a fresh database, storage and manifest
              row. Treat it as an open incident before the next migration, not after.
            </dd>
          </div>
        </dl>
      </section>

      <section className="mt-8" aria-labelledby="communicate">
        <h2 id="communicate" className="text-sm font-semibold">Communicate</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
          <li>
            Public updates live on{" "}
            <Link className="text-primary hover:underline" href="/status">
              /status
            </Link>{" "}
            for service state. Never mark a component healthy when its live check says
            otherwise.
          </li>
          <li>
            Affected workspace owners are emailed directly for billing or data incidents.
            Customer addresses are not used for incident notices.
          </li>
          <li>
            State what is affected, when it started (UTC), what customers should do and
            when the next update will be. Follow up with a postmortem for SEV-1/SEV-2.
          </li>
        </ul>
      </section>

      <footer className="mt-10 border-t pt-6 text-xs text-muted-foreground">
        <p>
          The full operator procedure, including database commands, provider escalation and
          the postmortem template, lives in <code>docs/incidents.md</code> in the
          deployment repository.
        </p>
        <p className="mt-2">
          <Link className="text-primary hover:underline" href="/status">
            Service status
          </Link>
          {" · "}
          <Link className="text-primary hover:underline" href="/">
            Herald home
          </Link>
        </p>
      </footer>
    </main>
  );
}
