# Operations runbook

This runbook covers the production database, background jobs, deletion
requests and the alerts that must be wired before a paid launch.

## Daily health checks

| Signal | Where | Expected |
| --- | --- | --- |
| Liveness | `GET /api/health` | `200` and no database dependency |
| Readiness | `GET /api/health?scope=readiness` | `200`; database and storage `ok`; email, backups and queue reported |
| Cron runner | `GET /api/cron/jobs` with `Authorization: Bearer $CRON_SECRET` | `200`; `claimed` may be zero |
| Failed jobs | Cron response `failedJobs` or product **Operations** | No `failed` jobs older than one run |
| Queue runs | `GET /api/cron/jobs?view=history` | A recent run every scheduler interval |
| Email delivery | Analytics → Email delivery, or subscriber delivery log | Failed rate under 2%; provider errors visible |
| Backup verification | `/status` backup component, or the newest `backup_verifications` row per kind | `ok` and under `ALERT_BACKUP_MAX_AGE_HOURS` (26 by default) |
| Public surfaces | Board, request, roadmap, changelog, widget embed | `200`, no server error, expected canonical URL |
| Public status | `GET /status` | `200`; component states match the readiness, storage, queue and backup checks |

Point an external uptime monitor at `/api/health?scope=readiness` and at one
public board. Send `ERROR_WEBHOOK_URL` and `ALERT_WEBHOOK_URL` to the on-call
channel. The scheduled `evaluate_alerts` job already covers the aggregate rules
(5xx rate, job failure rate, overdue queue depth, email bounce rate, webhook
failure rate, AI spend and backup freshness; see
[observability.md](observability.md)). Keep provider-level alarms for two
consecutive readiness failures, a failed migration, a Stripe webhook outage and
an expired TLS certificate. Do not alert on individual customer 4xx responses.

Error tracking uses `SENTRY_DSN` when set and falls back to
`ERROR_WEBHOOK_URL`. Release tags and source-map upload are documented in
[observability.md](observability.md).

## Alert thresholds and on-call

The scheduled `evaluate_alerts` job runs at most once per five-minute bucket
from `/api/cron/jobs`. Each rule is transition-only: a firing alert notifies
once, a recovery notifies once, and a value that stays bad does not repeat
every five minutes. Thresholds are environment-tunable and clamped; the
defaults below are the contract, not a suggestion. The arithmetic and the
minimum-sample guard are covered by `tests/observability-config.test.ts`.

| Rule | Window | Fires when | Minimum sample | Variables | Response |
| --- | --- | --- | --- | --- | --- |
| `http_5xx_rate` | 15 min | More than 2% of instrumented requests are 5xx | 20 requests | `ALERT_5XX_RATE_PCT`, `ALERT_MIN_REQUESTS` | Page. Check `/status`, the slowest routes on `/app/admin`, then the last deploy. |
| `job_failure_rate` | 30 min | More than 10% of claimed jobs failed | 5 claims | `ALERT_JOB_FAILURE_RATE_PCT`, `ALERT_MIN_JOB_CLAIMS` | Page. Open Operations for the failed job type and first error. |
| `queue_depth` | now | More than 50 pending jobs are more than 10 minutes overdue | 1 | `ALERT_QUEUE_DEPTH`, `ALERT_QUEUE_AGE_MINUTES` | Page. Check the scheduler and the database before the worker. |
| `email_bounce_rate` | 24 h | More than 2% of sent + bounced + complained messages bounced or complained | 20 deliveries | `ALERT_EMAIL_BOUNCE_RATE_PCT`, `ALERT_MIN_DELIVERIES` | Ticket next business day. Use [deliverability.md](deliverability.md); suppress hard bounces immediately. |
| `webhook_failure_rate` | 1 h | More than 5% of succeeded + failed deliveries failed | 20 attempts | `ALERT_WEBHOOK_FAILURE_RATE_PCT`, `ALERT_MIN_WEBHOOK_ATTEMPTS` | Ticket. Check the customer's endpoint and the delivery log; do not replay blindly. |
| `ai_daily_spend` | 24 h | Estimated spend is over $25 | 1 | `ALERT_AI_DAILY_USD`, `AI_INPUT_USD_PER_MTOK`, `AI_OUTPUT_USD_PER_MTOK` | Ticket. Check Juno volume and model pricing; the figure is an estimate, not an invoice. |
| `backup_freshness` | latest check | A database, storage or manifest verification failed, or the oldest success is over 26 hours old | 1 | `ALERT_BACKUP_MAX_AGE_HOURS` | Page if a verification failed. Data-loss risk: run `verify_backups` by hand and inspect storage. |

