# Self-hosting Herald

Herald is a Next.js application over PostgreSQL. A deployment is one
application process (or several identical ones), a Postgres database, a
persistent directory for uploaded bytes, and a scheduler that calls the cron
endpoints. There is no message broker, no second application server and no
Redis requirement: the job queue and rate limits are tables in Postgres.

This guide is for an operator who is comfortable with a reverse proxy, a
process manager and database backups. It is not a one-click installer, and no
official container image or Terraform module ships with the repository.

## Topology

```text
browser ──► TLS reverse proxy ──► Next.js process(es) ──► PostgreSQL
                                        │
                                        └──────────────► STORAGE_DIR
scheduler ──► /api/cron/* with CRON_SECRET
```

- **Application:** `bun run build` writes `.next`; run it with
  `bun run start` (or the platform's Node runtime running the same output).
  The repository's build and start scripts use Bun; the built output also runs
  on Node 20.9+.
- **Database:** PostgreSQL 14+, reachable through a pooled endpoint when the
  host opens many short-lived connections. The schema and migrations live in
  `drizzle/`.
- **Storage:** the only shipped driver writes to a local directory
  (`STORAGE_DIR`, default `.storage/`). See [Storage](#storage) before choosing
  a serverless host.
- **Scheduler:** any cron that can send an HTTP request with a bearer token.
  Minimum: every minute. The jobs dedupe daily work by UTC date.

Multiple application instances are supported: job claiming uses
`FOR UPDATE SKIP LOCKED`, rate limits are durable, and sessions live in the
database. Two instances must share the database and the storage directory (or
mount the same volume).

## Environment matrix

`.env.example` is the canonical, commented list. The table below groups what
an operator must decide; it is not a complete copy.

### Required

| Variable | Why |
| --- | --- |
| `DATABASE_URL` | Postgres connection string. Use the pooler endpoint when the host provides one. |
| `BETTER_AUTH_SECRET` | Signs sessions and storage URLs. At least 32 characters. Rotating it signs everyone out and invalidates outstanding signed object URLs. |
| `BETTER_AUTH_URL` | Canonical public origin, no trailing slash. Wrong value breaks callbacks and redirects. |

### Operational

| Variable | Default | Notes |
| --- | --- | --- |
| `CRON_SECRET` | unset | Bearer secret for every `/api/cron/*` endpoint. While unset they answer `503` and do no work. |
| `DATABASE_POOL_MAX` | 10 | Per process. Keep `instances × pool` under the provider's pooled limit; see [operations.md](operations.md#database-connections-and-pool-sizing). |
| `STORAGE_DIR` | `.storage/` | Must be a persistent, writable volume. |
| `PUBLIC_PAYLOAD_TTL_SECONDS` | 60 | Cache for immutable public release/help payloads; `0` disables. |
| `FLAG_PUBLIC_FEEDBACK`, `FLAG_WIDGET`, `FLAG_API` | on, on, off | Deployment kill switches, not entitlements. A plan still gates the feature. |
| `API_IDEMPOTENCY_TTL_HOURS` | 24 | Replay window for `Idempotency-Key`, 1–168. |

### Email

| Variable | Effect when unset |
| --- | --- |
| `RESEND_API_KEY` + `EMAIL_FROM` | Email is disabled; pending deliveries fail with a clear message. Set both or neither. |
| `RESEND_WEBHOOK_SECRET`, `RESEND_INBOUND_WEBHOOK_SECRET` | Signed delivery/inbound events answer `503`. |
| `EMAIL_INBOUND_DOMAIN`, `EMAIL_INBOUND_SECRET` | No generated support addresses; normalized inbound `401`. |
| `EMAIL_WEBHOOK_SECRET` | Normalized delivery batch `401`/`503`. |

`EMAIL_API_URL` exists to point the adapter at a Resend-compatible endpoint or
a local test server; leave it unset in production.

### AI, moderation and observability

| Variable | Effect when unset |
| --- | --- |
| `AI_API_URL` + `AI_MODEL` (+ `AI_API_KEY` if required) | AI drafting explains it is not configured and Mira cannot generate. |
| `AI_EMBEDDING_MODEL` | Deterministic local `herald-hash-v1` embeddings; document text stays in the app. Changing it requires re-ingesting sources. |
| `OCR_API_URL` (+ `OCR_API_KEY`) | Image moderation checks are recorded as unavailable; a board that requires scanning refuses unscanned images. |
| `SENTRY_DSN` | Errors go to `ERROR_WEBHOOK_URL` instead. |
| `ALERT_WEBHOOK_URL` | Alerts fall back to `ERROR_WEBHOOK_URL`; with neither, transitions are only logged. |
| `ERROR_WEBHOOK_URL` | Unhandled errors and slow-query alerts are logged only. |

Slow-query and alert thresholds are documented in
[operations.md](operations.md#slow-query-logging-and-alerting) and
[operations.md](operations.md#alert-thresholds-and-on-call).

### Billing

Stripe variables are optional unless you sell plans. With them unset, the
billing screens explain that checkout is not configured; plan entitlements
still come from the workspace's subscription row, never from the UI.

## Storage

`src/features/storage/index.ts` selects the local provider. It has no cloud
driver today; `StorageProvider` in `src/features/storage/types.ts` is the seam
for one (put/get/delete/list/health). Consequences:

- **A serverless host with an ephemeral filesystem loses uploads on redeploy.**
  Mount a persistent volume at `STORAGE_DIR`, run on a host with a real disk,
  or implement the driver interface and verify `health()`.
- Object URLs are signed with a key derived from `BETTER_AUTH_SECRET`.
  Rotating that secret invalidates every outstanding URL, including release
  covers and attachment downloads; new reads sign new URLs.
- Back up the directory and the database **together**. A database-only restore
  leaves attachment rows pointing at missing bytes. See
  [operations.md](operations.md#backups-and-point-in-time-recovery).
- `verify_backups` inventories objects, re-reads a sample and verifies
  checksums, so a broken mount is visible on `/status` rather than at the
  first customer download.

## Migrations

Migrations are forward-only and never run at process startup.

```bash
bun run db:migrate      # apply every pending migration
```

A release procedure that does not corrupt data:

1. Take or verify a PITR restore point.
2. Apply to staging, then run `bun run test:integration` against the migrated
   schema. `bun run migration:drift` compares a from-zero build with the
   previous release plus every migration since.
3. Apply to production in a low-traffic window with the new application
   artifact ready but not yet serving.
4. Start the new artifact, check `/api/health?scope=readiness`, then remove the
   old one.

Enums are additive and a new enum value cannot be used in the same transaction
that adds it; keep backfills in a later statement or job. Never edit an applied
migration. If a migration fails, stop and read the first error; do not rerun a
partially applied file.

## Cron and background work

All scheduled endpoints authenticate with `Authorization: Bearer $CRON_SECRET`
compared in constant time.

| Endpoint | Cadence | Purpose |
| --- | --- | --- |
| `/api/cron/jobs` | every minute | Claims due jobs (email, notifications, imports, crawls, CRM sync, analytics, purges, retention, alerts, backup verification). |
| `/api/cron/publish-releases` | every minute | Publishes scheduled releases whose time has arrived. |
| `/api/cron/webhooks` | every minute | Delivers outbound webhooks with backoff. |
| `/api/cron/weekly-digest` | daily | Sends the digest to daily and weekly subscribers. |

A stale `running` job lock is reclaimed after ten minutes. Daily jobs dedupe
by UTC date. A job that exhausts attempts is terminal; fix the cause and
enqueue a replacement with a new dedupe key instead of resetting attempts.

If the scheduler stops, the site keeps serving reads and writes but scheduled
releases do not publish, email does not send and backups are not verified.
Alert on a missing `job_runs` row; the `backup_freshness` rule catches the
backup half.

## Health and observability

| Probe | Meaning |
| --- | --- |
| `GET /api/health` | Liveness. Touches nothing; use it for the process supervisor. |
| `GET /api/health?scope=readiness` | `SELECT 1`, a storage write/read/unlink probe, email configuration, queue age and backup freshness. Database or storage failure is `503`; email, queue or backups are reported as degraded. |
| `GET /status` | The public status page, built from the same readiness report. |

Point an uptime monitor at readiness and at one public board. The scheduled
`evaluate_alerts` job covers 5xx rate, job failures, queue depth, email
bounce rate, webhook failures, AI spend and backup freshness. Thresholds and
on-call expectations are in [operations.md](operations.md#alert-thresholds-and-on-call).

Logs are JSON lines and pass through the scrubber in
`src/lib/observability/scrub.ts`. Retain them for 30 days; error events for 90.
Do not log request bodies or headers.

## Security checklist

- Terminate TLS at the proxy and forward the canonical host. `BETTER_AUTH_URL`
  must match the public origin exactly.
- Route outbound webhook traffic through an egress proxy or firewall that
  pins DNS and refuses private, loopback, link-local, CGNAT and metadata
  ranges, and re-checks every redirect. Herald validates the literal URL and
  disables redirects during delivery, but does not pin DNS in-process. Without
  the egress control this is an SSRF gap (see
  [operations.md](operations.md#required-outbound-egress-filtering)).
- Keep `CRON_SECRET`, `BETTER_AUTH_SECRET`, provider keys and `EMAIL_*`
  secrets out of the client bundle, logs and screenshots. Nothing in `.env`
  is prefixed `NEXT_PUBLIC_` for a reason.
- Rotate a secret by deploying the new value and verifying one request, then
  revoking the old one. Rotating `BETTER_AUTH_SECRET` signs everyone out;
  plan a window.
- Restrict dashboard access with workspace roles; `INTERNAL_ADMIN_EMAILS`
  gates `/app/admin` and cannot be granted by a workspace role. An empty list
  makes the page a 404.

## Upgrade path

1. Read `docs/operations.md#dependency-upgrades` for the package-specific
   steps (Next.js, Better Auth, Drizzle).
2. Update the lockfile with `bun install`; run typecheck, lint, unit tests and
   the build.
3. Build the new artifact. Do not build on the production host while it is
   serving if the host cannot do so atomically.
4. Take a restore point, apply migrations, deploy, then watch readiness, 5xx,
   job failures and email delivery for one scheduler interval.
5. Roll back by redeploying the previous artifact **and** restoring the
   database and storage to the same timestamp. There are no down migrations;
   an application rollback alone can run old code against a newer schema.

A rollback is a restore, not a `git revert` of a migration. Record the restore
point in the incident log.

## Known limits

- No official Docker image or infrastructure-as-code ships here. The build is
  a standard Next.js output; packaging it is the operator's choice.
- No cloud object-storage driver. The interface exists; the local driver is
  what is tested.
- The application assumes one canonical origin per deployment. Multi-region
  active/active is not supported; Postgres and the storage volume are single
  writers.
- Serverless functions must reach a pooled Postgres endpoint and a persistent
  storage mount. A function with an ephemeral disk cannot host uploads.
- Provider deliveries are implemented but were not exercised against live
  accounts in this repository; test email, Stripe and AI configuration in
  staging before taking traffic.
