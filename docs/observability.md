# Observability

This document describes how Herald answers four questions in production:

1. **What broke, in which release, and for whom?** — error tracking.
2. **Which route, job or query is slow?** — tracing and metrics.
3. **Is anything trending toward an incident?** — alert rules.
4. **What does this deployment cost and is it backed up?** — the internal
   dashboard and backup verification.

The operator procedures are in [operations.md](operations.md) and
[incidents.md](incidents.md); the public half of the incident procedure is
served at `/status/incidents`.

## Error tracking

### Channels

| Configuration | Behaviour |
| --- | --- |
| Nothing set | One JSON line per error in the structured log; that record always exists |
| `ERROR_WEBHOOK_URL` | The log line plus one bounded JSON POST (3 s timeout, redirects refused) |
| `SENTRY_DSN` | A Sentry-compatible event is POSTed to the DSN's store endpoint; the webhook is used only if that delivery fails |

The DSN is parsed, not interpolated: only `http(s)`, a public key and a numeric
project id are accepted, and the store endpoint is derived from the parsed
origin and path. A malformed DSN is reported as `error_report.misconfigured`
instead of silently dropping events.

There is no vendor SDK. Sentry SaaS, a self-hosted Sentry and any relay that
implements `POST /api/{project}/store/` work with the same client.

### What an event contains

- event id, timestamp, level, logger, SDK name/version;
- `release` and `environment`;
- tags: `service`, `release`, `environment`, `route`, `request_id`;
- a fingerprint grouped by event name and error type;
- exception type, a scrubbed message, and stack frames reduced to
  filename/line/column/function;
- scrubbed `extra` fields from the call site.

It never contains cookies, authorization headers, request bodies, query
strings, customer emails, raw user ids, workspace ids or job payloads. The
reporter takes a `LogFields` context and the same scrubber runs over it.

### Release tagging and source maps

`RELEASE_VERSION` is the release id. On Vercel it falls back to
`VERCEL_GIT_COMMIT_SHA`; otherwise it is `dev`. The same value must be used for
the build and the upload:

```bash
export RELEASE_VERSION="$(git rev-parse --short HEAD)"
bun run build:sourcemaps
```

`build:sourcemaps` builds, then runs `scripts/upload-sourcemaps.ts`, which needs
`SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` and the same
`RELEASE_VERSION`. It creates the release, injects debug ids into `.next/server`,
uploads the server maps and finalises the release, through `sentry-cli` or, when
that binary is absent, the newer `sentry` CLI. With any value missing it
prints a skip message and exits 0. It is a separate step so a deployment without
error tracking still builds.

Source maps are generated for the server (`experimental.serverSourceMaps`) and
are **not** served to browsers. Do not enable
`productionBrowserSourceMaps` without a plan for publishing the maps publicly.

PostHog error tracking can symbolicate the same server maps. `next.config.ts`
wraps the config with `withPostHogConfig`, and the upload runs only when both
`POSTHOG_PERSONAL_API_KEY` and `POSTHOG_PROJECT_ID` are set where the build
runs, so a checkout without them builds normally and uploads nothing. The maps
are deleted after upload unless `SENTRY_ORG`, `SENTRY_PROJECT` and
`SENTRY_AUTH_TOKEN` are also set, because the Sentry upload above reads the same
files after the build. No browser error SDK is added: exceptions reach PostHog
through the server reporter described above.

Symbolication needs two things the reporter supplies. Frames inside
`.next/server` are rewritten from the absolute build path to the
`app:///_next/server/` name the uploader stores them under, and each chunk's
injected `//# debugId=` is sent as `debug_meta.images`, which is how the
collector matches a frame to its map.

### Unhandled errors

`src/instrumentation.ts` implements Next's `onRequestError` hook, so a page
render, route handler or server action that throws without a local catch still
reaches the same reporter with the route and request id. Explicit call sites use
`reportError(error, { route, requestId }, "event.name")`.

## PII scrubbing and the redaction audit

`src/lib/observability/scrub.ts` runs two rules over every log line and error
event:

1. a key matching
   `secret|token|password|authorization|cookie|api_key|signature|private_key|webhook|dsn|credential|otp|reset_token`
   is replaced with `[redacted]`;
2. every string value is scanned for:
   - email addresses;
   - `Bearer …` tokens and JWTs;
   - secret URL query parameters (`token`, `key`, `secret`, `password`,
     `signature`, `code`, `auth`, `access_token`, `refresh_token`, `id_token`);
   - session cookie assignments;
   - IPv4 and full/compressed IPv6 addresses;
   - international phone numbers;
   - 13–19 digit payment-card numbers **that pass the Luhn check** (so an
     ordinary timestamp or id is not destroyed).

Objects are walked to depth 4, arrays to 20 entries, cycles become `[circular]`
and long strings are truncated to 500 characters. Errors are reduced to
name/message/code/stack and the message and stack are scrubbed too.