An empty window is healthy with an explicit "no observations" detail. A rate
below its minimum sample does not page on one request; that is a guard against
noise, not a reason to lower the minimum.

### On-call expectations

These are the operating expectations for a deployment that sells a paid plan.
They are policy, not code; a solo deployment may collapse the roles, but it
should still write down who does what.

- **Primary on-call** acknowledges a page within 15 minutes, day or night.
  **Secondary** is paged if the primary has not acknowledged within 30
  minutes. A SEV1 (data loss, cross-tenant exposure, total outage) gets an
  incident commander and a public status update; severity and communications
  are in [incidents.md](incidents.md).
- **Ticket-level alerts** (`email_bounce_rate`, `webhook_failure_rate`,
  `ai_daily_spend`) are triaged on the next business day. They are not paging
  rules and do not justify waking someone up for a single customer's endpoint.
- **Handoff** at the start and end of every shift: open incidents, firing
  alerts, the last deploy, pending migrations and any silenced rule with its
  reason. A silenced rule without a ticket is an outage waiting to be missed.
- **Alerts contain no tenant data.** The payload has a rule, value, threshold,
  release and environment. Never paste a customer email, request body or
  provider error string into the alert channel or an incident update; put the
  request id in the channel and read the record in the dashboard.
- **Tune, do not disable.** A threshold change is an environment change and a
  reviewed deploy. Record the reason and the date. Deleting `alert_states` to
  clear a notification resets the transition and hides the next recovery, so
  do not do it.
- **Test the channel.** Send a synthetic payload shaped like the real alert
  (no tenant data) to `ALERT_WEBHOOK_URL` before launch, after changing the
  paging integration and quarterly. A channel that has never delivered a test
  is not a paging path. `bun run alerts:test` posts a synthetic `alert_test`
  payload to `ALERT_WEBHOOK_URL`, or to `ERROR_WEBHOOK_URL` when the dedicated
  channel is unset; it never prints the URL and exits non-zero when delivery
  fails. A successful run proves endpoint delivery only; it does not prove the
  scheduled `evaluate_alerts` job has run.
- **Recovery is automatic.** The next clean evaluation sends the recovery
  transition. Do not manually mark an alert resolved; if the signal is still
  bad, the rule will fire again on the next transition.
- **Provider alarms stay provider-side.** Two consecutive readiness failures, a
  failed migration, a Stripe webhook outage and an expired TLS certificate are
  monitored where they are visible, not inferred from application 5xx.

## Required outbound egress filtering

Production **must** route server-originated webhook traffic through an egress
proxy or firewall that resolves each destination once, pins the resolved public
address for the connection, and refuses private IPv4/IPv6, loopback,
link-local, unique-local, carrier-grade NAT and cloud metadata ranges. It must
re-check the destination on every redirect. Herald validates the literal URL
and refuses private hosts, and it disables redirects during delivery, but it
does not resolve and pin DNS in-process: a hostname that passes validation can
still rebind to an internal address before `fetch` connects. Without the egress
control, this is an SSRF gap, not an optional hardening step. Apply the same
rule to any future outbound integration that accepts a customer-supplied URL.

## Database connections and pool sizing

The application opens one `pg` pool per process (`src/db/index.ts`, settings in
`src/db/pool-settings.ts`). Every serverless instance builds its own pool, so the
connection count the database sees is `app instances × DATABASE_POOL_MAX` — not
the value of one pool.

