# Performance and query plans

## Targets

These are p95 service-level targets for a warm application instance with the
production-like row counts below, not guarantees for a cold server. Capture the
actual p95 with the load script before launch.

| Surface | p95 target |
| --- | --- |
| Public board first page | ≤ 350 ms |
| Public request detail | ≤ 400 ms |
| Public search (`q`) | ≤ 500 ms |
| Dashboard feedback list | ≤ 450 ms |
| Dashboard inbox list | ≤ 450 ms |
| Analytics overview (30 daily rollups) | ≤ 300 ms |
| API list endpoint | ≤ 400 ms |

## Indexes added for these paths

Migration `0032_sweet_malice.sql` adds:

- `feedback_posts_title_trgm_idx` and `feedback_posts_body_trgm_idx` for
  `ILIKE '%term%'` search.
- `feedback_posts_board_public_idx` and
  `feedback_posts_product_status_public_idx` for visible board and roadmap
  projections.
- `feedback_status_history_funnel_idx` for the status/ship-time rollup.
- `conversations_product_latest_idx` and
  `conversation_messages_author_time_idx` for inbox ordering and first-response
  measurement.
- Analytics event and daily indexes for the trailing-window rollup.

The existing feedback board/status/created indexes, customer session indexes
and inbox `(product, status, last_message_at)` index remain in place. Verify
with `EXPLAIN (ANALYZE, BUFFERS)` after seeding; a plan that uses a sequential
scan on a large table is a release blocker.

## Reproduce with realistic rows

Seed a dedicated, disposable database (never production):

```bash
DATABASE_URL=postgresql://…/herald_perf bun scripts/perf-seed.ts 10000
```

The seed creates one public workspace/product/board and 10,000 visible requests
with mixed statuses and realistic titles/bodies. It prints the public URL and
the product id.

Then inspect plans:

```bash
DATABASE_URL=postgresql://…/herald_perf bun scripts/perf-plan.ts
```

Start the app against that database and run the HTTP load test:

```bash
PERF_URL=http://localhost:3000/p/perf-workspace/perf-product/feedback \
PERF_REQUESTS=300 PERF_CONCURRENCY=20 bun scripts/perf-load.ts
```

The load script reports p50/p95 and non-2xx counts. It fails non-zero when p95
exceeds `PERF_P95_MS` (default 500) or any request fails. Set
`PERF_AUTHORIZATION="Bearer hrl_…"` to measure a `/api/v1` endpoint.

The seed now also creates 500 customers, one public comment per request, two
customer votes per request, 2,000 conversations with two messages each, 30 days
of raw analytics events and 30 days of daily rollups, a workspace member and a
read-only API token. Its JSON output carries the slugs, the newest request id and
that token, so the CI steps and local runs do not guess ids.

Authenticated dashboard surfaces are measured by their server data path, which
is the same query function the page calls:

```bash
DATABASE_URL=postgresql://…/herald_perf PERF_REQUESTS=40 PERF_CONCURRENCY=1 \
  bun run perf:surfaces
```

It reports p50/p95 per surface, fails on a missed target, and prints the SQL
statement count for each path. A count above the budget — or one that grows with
row count — is the N+1 signal; `tests/integration/query-budgets.test.ts` pins the
dashboard snapshot and inbox list so a per-row query fails CI even without the
perf job.

## Measured baseline

Measured on 4 November 2026 against a production build (`bun run build` +
`bun run start`) backed by a disposable Postgres database seeded with 10,000
visible requests by `scripts/perf-seed.ts`.

Three consecutive warm runs against `/p/<workspace>/feedback/feedback`, 300
requests each at concurrency 20:

| Run | p50 | p95 | Failures |
| --- | --- | --- | --- |
| 1 | 212 ms | 256 ms | 0 |
| 2 | 214 ms | 254 ms | 0 |
| 3 | 216 ms | 258 ms | 0 |

The first runs immediately after server start measured p95 395–404 ms. The
page needs a request or two to warm, which is why the targets above are defined
for a warm instance; keep a warm-up probe in deployment smoke tests rather than
treating the first request as a regression.

Query plans on the same seed: board page 0.07 ms, public search 9.4 ms, inbox
0.02 ms. All three used the intended indexes; no sequential scan appeared.

`generateMetadata` and the page body now share one board read through a React
request-scoped cache, so the board queries run once per navigation instead of
twice. The projection stays dynamic: moderation changes still apply on the next
request.

### Authenticated and detail surfaces, measured 21 November 2026

