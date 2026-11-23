# Changelog

Herald's own changelog is published by Herald at
`/p/herald/herald/updates`. The entries below mirror the published releases so
the repository has a reviewable history; the seed script
(`scripts/seed-herald-roadmap.ts`) is what upserts them into the `herald`
workspace's public changelog with `bun run db:seed-herald`.

Only user-visible changes belong here. Internal refactors, test-only work and
dependency bumps go in the pull request, not in a release note.

## 1.4.0 — Documentation that ships with the product

**2026-11-22** · improvement

Herald's own help center is now imported from `docs/help/*.md` by the same
Markdown parser the dashboard import uses. The first collection covers the
getting-started path (workspace → board → first release → widget), widget
installation for plain HTML, React, Next.js, Vue, Svelte and Astro, and a
migration guide for each source tool.

The operations documentation also gains a self-hosting guide, a
data-processing and retention page written from the schema and prune jobs, an
API cookbook for pagination, idempotency, errors and rate limits, and five
architecture decision records. Nothing in this release changes customer data
or requires a migration.

## 1.3.0 — Herald's roadmap is now public, and it runs on Herald

**2026-11-21** · improvement

The roadmap you are reading is a published Herald roadmap. Every card is a
feedback request with the same status the team uses. There is no separate CMS
and no hand-maintained embed: moving a request changes the page.

Vote on anything you want prioritised. The "Most wanted" view sorts by public
votes; recently updated is the default.

## 1.2.0 — Five products under one flat account

**2026-11-20** · feature

Herald now sells products, not board slots. A product owns its public feedback
board, roadmap and changelog, and switching products never mixes their data.

Indie includes five products with five boards each. Professional removes the
product and board caps. Every plan stays flat per workspace: viewers are free
and there is no per-seat price.

## 1.1.0 — Request briefs your coding agent can start from

**2026-11-20** · feature

A request is more than a title. The brief collects the customer quotes and
dates behind it, who asked, how many asked, its current status, related
releases and the questions still open.

Copy it from the request detail, fetch it from
`GET /api/v1/requests/{id}/brief`, or read it through MCP. A human still
decides what becomes a ticket.

## How a release is published

1. Add or edit the entry in the `RELEASES` array in
   `scripts/seed-herald-roadmap.ts` and mirror it here.
2. Run `bun run db:seed-herald` against the target database. The script upserts
   by `(product, slug)`, so running it twice does not duplicate a release.
3. The entry is published to the public changelog, the in-app widget and (if
   the channel is enabled) the subscriber email queue.

A release created through the dashboard or the API is a draft until a human
publishes it. The seed script is the exception: it writes already-published
entries because it is reproducing Herald's own public history.