`tests/log-redaction-audit.test.ts` is the regression test: it runs a corpus of
realistic log payloads (provider errors, URLs, cookies, nested headers, thrown
errors) through `formatLogEntry` and `serializeError` and asserts that no email,
bearer token, JWT, IP or card number survives. Add a case to the corpus whenever
a new field type is logged.

## Log retention

Application logs are JSON lines on stdout/stderr and are retained by the log
drain, not by the database. The deployment policy is:

| Stream | Retention | Notes |
| --- | --- | --- |
| Application logs (stdout) | **30 days** | Enough for an incident retrospective and a slow-query trend |
| Error events at the collector | **90 days** | Only scrubbed events; no request bodies |
| Security/audit records in Postgres | **365 days** | `prune_audit_events` enforces it; see operations.md |
| Request metrics | **7 days** | Aggregate rows only (`request_metrics`) |
| Dashboard view events | **180 days** | Privacy review in [dashboard-analytics-privacy.md](dashboard-analytics-privacy.md) |
| AI usage events | **400 days** | Token counts only, no prompts or completions |
| Backup verifications | **90 days** | Evidence of automated checks |

The database windows are enforced by `prune_observability`, enqueued daily by
`/api/cron/jobs`. Changing a window requires updating this table and the
retention environment variable together.

## Tracing and APM

### API routes

`withRouteInstrumentation(route, handler)` is applied to:

- `/api/v1/*` and `/api/mcp`;
- all four `/api/cron/*` endpoints;
- the dashboard-view ingest endpoint.

It generates one request id, injects it into the request the handler receives,
runs the handler in an async context and a span, records the status/duration
bucket, attaches `x-request-id` and `Server-Timing`, and returns a JSON 503 when
the database pool is exhausted. Coverage is explicit: a route that does not use
the wrapper does not contribute to the HTTP error rate. The public board
mutations, Stripe webhook and Resend webhook are not wrapped yet; their failure
signal comes from the job and delivery tables instead.

`request_metrics` is one row per `(minute, route, method, status class)` with
count, total duration and max duration. It is written fire-and-forget after the
response so it never adds latency. A minute of traffic at a route is one row per
status class, not one row per request.

### Slow queries

Already implemented and documented in `operations.md`: `SLOW_QUERY_MS`
(default 200) logs `db.slow_query`, `SLOW_QUERY_ALERT_MS` (default 1000) also
reports through the error channel. Statements are normalised to `$n`
placeholders with parameters removed and truncated to 300 characters.

### Jobs and providers

- Every claimed job runs inside a `job.<type>` span and the enqueuing request's
  async context.
- Email sends, AI calls and outbound webhook deliveries each get their own span.
- A span over `SLOW_SPAN_MS` logs `trace.slow`; a failed one logs
  `trace.failed`. Set `TRACE_LOG_ALL=on` briefly to log every span.
- A route over `SLOW_ROUTE_MS` logs `http.slow_route`; a 5xx logs
  `http.server_error`.

Spans are log lines, not a distributed trace exporter. This is deliberate: the
structured line is already collector-friendly, and adding a full OpenTelemetry
pipeline is an operator decision rather than a hidden dependency.

## Alerting

`evaluate_alerts` runs from `/api/cron/jobs` at most once per five-minute
bucket. Each rule reads an aggregate, compares it with a threshold, and persists
the state in `alert_states`. Only a **transition** notifies, so a long incident
does not page every five minutes and a recovery is announced once.

| Rule | Signal | Default threshold | Minimum sample |
| --- | --- | --- | --- |
| `http_5xx_rate` | instrumented requests, 15 min | > 2% | 20 requests |
| `job_failure_rate` | claimed jobs, 30 min | > 10% | 5 claims |
| `queue_depth` | pending jobs overdue, 10 min | > 50 jobs | 1 |
| `email_bounce_rate` | sent/bounced/complained, 24 h | > 2% | 20 deliveries |
| `webhook_failure_rate` | succeeded/failed deliveries, 1 h | > 5% | 20 attempts |
| `ai_daily_spend` | estimated cost, 24 h | > $25 | 1 |
| `backup_freshness` | oldest successful verification | > 26 h or failed | 1 |

Every value is env-tunable (see `.env.example`). A rate below the minimum
sample is healthy with an explicit "insufficient data" detail, not a page on one
request. A backup rule is healthy before the first verification runs; the
status page reports that same absence as degraded until evidence exists, and a
stale or failed verification after that fires the alert.

Notifications are a small JSON POST to `ALERT_WEBHOOK_URL` (falling back to
`ERROR_WEBHOOK_URL`), with the rule, state, value, threshold, unit, detail,
release and environment. No tenant name, email, payload or provider error string
is included. Transitions are also logged as `alert.transition`.

## Status page and readiness

`/status` is generated from live checks, not a static list:

