# Testing strategy

Five layers, each with one job. The point of the split is that a failure tells
you where to look.

| Layer | Command | What it proves |
| --- | --- | --- |
| Unit | `bun run test:unit` | Pure logic and adapters. No socket, no database. |
| Integration | `bun run test:integration` | Real Postgres, real route handlers, real transactions rolled back per test. |
| Browser matrix | `bun run test:browser` | The shipped widget loader in Chromium, Firefox and WebKit against a fixture origin. |
| Seeded e2e | `bun run e2e` | The production build against a seeded database: public loop, dashboard loop, widget install, billing redirect. |
| Visual | `bun run e2e:visual` | Three stable surfaces: dashboard shell, public board, widget launcher. |

## The no-mock rule and its one seam

`bun run check:no-mocks` fails on a module interceptor in `tests/`. Providers
are exercised through **injected endpoints**: the real email and AI adapters
post to a local HTTP server configured with `EMAIL_API_URL` / `AI_API_URL`.
`tests/integration/seams.test.ts` is the documented boundary and the only
place a fake provider belongs.

## Seeded e2e

`scripts/e2e/setup-db.ts` drops and recreates a disposable `herald_e2e`
database and applies every migration; `scripts/e2e/seed.ts` creates fixed
slugs, a credential account hashed with Better Auth's own `password` helper,
two public requests and an inbox thread. The suite signs in through the real
form.

The app builds into `.next-e2e` (`bun run e2e:build`) so a running `next dev`
cannot overwrite the production build mid-run.

Against a preview deployment, set `E2E_BASE_URL`. Playwright then does not
start or seed a server; the deployment owns both. CI runs the same suite
against a production build of the commit, and the optional
`preview_base_url` dispatch input points it at a hosted preview.

## Contract and migrations

- `tests/integration/openapi-contract.test.ts` walks the served OpenAPI
  document, calls every operation through the router and fails on
  "Endpoint not found". The document and the route manifest must be the same
  set.
- `scripts/migration-drift.ts` builds two databases: one from zero, one from
  the previous release tag plus everything since. Column, index, constraint
  and enum fingerprints must match. CI checks out tags (`fetch-depth: 0`) and
  sets `MIGRATION_REQUIRE_BASELINE=1`, so a missing tag is an error rather
  than a silent pass.

## Failure paths

- `tests/integration/job-chaos.test.ts`: a runner that claimed a job and died
  is reclaimed after the stale-lock window, and the outbox still sends once.
- `tests/integration/email-delivery.test.ts`: provider 500 retries to the
  attempt ceiling without touching suppressions; 429 backoff is measured.
- `tests/integration/juno-answers.test.ts`: a timed-out AI provider hands off
  with no generated message left behind.

## Rate limits and tenancy

- Every public POST has a limiter; `public-rate-limits.test.ts` gates that at
  the source level and exercises the shared gate through real routes.
- `cross-tenant.test.ts` includes a deterministic fuzz pass that walks the API
  manifest with ids from another workspace (and random UUIDs) and requires
  missing-row behaviour on every addressed route.

## Coverage floor

`bun run test:coverage` writes an lcov report and `scripts/check-coverage.ts`
enforces line coverage on auth, tenancy, billing and `api-v1`. Floors are a
ratchet below the measured value, not a target.

## Flakes

See `docs/flaky-tests.md`. The dashboard is `test-results/flaky-dashboard.md`,
built from the Playwright JSON on every CI run.