Measured with `bun run perf:surfaces` against a disposable Postgres 16 database
seeded by `scripts/perf-seed.ts 10000` on the same machine as the public
baseline: 10,000 requests, 10,000 comments, 20,000 customer votes, 2,000
conversations, 30 days of rollups. 40 timed runs plus a warm-up run per surface.
These are server data-path timings (the page's own query functions), so they
exclude React rendering; the public board, request detail and `/api/v1` rows are
also measured over HTTP by the CI job.

| Surface | p50 | p95 | Target | Statements |
| --- | --- | --- | --- | --- |
| Public request detail | 12 ms | 16 ms | ≤ 400 ms | 17 |
| Dashboard feedback list | 151 ms | 206 ms | ≤ 450 ms | 23 |
| Dashboard inbox list | 2 ms | 3 ms | ≤ 450 ms | 8 |
| Analytics overview (30 daily rollups) | 5 ms | 23 ms | ≤ 300 ms | 7 |
| API list endpoint | 23 ms | 26 ms | ≤ 400 ms | 8 |

`perf-plan.ts` now also prints plans for request detail, the dashboard feedback
list and the analytics rollup read. The detail read is an index scan on
`feedback_posts_id_product_unique` (0.04 ms). The analytics read aggregates 480
rollup rows in 0.37 ms. The dashboard list is a sequential scan plus sort over
the product's 10,000 rows (6.6 ms): the seeded workspace owns every row in the
table, so selectivity is 100% and an index scan would be slower — this is the
correct plan, not a missing index.

`PERF_PLAN_CHECK=1 bun run perf:plan` turns those plans into an assertion. It
fails when a large table is read by a sequential scan, except for the tables
recorded on that query in `scripts/perf-plan.ts` (the dashboard snapshot's
`feedback_posts` and `user`, and the 30-day `analytics_daily` read). The
exemption is per query, not global: a new filtered or sorted read must be added
to the script with its own allowlist, so an unindexed filter cannot inherit an
unrelated decision. CI runs it before the build, and the local run exits
non-zero on an unexpected plan.

The public board, request detail and API list were also re-measured over HTTP
against the production build on the same seed: 188 ms, 180 ms and 92 ms p95 at
concurrency 10. At concurrency 20 the same host reported 392 ms for the board
and 417 ms for the detail page, because the load generator and the server share
one machine; the 4 November baseline table above remains the dedicated 20-way
run. CI uses concurrency 10 for the HTTP budgets so the generator's CPU does not
turn the budget into a coin flip on a two-core runner.

**Known limit: concurrent dashboard navigations.** The dashboard snapshot loads
the whole product dataset per request, so its cost grows with rows and with
simultaneous operators. The same probe measured p95 at 582 ms with 4 concurrent
navigations and 1,270 ms (p50 1,052 ms) with 8. The target is met for one
navigation at a time, which is how CI enforces it; a team of several operators
loading the feedback page simultaneously will exceed 450 ms until the snapshot
is paged. Treat that as the next performance change, not as a passing target —
the data path is otherwise index-bound and the statement count is constant.

## CI performance budget job

`.github/workflows/ci.yml` → `performance` provisions Postgres 16, applies the
migrations, seeds 10,000 requests, runs the plan check, builds (which enforces
the bundle budgets), starts the production server, measures the cold start,
warms the public board, then runs:

- `PERF_PLAN_CHECK=1 perf:plan` — fails on an unexpected sequential scan.
- `perf:cold` — the first request after boot (`/p/*`) within 5 s, then
  `/api/health?scope=readiness`.
- `perf:load` against the public board (p95 ≤ 350 ms, 100 requests, concurrency 10).
- `perf:load` against the request detail page (p95 ≤ 400 ms, same load).
- `perf:load` against public search (`?q=export`, p95 ≤ 500 ms, 50 requests,
  concurrency 5).
- `perf:load` against `/api/v1/requests?limit=25` with the seeded read token
  (p95 ≤ 400 ms, 50 requests; the API allows 300 per minute per token).
- `perf:surfaces` for the dashboard snapshot, inbox, analytics overview and API
  list data path (one navigation at a time).

A missed p95, a failed request, a data path over its statement budget or a
caught server exception fails the job. The statement budgets are 20 (request
detail), 30 (dashboard snapshot), 12 (inbox), 10 (analytics) and 15 (API list);
the integration budget test additionally proves the snapshot and inbox counts do
not change between 3 and 43 rows.

## Bundle budgets

`bun run build` now runs `scripts/check-bundle-budget.ts` as its `postbuild`
step, so a regression fails the build instead of shipping. It measures gzipped
chunks referenced by the production client reference manifests, plus the widget
files served from `public/`.

| Bundle | Measured (21 Nov 2026) | Budget |
| --- | --- | --- |
| Dashboard feedback route JS | 131.5 KiB | 150 KiB |
| Dashboard feedback route CSS | 19.3 KiB | 24 KiB |
| All dashboard route JS (union) | 500.0 KiB | 560 KiB |
| `public/widget/v1.js` raw / gzip | 40.3 / 9.6 KiB | 41 / 11 KiB |
| `public/widget/v1.css` raw / gzip | 6.8 / 1.9 KiB | 8 / 3 KiB |

The widget ceilings live in `scripts/bundle-budgets.ts` and are asserted by both
the postbuild check and `tests/widget-budget.test.ts`, so the two cannot drift.
`BUNDLE_BUDGET_REPORT=1 bun scripts/check-bundle-budget.ts` prints the current
sizes without enforcing.

## Public payload cache

`src/features/public/payload-cache.ts` caches the immutable half of the two
public pages: one release detail (row, tags and authors) and one help article
(row plus collection). The cache is per process, bounded at 500 entries and
defaults to a 60-second TTL (`PUBLIC_PAYLOAD_TTL_SECONDS`, clamped to 0–3600;
`0` disables it).

Cache-key review:

| Key | Payload | Excluded from the key on purpose |
| --- | --- | --- |
| `release:{productId}:{slug}` | Published row, tags, authors | viewer, locale, moderation/merge/ban state, signed cover URL |
| `help:{productId}:{collectionSlug}:{articleSlug}` | Published row, collection, all translations | locale, the product's translation switch |

What stays live on every request, because it is not in the payload: the
product's public switches, linked requests for the requesting viewer, comment
visibility, bans and merges. The cover key is cached raw and signed per call,
so an expiring URL is never served from cache. Locale is applied after the read,
so one entry serves both languages.

Every release write (`actions.ts` publish/save/archive/restore, the API draft
update, the cron publisher) flushes all cached releases; help save, status
change and delete flush all cached help articles. The flush is process-local, so
another instance converges at the TTL. That window is the only staleness a
visitor can see, and only for an edit made on a different instance.

## Streaming and Suspense audit

The repository contains exactly one loading skeleton,
`src/app/(dashboard)/loading.tsx`, and no explicit `<Suspense>` boundary in
`src/app`. `tests/integration/dashboard-shell.test.ts` (run by `bun run
test:smoke`) boots `next start` against a disposable database, signs in a
fixture owner, enumerates all 34 `/app/**` pages from the filesystem and fails
when a response still contains the hidden streaming sentinel — a boundary that
never resolved. That is the §1.1 failure mode, and it now fails CI instead of a
manual browser check. Public pages have no loading boundary to resolve; the
cold-start probe below asserts the first `/p/*` response is a complete 2xx.

## Images

Release covers render through `next/image` (`src/components/shared/
release-cover.tsx`) with `fill` inside an aspect-ratio container and `sizes` set
for the used widths. Height comes from the container, so a separate
`width`/`height` pair would be wrong for a responsive cover. `unoptimized` is
deliberate: storage already holds the uploaded object and the route signs a
short-lived URL, so the optimizer would add a second copy and a cache the
signature invalidates.

Logos now render through `next/image` with explicit dimensions: public header
32×32, branding preview 64×64, widget preview 20×20. They use `unoptimized`
because `/api/public/workspaces/{slug}/logo` serves the stored bytes with
immutable caching headers; the optimizer would duplicate them. The remaining
`<img>` elements are customer attachment previews, whose natural size is unknown
until load and which are not covers or logos.

## Cold start

```bash
PERF_ORIGIN=http://localhost:3000 \
PERF_COLD_PATHS="/p/<workspace>/feedback/feedback,/api/health?scope=readiness" \
bun run perf:cold
```

Start the server immediately before the probe. It retries the first path until
the process answers, so the reported time includes boot, route matching and the
first render/query; the second path is then measured warm. Budget is 5 s
(`PERF_COLD_MS`) and the server may take up to 60 s to appear
(`PERF_COLD_TIMEOUT_MS`). Measured 21 November 2026 on the seeded database with
a production build: first `/p/*` response 968 ms, readiness 56 ms afterwards. CI runs it before any warm-up request, so
the measurement cannot be accidentally pre-warmed.

## What to watch

- Analytics rollups are computed by the daily job and read as one row per
  product/metric/day, not by scanning raw events on page load.
- Do not add a per-row subquery to the inbox or board list; the list models
  intentionally denormalise counts and last-message metadata.
- Public pages are dynamic by design. The immutable release/help cache is
  described above; keep viewer-dependent data, moderation, bans and merges out
  of it, and invalidate on the write path.
- Re-run the plan check after adding a filter or sort. A new query without a
  matching composite index is how these targets regress.
