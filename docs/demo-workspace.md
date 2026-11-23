# Demo workspace: read-only, never sample data

**Decided:** 2026-11-21

## Decision

Herald has no sample-data preview mode. The demo is the real public workspace at
`/p/herald/herald`, opened read-only. This follows the project rule that the
product never renders mock data: a second fixture tenant would drift from the
real schema and could be mistaken for customer evidence.

`/demo` is a marketing tour that links to the live board, roadmap and changelog.
Those links carry `?demo=1`; the public shell then shows a **Read-only demo**
label and a way back to the tour. Browsing a public page is a `GET` and writes
nothing.

## What "never writes to the tenant" means here

- Public reads are server-rendered from the public projections; they do not
  create rows, counters or analytics events.
- Voting, commenting, submitting and following require an authenticated
  customer session. A signed-out visitor can read but every write path rejects
  the request.
- If a visitor does sign in, writes go to that customer's own account and the
  workspace that owns the board — never to a separate "demo" tenant and never
  to a workspace chosen by the client.
- No dashboard route, API token or operator action is exposed by the demo.

## What was deliberately not built

- A seeded demo tenant with invented requests, votes or customers.
- A `?preview=sample` dashboard mode that renders local fixtures.
- A reset button that deletes and reseeds data.

## Verification

- `/demo` and its linked public pages return `200` from `bun run start`.
- The demo label is driven by `?demo=1`; the public pages render normally
  without it.
- Write endpoints under `/api/public/*` continue to require a session and
  tenant-scoped authorization; the demo adds no bypass.
