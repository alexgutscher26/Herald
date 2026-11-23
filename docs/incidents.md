# Incident runbook

This is the on-call procedure for Herald. It pairs with
[docs/operations.md](operations.md) (daily checks, backups, migrations),
[docs/observability.md](observability.md) (error tracking, tracing, alerts) and
the public status page at `/status`. The public half of this runbook is served
at `/status/incidents` and linked from every error page.

The status page is generated from live checks: Postgres readiness, a storage
write/read probe, the age and outcome of the last background worker run plus
overdue queue depth, email delivery outcomes in the last 24 hours, and backup
verification freshness. It deliberately shows no workspace names, customer
data, job payloads or provider error strings. Never edit a page or post an
incident claiming a component is healthy when its check says otherwise.

The `evaluate_alerts` job notifies on transitions for HTTP 5xx rate, job
failure rate, overdue queue depth, email bounce rate, webhook failure rate, AI
spend and backup freshness. Each notification names the rule, value and
threshold; it contains no tenant data.

## Severity

| Severity | Definition | Response | Update cadence |
| --- | --- | --- | --- |
| SEV-1 | Data loss, cross-tenant exposure, auth bypass, or the whole product is down | Page on-call immediately; incident commander; freeze deploys | Every 30 minutes |
| SEV-2 | A major surface is broken for many customers (public boards, sign-in, publishing, billing webhooks) | Acknowledge within 15 minutes; owner assigned | Every 60 minutes |
| SEV-3 | A single workspace or non-critical feature is impaired; a workaround exists | Handle in business hours | At resolution |

Security incidents are always SEV-1 until proven otherwise, even when the
functional impact looks small.

## Roles

- **Incident commander (IC):** owns the timeline and decisions. Does not debug.
- **Operations lead:** runs queries, restores service, applies mitigations.
- **Communications lead:** posts status updates and notifies affected owners.
  For a SEV-1 with suspected data exposure, legal/security must be involved
  before any customer-specific detail is shared.

One person may hold several roles on a small team, but the IC must not also be
the only person changing production.

## Detect

1. Uptime monitor on `GET /api/health?scope=readiness` and on one public board
   URL.
2. Cron failures: run `GET /api/cron/jobs?view=history` with the cron secret;
   inspect `job_runs.failed` and the failed-job list.
3. Product **Operations** page for per-product job failures.
4. Aggregate alert transitions (`ALERT_WEBHOOK_URL`, falling back to
   `ERROR_WEBHOOK_URL`), individual error events (`SENTRY_DSN` or the error
   webhook) and provider dashboards (Stripe, Resend, Slack, database host).
5. `/status` backup component: a stale or failed verification is an incident
   before the next migration, not after it.
6. Customer report. Confirm it against a real signal before declaring an
   incident; one customer report is a hypothesis, not a status change.

## First 15 minutes

1. Declare severity and open an incident channel. Record the start time in UTC.
2. Check `/status` and `/api/health?scope=readiness`. Record what they say.
3. Identify the failing dependency with one query each:
   - Database: `SELECT 1` through the app's pool; check provider status page.
   - Queue: latest `job_runs` row (`started_at`, `failed`), oldest pending job.
   - Stripe: webhook delivery attempts and recent `stripe_events` rows.
   - Email: failed `jobs` of type `send_email` / `deliver_notification`.
4. Stop the bleeding before finding root cause: roll back the last deploy,
   pause the scheduler, or disable the failing integration. A reversible
   mitigation beats a perfect diagnosis.
5. Post the first public update within 30 minutes for SEV-1/SEV-2. State what
   is affected and what customers should do; do not speculate about cause.

## Mitigations by failure

### Database unavailable

- Confirm it is the database, not the app: readiness returns `503` while
  liveness returns `200`.
- Check connection limits, disk, and provider status. Kill only sessions you
  can identify as leaked; never mass-terminate connections.
- If a migration caused it, stop and follow the migration runbook. Restore from
  PITR only when forward repair is unsafe.
