# Flaky tests: quarantine and dashboard

A flaky test is a test that passes on retry without a code change. It is not
noise to be ignored: a suite people rerun until green stops being evidence.

## What the CI records

- `playwright.e2e.config.ts` writes `test-results/e2e-results.json` on every CI
  run (the `json` reporter) and retries once.
- `scripts/flaky-report.ts` flattens that file into
  `test-results/flaky-dashboard.md`: one row per test with its status, attempts
  and quarantine state. The CI job appends the same table to the workflow
  summary and uploads it as an artifact.
- A test that needed more than one attempt is marked **flaky** even when it
  passed. That is the signal; a green status alone hides it.

## Quarantine

Quarantine is for a test that is believed to be correct but is currently
unreliable because of the environment (browser timing, third-party network).
It is not for a test that found a real bug.

1. Add a substring of the test title to `.github/flaky-tests.json`.
2. Open an issue labelled `flaky` with the dashboard row and the first failing
   trace.
3. Fix or rewrite within **14 days**. If the test cannot be made reliable,
   delete it and replace it with a deterministic check — do not leave it
   quarantined indefinitely.

Quarantined tests still run and still appear on the dashboard. The list is not
a skip list; it is an ownership list. A quarantined test that fails does not
block the pipeline, which is why the dashboard, not the exit code, is the
review surface.

## Adding a new test without creating a flake

- Prefer a deterministic fixture over `Date.now()`, `Math.random()` or a live
  network call.
- For the browser suite, use the seeded database (`bun run e2e:seed`); never
  depend on data another test created.
- A visual test pins `Date.now()` and masks relative timestamps. If a new
  surface has a clock, mask it rather than adding a tolerance.
- Never widen a timeout to hide a race. Find the awaited event and wait for it.