| Setting | Default | Notes |
| --- | --- | --- |
| `DATABASE_POOL_MAX` | 10 | Clamped to 1–50; the only knob to change |
| `idleTimeoutMillis` | 30 s | Idle clients are released instead of held |
| `connectionTimeoutMillis` | 10 s | A request fails fast instead of hanging |
| `application_name` | `herald-app` | Identify app sessions in `pg_stat_activity` |

Size against the provider's **pooled** endpoint limit, and leave headroom for
migrations, cron workers and the readiness probe:

```
DATABASE_POOL_MAX = floor(0.8 × pooled connection limit ÷ expected app instances)
```

| App instances | `DATABASE_POOL_MAX` | App connections |
| --- | --- | --- |
| 1 | 10 (default) | 10 |
| 5 | 10 | 50 |
| 10 | 5 | 50 |
| 20 | 4 | 80 |

Read the pooled limit from the provider's console rather than assuming a plan
number; it changes with the plan and the compute size. Connect through the
pooler (`-pooler` host on Neon), never directly to the primary from a
serverless function. Symptoms of an undersized database limit are
`too many clients` / `remaining connection slots are reserved`; symptoms of an
oversized per-instance pool are the same errors with a healthy per-instance
pool. Lower `DATABASE_POOL_MAX` first — it takes effect on the next deploy and
needs no provider change.

## Slow-query logging and alerting

Every statement that runs on a pooled client is timed
(`src/db/query-timing.ts`). Two thresholds apply:

| Variable | Default | Effect |
| --- | --- | --- |
| `SLOW_QUERY_MS` | 200 | Log a `db.slow_query` warning |
| `SLOW_QUERY_ALERT_MS` | 1000 | Also report through `ERROR_WEBHOOK_URL` |

Thresholds are clamped to 1 ms–10 min, and the alert threshold is raised to the
log threshold if configured lower. A slow statement logs at most once per
10 seconds with the same normalised text, so one pathological query under load
does not flood the log; an alert-threshold statement always reports. The logged
statement is the SQL `pg` received, with `$n` placeholders and no parameter
values, truncated to 300 characters, so customer data is not copied into logs or
alerts.

`ERROR_WEBHOOK_URL` is the existing unhandled-error channel; a slow-query alert
arrives there as `db.slow_query` with `durationMs` and `statement`. Route it to
the same on-call destination as error reports. Use `pg_stat_statements` for
aggregate trends; this log is for catching the individual regression a budget
run did not cover.

## Signup funnel

Company signup analytics live in `signup_funnel_events`, separate from
workspace product analytics. They contain five stages, a UTC timestamp and a
one-way subject hash; no email, IP address, user agent, workspace id or account
id is stored. Read the aggregate report with:

```bash
bun run analytics:signup-funnel --days=30
```

The CLI prints counts and step rates only. The 400-day retention window runs
with the daily `prune_audit_events` job. Read
[docs/signup-funnel-privacy.md](signup-funnel-privacy.md) before changing a
field, adding a vendor or exposing a dashboard.

## Incident response

Severity, roles, communications, mitigations and the postmortem template live
in [docs/incidents.md](incidents.md). The public status page at `/status`
derives its component states from live checks: Postgres readiness, a storage
write/read probe, the age and outcome of the last background worker run plus
overdue queue depth, email delivery outcomes in the last 24 hours, and backup
verification freshness. It is generated, not edited by hand; if a manual maintenance
notice is needed, announce it through the incident channel and keep the
automated checks visible. The page never shows workspace names, customer data,
payloads or provider error strings.

## Backups and point-in-time recovery

The application uses PostgreSQL and stores attachment metadata in the database,
with bytes behind the storage driver. **A database-only restore is not a
complete restore**: attachment rows would point at objects that no longer exist.
The database and the storage driver must be backed up and restored together, to
the same point in time.

### Automated verification

`verify_backups` runs daily through `/api/cron/jobs` (the dedupe key is the UTC
date) and is safe to run by hand:

1. inventories object storage and re-reads a deterministic sample of up to 20
   attachment objects, verifying each checksum;