- The status page stays up during a database outage because each check is
  isolated; use it to confirm recovery.

### Queue stalled or failing

- `job_runs` shows no recent run: the scheduler or its secret is wrong. Verify
  the cron request returns `200` before touching job rows.
- A single job type fails: inspect `last_error` on the failed row from the
  operations surface, fix the cause, and enqueue a replacement with a new
  dedupe key. Do not reset attempts in place.
- A stale `running` lock is reclaimed after ten minutes. Do not delete rows.
- Billing emails are owner-only and deduplicated per event/trial period. A
  failed dunning email is visible as a failed `send_billing_email` job; retry
  by enqueuing the same payload with the same dedupe key after the cause is
  fixed so the owner is not double-charged attention.

### Stripe webhook failure

- Stripe retries signed events. Confirm the endpoint returns `2xx` before
  replaying anything from the dashboard.
- `stripe_events.id` is the idempotency marker. A replay after a successful
  transaction is a no-op; a replay after a failed transaction is the intended
  recovery path.
- If entitlements are wrong, compare `workspace_subscriptions.status` with the
  Stripe subscription. Never edit `workspaces.plan` as a fix; the subscription
  row is the source of truth and the next webhook will overwrite it.
- `invoice.payment_failed` moves the subscription to `past_due`, drops the
  workspace to Free limits, and queues one dunning email. Recovery is a
  successful `customer.subscription.updated` or `invoice.paid` event; confirm
  the workspace returns to its paid plan.

### Email delivery failure

- Check provider status and API key validity. Failed sends are retried with
  backoff; a terminal failure stays visible in the queue.
- Suppressed addresses are intentional. Do not remove a suppression to "make
  the email go"; confirm the customer asked to receive it.
- Billing notices go to owners only and must not be redirected to customers.

### Suspected cross-tenant access or data exposure

1. Treat as SEV-1. Preserve logs and database state; do not delete evidence.
2. Revoke the affected API tokens and rotate secrets.
3. Identify the exact workspaces and records exposed using audited queries.
4. Involve security/legal before notifying customers. Follow contractual and
   statutory timelines.
5. Record every action with timestamps in the incident channel.

## Communicate

- Public updates live on `/status` for service state; do not invent an incident
  history the page cannot verify.
- Affected workspace owners get a direct email for billing or data incidents.
  Use the owner address on file, never a customer address.
- State: what is affected, when it started (UTC), what customers should do, and
  when the next update will be. Avoid root-cause guesses and ETAs you cannot
  keep.
- On resolution, say what was fixed and whether any action is required. Follow
  up with a postmortem for SEV-1/SEV-2 within five business days.

## Postmortem template

```text
Incident:
Severity:
Started / detected / resolved (UTC):
Customer impact and duration:
Affected surfaces and workspaces (counts, not names, in the shared doc):
Detection: which signal fired, and how long before a human responded?
Timeline: timestamped actions and decisions.
Root cause: the technical cause, not "human error".
Contributing factors: missing test, alert, guardrail or documentation.
What went well:
What made it worse:
Action items: owner, due date, and a verification method for each.
```

Action items are not complete until the fix has a test, alert or runbook step
that would catch the same failure again.

## Drill schedule

- Daily (automatic): `verify_backups` inventories storage, samples attachment
  checksums, writes and re-reads a manifest, and records freshness. Review a
  degraded `/status` backup component as an incident.
- Quarterly: restore the latest database backup **and the matching storage
  snapshot** into isolated infrastructure and verify sign-in, a public board, a
  feedback request, a conversation, an attachment download and the latest
  migration. A database-only restore is not a complete restore.
- Quarterly: simulate a failing email provider and confirm retries, terminal
  failures and the operations dashboard.
- Before each paid launch: exercise the Stripe webhook path with a test clock,
  including `invoice.payment_failed` and recovery.
- After every drill: update this runbook with what was wrong or missing.
