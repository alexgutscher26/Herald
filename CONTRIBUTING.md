# Contributing to Herald

## Setup

```bash
bun install
docker compose up -d          # local PostgreSQL 17 on localhost:5432
cp .env.example .env          # then set DATABASE_URL and BETTER_AUTH_SECRET
bun run db:migrate
bun run dev
```

The local database URL used by `docker-compose.yml` is:

```text
postgres://herald:herald@localhost:5432/herald
```

`DATABASE_URL` must point at a loopback host for the seed/reset scripts. Tests
use `TEST_DATABASE_URL`; the integration harness creates and drops disposable
`herald_test_*` databases and refuses a non-loopback `DATABASE_URL` unless
`TEST_DATABASE_URL` is set explicitly.

## Check order

Run these before opening a pull request, in this order:

```bash
bun run typecheck
bun run lint
bun run test:unit
bun run check:no-mocks
bun run build
```

`bun run test` is an alias for `test:unit`; `bun run test:integration` needs a
test database. The full order is also what CI runs (`.github/workflows/ci.yml`).

## No mocks

Tests exercise real modules against a real Postgres database. Do not add
`vi.mock`/`jest.mock` equivalents, do not stub `fetch` for an internal module,
and do not replace the database with an in-memory fake. External providers are
injected at a seam (an explicit provider object or a loopback HTTP stub), not
patched into a module. `bun run check:no-mocks` enforces the rule.

## Server actions

Every action returns `ActionResult<T>` from `@/lib/action-result`:

```ts
return { ok: false, error: "Explain what the user can do." };
return { ok: true, data: { id } };
```

Use `authorizeProductAction` / `authorizeWorkspaceAction`; they enforce the
tenant, permission and same-origin boundary. Client code reports the result
through `toastActionFailure` from `@/components/shared/action-toast`.

## Destructive scripts

`scripts/reset-db.ts` requires `--yes` and refuses `NODE_ENV=production`.
Seed and backfill scripts refuse production and a non-loopback database unless
`--allow-remote` is passed. `--dry-run` is honoured where the script supports
it. Read the script before running it against anything but a disposable local
database.

## Help center documentation

`docs/help/*.md` is the source for Herald's own user-facing help center. Each
file starts with flat front matter:

```markdown
---
title: Install the widget
slug: install-the-widget
collection: Getting started
---
```

Keep the `title`, `slug` and `collection` keys and leave the first heading out
of the body; the dashboard importer renders the title separately. `slug` must
match `^[a-z0-9][a-z0-9-]{0,79}$` and be unique inside its collection.

After seeding the `herald` workspace and signing in once, publish the files
with:

```bash
bun run db:seed-herald     # the workspace, product and public changelog
bun run db:import-help     # parses docs/help and publishes the articles
```

The import uses the product's own Markdown parser and `importHelpItems`, so it
also rewrites article revisions and syncs the help collection into the Mira
knowledge source. It publishes every draft article in a collection it touches;
keep hand-written drafts out of these collections. `bun run test:unit` checks
the front matter, unique slugs and the required article set without a database.

## Architecture

Read [docs/architecture.md](docs/architecture.md) for the layer rules, the
client/database boundary and the shared pagination/date/action primitives.