2. records database size, migration count and key table row counts;
3. writes `backups/manifests/<date>/<uuid>.json` into object storage, reads it
   back and verifies its SHA-256;
4. writes `database`, `storage` and `manifest` rows to `backup_verifications`.

The `/status` backup component reports the oldest of the latest result for
each of those three kinds, and the `backup_freshness` alert fires when the
newest success is older than
`ALERT_BACKUP_MAX_AGE_HOURS` (26 h) or the latest attempt failed. This is a
freshness and integrity check, not a substitute for restoring the provider
backup.

Run the same check by hand with `bun run backups:verify`. It exits non-zero
when the database, storage or manifest check fails, prints the result and
writes the same `backup_verifications` rows. It also exits non-zero when those
rows cannot be written, even if the integrity checks passed: `/status` and the
`backup_freshness` alert read the rows, so a successful check that leaves no
record would silently keep showing stale data. A green result still does not
exercise the provider's PITR restore path.

### Database PITR

1. Enable the provider's automated daily backups and point-in-time recovery
   (PITR) before accepting customer data. On Neon, enable history retention on
   the production branch and record the retention window here and in the
   incident log.
2. Record the restore point (timestamp) before a migration or a risky backfill.
3. A restore drill is still required: restore the latest backup into an
   isolated database, point a staging app at it and verify sign-in, one public
   board, one feedback request, one conversation, one attachment download and
   the latest migration. Do this quarterly **and** after changing the provider
   or the PITR window.

### Storage driver PITR

Object storage needs its own point-in-time capability:

- **Bucket/cloud driver:** enable object versioning (or the provider's
  soft-delete/retention feature) and a scheduled snapshot or replication
  policy. Record the retention window. A versioned bucket lets a restore pick
  object versions as of the database restore timestamp instead of the latest
  bytes.
- **Local driver (`STORAGE_DIR`):** snapshot the directory with the host's
  filesystem/volume snapshot on the same schedule as the database, or copy it
  to a separate bucket. A serverless host's local filesystem is ephemeral and is
  not a backup.
- Restore the database and storage to the **same timestamp**. Attachment
  metadata and object bytes must agree; restoring each to a different time can
  leave rows pointing at missing or newer objects.
- After a storage restore, re-run `verify_backups` (or the same checks by hand)
  and confirm the database, storage and manifest rows are `ok`.
- The manifest written by the job records the object count, total bytes and
  sampled checksums. Keep manifests long enough to compare a restore against
  the state that was verified.

A backup that has never been restored is not evidence. Record every drill with
its date, restore point, verified migration tag and attachment checksum result
in the drill log below.

## Migration runbook

Migrations are forward-only and apply through `bun run db:migrate`. The
integration harness applies every SQL file from `drizzle/meta/_journal.json` to a
disposable database, so run it before production:

```bash
bun run test:integration
bun run db:migrate
```

1. Take/verify a PITR point immediately before a production migration.
2. Apply to staging and run the integration suite against the migrated schema.
3. Apply to production during a low-traffic window. Never edit an applied
   migration; create a new one.
4. If a migration fails, stop. Inspect the first error; do not rerun a partially
   applied file. Restore from PITR or apply a reviewed forward fix.
5. Enum additions are additive; the new values cannot be used in the same
   transaction that adds them. Keep data backfills in a later statement or job.
6. The analytics migration adds `pg_trgm`, public-board/roadmap partial indexes,
   inbox indexes and the status-history trigger. On a large table, use
   `CREATE INDEX CONCURRENTLY` in a separately reviewed migration instead of
   accepting a write lock.

### Release cover storage

Release covers are objects in the storage module; a release row keeps only the
generated key, and reads sign a short-lived URL. A database that predates the
change may still hold base64 `data:` URLs in `releases.cover`. The migration
that adds `releases_cover_inline_ck` and `release_revisions_cover_inline_ck`
validates existing rows, so convert them first:

```bash
bun run db:migrate-release-covers   # decode, validate, store, rewrite the row
bun run db:migrate                  # then apply the check constraints
```

