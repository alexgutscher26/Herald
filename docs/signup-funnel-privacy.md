# Signup funnel analytics — privacy review

**Status:** approved for the launch measurement
**Date:** 2026-11-21
**Scope:** the company-level funnel from `/sign-up` to a recorded widget install
**Implementation:** `src/features/analytics/signup-funnel.ts`,
`signup_funnel_events`, `GET`-free CLI `bun run analytics:signup-funnel`

## What is measured

| Stage | Event | What it means |
| --- | --- | --- |
| 1 | `sign_up_view` | A server render of `/sign-up`, deduplicated per visitor-day |
| 2 | `account_created` | A Better Auth user row was created |
| 3 | `workspace_created` | The onboarding transaction created a workspace |
| 4 | `first_release` | A release for the subject product was published |
| 5 | `widget_installed` | The public widget reported an install for the subject product |

The earlier workspace analytics module is unchanged. It is tenant-scoped and
stores product-interaction events for a workspace dashboard. This funnel is
separate because the first events happen before a workspace exists.

## Data stored

`signup_funnel_events` has exactly four columns:

- `id` — a random UUID, not derived from a person.
- `stage` — one of the five values above.
- `subject_hash` — a SHA-256 digest, or `NULL` when no request headers were
  available.
- `occurred_at` — a UTC timestamp.

There is no email address, name, account id, workspace id, product id, IP
address, user agent, referrer, cookie, session id, URL query or free-text field.
No event is sent to a third party. The table lives in the deployment's
PostgreSQL database.

### How the hashes are built

- **Milestones** use `SHA-256(stage + ":" + subject_id)`. A subject therefore
  counts once per stage. A workspace hash cannot be joined to an account hash,
  and neither can be reversed from the table without already knowing the
  candidate id. The raw id is never stored.
- **Sign-up views** use `SHA-256(stage + ":" + UTC-day + IP + user agent)`. The
  IP and user agent exist in memory for that one render only; they are not
  logged or persisted. The day scope means a reload is not a second view, but a
  returning visitor on another day can be counted again.

The hashes are pseudonymous analytics keys, not customer records. They are not
used for support, billing, advertising or cross-site tracking.

## Why this is acceptable

- **Purpose limitation.** The only use is aggregate conversion measurement:
  where sign-up loses people before the first useful product milestone.
- **Data minimisation.** The schema has no direct identifier. The event stream
  cannot reconstruct a person's activity across stages or workspaces.
- **No cookies, local storage, pixels or third-party scripts.** The page view is
  counted on the server; nothing is written to the browser.
- **Legitimate interest.** Measuring whether the onboarding flow works is a
  normal product operation. The data cannot be used to contact or profile a
  person, and the account preference controls onboarding email separately.
- **Security.** The table is reached only through server-side code. It is not
  exposed by the public API, the status page or the product analytics page.
  Database access follows the deployment's normal Postgres controls.

## Retention and access

- Events older than **400 days** are deleted by `pruneSignupFunnelEvents`, which
  runs with the existing daily `prune_audit_events` job. There is no second
  scheduler to forget.
- The aggregate report is available only through the server-side CLI:
  `bun run analytics:signup-funnel --days=30`. It prints counts and rates, never
  a hash or tenant id.
- Do not export `subject_hash`, add it to logs, or join it to another table. If
  a future change needs per-account funnel analysis, that is a new review and a
  different legal basis.

## Risks and mitigations

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Re-identification from a hash | Very low; UUIDs are high entropy and hashes are stage-bound | Never publish or export the hash; no candidate list is stored alongside it |
| Counting a reload twice | Medium | Day-scoped visitor hash plus the unique stage/hash index |
| Missing a stage because JS or a worker was down | Medium | Every milestone is written server-side from the real write; a missing row is undercounting, not a false positive |
| Analytics failure breaks a write | Low | Every write is best-effort and catches; a failed insert logs and returns |
| A later stage includes older subjects | Expected | The CLI labels rates directional; use the counts, not a claim of cohort retention |
| Scope creep into advertising or cross-site tracking | Prevented by review | Any new field, vendor, cookie or purpose requires a new dated review |

## User rights

The event table is designed not to be identifiable. A data-subject request
therefore cannot be satisfied by searching it for an email, because no email is
present. Account deletion removes the account and its workspace data through
the normal controls; already aggregated funnel rows remain because they cannot
be attributed to the deleted account. If this conclusion changes — for example
because a raw id is added — deletion and access handling must be redesigned
before shipping that change.

## Review outcome

**Approved** for the launch funnel with these conditions:

1. Keep the five stages and four columns; no free-text or direct identifiers.
2. Keep the 400-day pruning in the daily job.
3. Keep the report behind the server-side CLI; do not add a public dashboard.
4. Re-review before adding a vendor, a cookie, a raw account/workspace id, or
   any attempt to link stages to a person.

Reviewed by: engineering (implementation owner). A legal review is still
required before claiming a specific lawful basis in a customer-facing privacy
notice; this document is the engineering privacy assessment, not legal advice.
