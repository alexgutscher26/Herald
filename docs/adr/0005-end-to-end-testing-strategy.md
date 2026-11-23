# ADR 0005: Five test layers, two Playwright configurations

- **Status:** Accepted
- **Date:** 2026-11-22
- **Applies to:** `tests/`, `playwright.config.ts`, `playwright.e2e.config.ts`,
  `.github/workflows/ci.yml`

## Context

Herald has pure logic (permissions, billing policy, cursors, date formatting),
database-backed use cases (tenancy, publishing, imports, email delivery), a
versioned widget loader that runs on someone else's page, and a production
build that must render the dashboard and public surfaces. One test runner
cannot cover all four honestly.

Two failures shaped the decision:

- A browser suite that needed a database and a seeded workspace was slow and
  flaky, and a failure did not say whether the widget, the seed or the server
  was wrong.
- A unit suite with mocked queries passed while a route was unreachable,
  because the mock answered a call the real router never made.

The project also forbids module mocks in tests (`bun run check:no-mocks`);
providers must be exercised through injected endpoints.

## Decision

Keep five layers, each with one job:

| Layer | Command | Proves |
| --- | --- | --- |
| Unit | `bun run test:unit` | Pure logic and adapters, no socket and no database. |
| Integration | `bun run test:integration` | Real Postgres, real route handlers, real transactions rolled back per test. |
| Widget browser matrix | `bun run test:browser` | The shipped loader in Chromium, Firefox and WebKit against a fixture origin, with no database and no app build. |
| Seeded e2e | `bun run e2e` | The production build against a migrated, seeded database: public loop, dashboard loop, widget install, billing redirect. |
| Visual | `bun run e2e:visual` | Three stable surfaces only: dashboard shell, public board, widget launcher. |

The two Playwright configurations stay separate:

- `playwright.config.ts` serves a fixture host page and the real loader from
  `tests/browser/fixture-server.ts`. It is database-free, so it can run on
  every pull request and in all three engines.
- `playwright.e2e.config.ts` starts `e2e:serve` (drop/create a disposable
  `herald_e2e` database, apply every migration, seed fixed slugs and a real
  credential account) and runs the production build from `.next-e2e`.
  `E2E_BASE_URL` switches it to an already-seeded preview deployment, where
  Playwright starts nothing.

The seeded suite signs in through the real form. It does not inject a session
cookie, because the sign-in path is part of what it is testing.

Visual snapshots are limited to surfaces whose layout is stable. The
configuration pins `en-US`, `UTC`, a 1280×900 viewport, a metric-compatible
font and a small diff ratio, because a Windows baseline and a Linux CI runner
rasterise text differently. A snapshot that needs a per-platform baseline is
not a stable surface and is not added.

## Consequences

- A failure points at a layer: unit means logic, integration means the database
  or transaction, browser means the loader, e2e means the assembled product.
- CI cost is higher than a single suite, but the fast layers gate the slow
  ones; the browser matrix needs no database and no build.
- The seeded suite is intentionally small. Adding every page to it would make
  the suite slow and couple it to copy that changes weekly; integration tests
  cover routes and permissions directly.
- No layer mocks a provider. Email and AI run against local HTTP endpoints via
  `EMAIL_API_URL` / `AI_API_URL`; the documented seam is
  `tests/integration/seams.test.ts`. A test that needs a mock is a design
  signal, not a reason to add one.
- Flakes are quarantined with a recorded owner, not retried until green; the
  process and dashboard are in [../flaky-tests.md](../flaky-tests.md).
- A visual change that was not looked at is unverified. The screenshot diff is
  a regression check, not a design review.

## Verification

- `bun run test:unit` — 942 passing at the time of this record.
- `bun run test:integration` — requires a loopback `TEST_DATABASE_URL` or a
  loopback `DATABASE_URL`; the harness creates and drops its own database.
- `bun run test:browser` — requires the three Playwright engines installed.
- `bun run e2e` / `bun run e2e:visual` — require the seeded database and the
  `.next-e2e` build, or `E2E_BASE_URL` pointing at a seeded deployment.

Limits: provider deliveries are exercised against local endpoints, not live
accounts. The matrix does not prove every customer browser; it proves the
loader's behaviour in three engines.