The script is idempotent, never touches a row without a `dataUrl`, and exits
non-zero listing every row it could not convert (an unrecognised or
unsupported payload is left in place for a human). The constraints reject a
`data:` or `blob:` value in `releases.cover`, `release_revisions.cover`,
`user.image`, `workspace_branding.logo_key` and both attachment `storage_key`
columns, so a new inline image cannot be persisted again.

## Dependency upgrades

Dependabot proposes the updates ([.github/dependabot.yml](../.github/dependabot.yml)):
patches and minors arrive as two separate grouped pull requests on the weekly
run. The `Dependabot auto-merge` workflow enables GitHub's auto-merge for
**patch** updates only; the merge itself waits for the status checks that branch
protection requires on `main`, so `checks` (typecheck, lint, unit, integration,
build) and `audit` must both be required there. Until that rule exists the
workflow must stay disabled — with no required checks, auto-merge merges at
once, and the repository must allow auto-merge (Settings → General). Minor,
major and security updates are reviewed by hand.

Every upgrade, whatever its size:

```bash
bun install
bun run typecheck && bun run lint && bun run test:unit
bun run build && bun run test:smoke      # smoke needs TEST_DATABASE_URL
bun run test:integration
bun audit                                # new advisory → docs/security-review.md
```

### Next.js

- Move `next` and `eslint-config-next` together; they ship in lockstep.
- Read the release notes for routing, caching and proxy changes.
  [src/proxy.ts](../src/proxy.ts) owns request hardening, so a runtime or
  file-convention change (middleware → proxy in 16) is a code change, not a
  config change.
- Re-check `next.config.ts`: `serverExternalPackages: ["pg"]` must stay (the
  driver resolves optional native code at runtime), and the recorded
  `agentUpgrade: "security"` guidance should be re-read with
  `bunx next upgrade --agent=security`.
- Re-run `tests/integration/csp-surfaces.test.ts`; it fails when a new build
  references a host the CSP does not allow, and asserts the framing and
  `Permissions-Policy` headers on six routes.
- Run `bun run test:smoke` for the streaming-boundary check.

### Better Auth

`better-auth`, `@better-auth/scim` and `@better-auth/sso` move together on the
same minor. Then diff the installed package's core schema against
[src/db/schema/auth.ts](../src/db/schema/auth.ts):

```bash
bun run check:auth-schema
```

[scripts/check-auth-schema.ts](../scripts/check-auth-schema.ts) reads
`getSchema()` from `better-auth/db` and compares every core table (`user`,
`session`, `account`, `verification`) with the Drizzle exports: property names,
presence and column type. It exits non-zero on drift. On a finding:

1. Update the table or field. The export names above and the camelCase property
   names are load-bearing — the adapter keys off them, not the SQL names.
2. `bun run db:generate`, review the SQL, and apply it through the migration
   runbook above.
3. Update the "Verified against better-auth X.Y" note in the schema file.

Finish with `tests/integration/customer-auth.test.ts`,
`enterprise-identity.test.ts` and `customer-session.test.ts`.

### Drizzle

`drizzle-orm` and `drizzle-kit` move together. After the bump:

```bash
bun run db:generate   # must report no schema changes
```

A generated migration with no schema edit means the upgrade changed the snapshot
or the SQL generator: review it before committing, and never edit an applied
migration. `bun run test:integration` applies every committed migration to a
disposable database from zero, which is the regression test for the migration
set; then apply with `bun run db:migrate` against staging.

### Recording the result

An upgrade is finished when the lockfile, the migrations and the docs agree:
note the version move and the commands above in the pull request, and add a line
to [docs/security-review.md](security-review.md) when the audit picture changes.

## Drill log

| Date | Drill | Result |
| --- | --- | --- |
| 2026-11-04 | Restore: `pg_dump -Fc` a disposable Postgres 16 database (35 migrations, 1 workspace, 1 product, 1 board, 5 requests, 5 status rows), drop and recreate it, then `pg_restore --no-owner --no-acl`. | Passed. The 321,571-byte dump restored with identical row counts and request-title MD5 (`7e66237b67b82c89a6eb1ce85c37e94a`); the migration table still held 35 rows. |
| 2026-11-04 | Migration: migrate a fresh database from zero, then rerun `bun run db:migrate` against the restored copy. | Passed. All 35 migrations applied; the rerun reported success with no pending work. |