| Component | Check |
| --- | --- |
| Dashboard and API | serving this page proves the process answers |
| Database | `SELECT 1` through the app pool |
| File storage | a real write/read/unlink probe, cached for 15 s |
| Background jobs | age and failure count of the latest `job_runs`, plus overdue depth |
| Email delivery | configuration plus 24-hour sent/failed/bounced/complained counts |
| Backup verification | age and result of the latest database, storage and manifest rows |

`GET /api/health` is liveness and touches nothing. `GET
/api/health?scope=readiness` returns the same dependency states. It answers
**503 only when the database or storage is unavailable**; email, backup and
queue states are reported but do not remove instances from the load balancer. A
mail-provider incident must not take the product offline.

The public status page and `/status/incidents` never expose workspace names,
customer data, payloads, hostnames or provider error strings. `/status/incidents`
links to the public incident procedure; every error page links to both.

## Graceful degradation

`isDatabaseUnavailable` recognises pool saturation and connection failures by
SQLSTATE (`53300`, `57P03`, `08000`/`08006`, …), network codes
(`ECONNREFUSED`, `ETIMEDOUT`, …) and narrow pool messages
("timeout exceeded when trying to connect", "too many clients already", …).

Instrumented API routes turn that condition into:

```http
HTTP/1.1 503 Service Unavailable
Retry-After: 3
Cache-Control: no-store

{ "error": { "code": "service_unavailable",
             "message": "The service is temporarily busy. Please retry in a few seconds.",
             "request_id": "…" } }
```

Page renders and server actions surface the root/dashboard error boundary, which
shows a friendly retry, the live status link and the runbook — never a stack
trace. Genuine query errors (constraint, syntax) are not classified as capacity
and still surface as a normal bug.

## Request id propagation

`x-request-id` is accepted only if it matches `[A-Za-z0-9._-]{8,128}`, otherwise
a UUID is generated. The proxy echoes it. Instrumented routes put it into an
`AsyncLocalStorage` context; from there:

- `enqueueJob` stores it in `jobs.request_id` **and** includes it in the stored
  payload (extra keys are ignored by handlers' zod schemas);
- job execution re-enters the context, so job logs and spans carry it;
- email, AI and outbound webhook provider calls send it
  (`x-request-id` / `x-herald-request-id`);
- error events tag it.

A job enqueued outside a request (a scheduled sweep) has no request id and
starts a fresh trace; that is explicit, not a guessed value.

## Internal dashboard and cost

`/app/admin` is guarded by `INTERNAL_ADMIN_EMAILS`, a comma-separated allowlist
of signed-in addresses. Workspace roles do not grant access. An empty list
disables the page with a 404. It shows only aggregates:

- tenant counts (workspaces, products, users, customers);
- queue depth, overdue jobs, claims and failures;
- 5xx rate and the five slowest instrumented routes;
- email sends, bounces and webhook failures;
- AI tokens and estimated spend;
- database size/migrations, storage objects/bytes and backup freshness;
- settings-section views (section-level, pseudonymous actor counts);
- estimated monthly cost for database, storage, email and AI.

No query on the page selects a workspace name, product name, member email,
customer record, job payload or error text.

Cost figures are estimates from current usage and configurable rates
(`COST_DB_GB_MONTH_USD`, `COST_STORAGE_GB_MONTH_USD`,
`COST_EMAIL_PER_1000_USD`, `AI_INPUT_USD_PER_MTOK`,
`AI_OUTPUT_USD_PER_MTOK`). They are not an invoice and do not call a billing
API. AI cost is computed at write time from token counts; prompts and
completions are never stored.

## Backup verification

`verify_backups` runs daily through the queue and is also safe to run by hand:

1. inventories object storage and re-reads a deterministic sample of up to 20
   attachment objects, verifying each checksum;
2. records database size, migration count and key table row counts;
3. writes a manifest into `backups/manifests/<date>/<uuid>.json`, reads it back
   and compares its SHA-256;
4. writes one `backup_verifications` row per check (`database`, `storage`,
   `manifest`), then prunes manifests older than
   `BACKUP_MANIFEST_RETENTION_DAYS`.

The status page reports the oldest of the three. The alert fires when the newest
successful row is older than `ALERT_BACKUP_MAX_AGE_HOURS` (default 26 h) or the
latest attempt failed.

This verifies the **storage path and the restore inventory**. It cannot exercise
the database provider's point-in-time recovery from application code: that is a
hosting feature with its own console and retention window. Operations documents
the PITR step, the storage snapshot/versioning requirement and the restore
drill that remains a human action.

## Verification commands

```bash
bun run typecheck
bun run test:unit          # scrubber audit, alert rules, manifest, release/DSN
bun run build              # server source maps enabled
bun run observability:sourcemaps   # optional, needs Sentry CLI + credentials
curl -s "$BETTER_AUTH_URL/api/health?scope=readiness" | jq
curl -s "$BETTER_AUTH_URL/status" | head
```

The integration suite applies the observability migration from zero, so a
missing column or enum value fails `bun run test:integration` before a deploy.