This exercises the local dump/restore and forward-only migration procedure. It
does not exercise the hosting provider's PITR window; repeat step 3 of the
backup section against the provider before accepting customer data.

## Log retention and redaction

- Application logs are JSON lines and live in the log drain for **30 days**.
  Error events at a Sentry-compatible collector are retained for **90 days**.
  The database retention windows are listed in
  [observability.md](observability.md#log-retention).
- Every log line and error event passes through
  `src/lib/observability/scrub.ts`: credential-shaped keys are replaced and
  string values lose emails, bearer tokens, JWTs, cookie values, secret query
  parameters, IP addresses, phone numbers and Luhn-valid card numbers.
- `tests/log-redaction-audit.test.ts` is the regression gate. Add a realistic
  payload to its corpus whenever a new field type is logged; do not weaken the
  assertions to make a failing case pass.
- Never log request bodies, headers, cookies, tokens or full customer records.
  A field that only exists for debugging belongs in a local reproduction, not a
  permanent log line.

## Deletion and retention

- An owner requests workspace deletion in **Settings → Privacy**. The request is
  visible only to that owner and starts a 30-day grace period.
- `purge_workspaces` runs daily through the cron endpoint. It deletes only
  uncancelled requests whose `purge_after` has passed. The audit row is recorded
  before the cascade and is intentionally not FK-bound, so it survives.
- Cancelling marks the request cancelled; the workspace remains available and a
  later re-request starts a fresh 30-day period.
- `prune_audit_events` deletes audit rows older than 365 days. Adjust the
  constant only with a documented retention decision.
- Customer erasure is owner-only and deletes the customer row; cascading records
  (sessions, votes, followers, in-app notifications) go with it. Content whose
  author FK is `set null` remains for the workspace's record.
- Exports are generated on demand at
  `/api/app/{workspaceSlug}/export` and are `private, no-store`.

## Background jobs

The queue is `jobs`; every runner invocation writes `job_runs`. The product
**Operations** page shows only jobs whose payload carries that product id and
never exposes payloads. `/api/cron/jobs` is the scheduler entry point. Run it at
least once per minute; daily jobs are deduplicated by UTC date:

- `recalculate_analytics` — recomputes the trailing two days for every product.
- `purge_workspaces` — applies the deletion grace period.
- `prune_audit_events` — enforces audit retention.
- `send_billing_email` — sends one owner-only trial-ending or dunning notice,
  deduplicated by trial period or Stripe event id. A failed notice stays visible
  in the failed-job view; re-enqueue only after fixing the cause.
- `send_onboarding_emails` — sends at most one paced account tip per eligible
  user per sweep. It is safe to run repeatedly; see the onboarding section above.

A job that exhausts attempts is terminal and appears in the failed view. Fix the
cause, then enqueue a replacement with a new dedupe key; do not reset attempts
blindly. A stale `running` lock is reclaimed after ten minutes.

## Account onboarding email

The four account tips (welcome, first board, first release, widget installed)
are sent by `send_onboarding_emails`, enqueued at most once every five minutes.
The sequence uses observed workspace/release/widget milestones, a 20-hour gap,
a unique `(user_id, kind)` ledger and the account-level opt-out at
`/app/account#email-preferences`. Accounts created before 2026-11-22 are
excluded. The full sequence, testing commands and failure handling are in
[docs/onboarding-emails.md](onboarding-emails.md).

A failed send leaves a `failed` ledger row, makes the job retry, and shows up as
a failed email job on `/status`. Do not delete the row to force a resend; fix the
provider or configuration and let the sweep retry.

## Win-back campaign operations

A campaign is a separate, approval-gated audience; publishing a release never
starts one.

1. **Import cancellations.** `POST /api/app/{workspaceSlug}/{productSlug}/winback/import`
   accepts a CSV with an `email` column and optional `name`, `external_id`,
   `cancelled_at`, `reason` and `feedback`. The import is idempotent on
   `(customer_account_id, cancelled_at)`; a file without `cancelled_at` reuses
   the account's latest cancellation, so replaying an export does not create a
   second event. Invalid rows are counted, and a customer who opted out stays
   opted out.
2. **Review the snapshot.** The audience contains only cancelled customers that
   are explicitly eligible, have a valid address, and are not opted out,
   unsubscribed, suppressed, or already contacted by a started campaign.
   Excluded rows keep a visible reason.
3. **Approve before sending.** A draft must be submitted and approved by a role
   holding `winback:approve`. Approval and sending also require a workspace
   sender identity with a verified From address, a verified reply-to address
   when one is set, a From name and a physical mailing address; the deployment
   `EMAIL_FROM` fallback is not sufficient for a campaign. Verification is a
   single-use link sent to the mailbox from Settings → Sender identity.
4. **Test the message.** The campaign page can send a `[Test]` copy to one
   address. It uses the real sender identity and rendered campaign but writes no
   delivery or recipient row and does not change the campaign status; it is
   rate-limited to five attempts per user per minute and refuses a stopped
   campaign, an unpublished linked release or a suppressed address.
5. **Send a canary first.** Approved sending starts with at most five
   recipients (`WINBACK_CANARY_SIZE`). The campaign moves to `sending`, and the
   remaining audience stays refused until every canary recipient leaves
   `pending`/`queued`. Sending rechecks eligibility, opt-out and suppression,
   then writes one `notification_deliveries` row per recipient with the unique
   key `winback:{campaignId}:{customerAccountId}`; repeating the request does
   not create a second delivery. The delivery worker repeats the suppression,
   eligibility, opt-out and published-release checks immediately before the
   provider call.
6. **Release the rest.** Once the canary settles, “Send remaining audience”
   queues the rest with the same dedupe keys. A link to a draft release blocks
   both the canary and the remaining send.
7. **Stop if anything looks wrong.** “Stop campaign” (`winback:approve`,
   audited as `winback.campaign_stopped`) is irreversible for the remaining
   audience: pending recipients become `campaign_stopped` exclusions, queued
   deliveries become `skipped`, and the worker refuses a stopped campaign. It
   cannot stop a campaign that already finished sending.
8. **Watch delivery and returns.** The campaign page shows recipient status,
   provider attempt count, error text, exclusions, canary progress and bounces.
   A return may be recorded only after a recipient was sent and only inside the
   30-day window after `sent_at`; older sends show “Window closed”. `inferred`
   means the customer reconverted after the campaign, while `confirmed` is the
   only basis for a causal claim. Bounces and complaints suppress the address
   and update the recipient.
9. **Recover failures.** A terminal delivery failure marks the recipient
   `failed` and the campaign `partially_sent` or `sent` once no pending work
   remains. Do not reset `send_status` to retry a campaign: inspect the
   pending/failed deliveries and let the normal `deliver_notification` worker
   finish them. Queue another campaign only after the cause is fixed.

A real provider test send still requires `RESEND_API_KEY` and a verified From
address; without them the app reports the configuration error instead of
claiming a send. Approval and sending are never started by a release publish.

## Email deliverability

Warm-up, reputation monitoring, blocklist recovery, suppression handling,
quiet-hour deferrals, retry policy and rendering checks are documented in
[deliverability.md](deliverability.md). Use that runbook before a new domain or
campaign sends, and during any bounce or complaint incident.

## Secret rotation

Use the provider's rotation procedure and deploy the new value; never paste a
secret into chat, a migration, a screenshot or a client bundle. Rotate
`BETTER_AUTH_SECRET` with a planned sign-out window, `CRON_SECRET` after updating
the scheduler, `EMAIL_INBOUND_SECRET` with a normalized inbound adapter,
`RESEND_INBOUND_WEBHOOK_SECRET` and `RESEND_WEBHOOK_SECRET` after recreating the
corresponding Resend webhooks, webhook signing secrets per integration, and
provider API keys at the provider. Verify one request after each rotation and
 revoke the old value.
