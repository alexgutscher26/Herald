# Herald

**One customer loop for every product you run.** Herald is a multi-tenant SaaS
for indie founders and small teams: public feedback boards, a roadmap, a
changelog, a help center, an in-app widget, a support inbox and win-back — all
backed by the same workspace.

![Herald's public portal, showing the feedback, roadmap and changelog navigation](public/screenshots/herald-portal.png)

[Quick start](#quick-start) · [Documentation](#documentation) · [Reference](docs/reference.md) · [Commands](#commands) · [Contributing](CONTRIBUTING.md)

## Why Herald

Most teams can collect feedback or publish a changelog. Herald connects the
whole loop: a request is voted on, moves through the roadmap, ships in a
release, and can be matched to the cancellation reason it answers. The same
public workspace holds the feedback, updates, help articles and API docs.

The dashboard is **database-backed**: every record comes from a Drizzle query,
and every mutation is an authorized server action. `/demo` opens Herald's real
public workspace read-only; it is not a separate fixture mode or a browser-only
store. Seed scripts exist for local/demo setup and never run at startup.

| Area | What it covers |
| --- | --- |
| Customer loop | Public boards, requests, votes, comments, roadmap, changelog and RSS |
| Reach | Embeddable widget, help center, support inbox, surveys, tours and notifications |
| Team workflow | Releases, moderation, imports, subscribers, win-back campaigns and audit log |
| Platform | REST API + OpenAPI, MCP server, webhooks, Slack, issue trackers and CRM sync |
| Trust | Workspace tenancy, roles, SCIM/SSO, exports, erasure, billing and status |

The API contract, integration details, data model, authentication rules and
dashboard architecture live in **[docs/reference.md](docs/reference.md)**.

## Quick start

### Prerequisites

- [Bun](https://bun.sh) 1.2 or newer — package manager and script runner.
- Node.js 20.9 or newer — `bun run dev` invokes Next's Node entry point; `build`
  and `start` run under Bun.
- Postgres 14+ — [Neon](https://neon.tech), another hosted provider, or the
  included Docker Compose service.
- Docker (optional) — starts the local Postgres 17 service with
  `docker compose up -d`.

### Local Postgres (Docker)

```bash
bun install
docker compose up -d
cp .env.example .env

# Set these in .env:
# DATABASE_URL=postgres://herald:herald@localhost:5432/herald
# BETTER_AUTH_SECRET=...   # openssl rand -base64 32
# BETTER_AUTH_URL=http://localhost:3000

bun run db:migrate
bun run dev
```

### Hosted Postgres (Neon or another provider)

```bash
bun install
cp .env.example .env

# Set these in .env:
# DATABASE_URL=postgresql://USER:PASSWORD@ep-xxxx-pooler.../DBNAME?sslmode=verify-full
# BETTER_AUTH_SECRET=...   # openssl rand -base64 32
# BETTER_AUTH_URL=http://localhost:3000

bun run db:migrate
bun run dev
```

Open <http://localhost:3000>. Development starts empty. To load Herald's own
demo workspace and help center, follow the seed steps in
[CONTRIBUTING.md](CONTRIBUTING.md).

`/` is the marketing page. `/app` sends a signed-in user to their first
authorized product, or to `/app/onboarding` when they have none.

## Documentation

| Guide | What it covers |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | Module boundaries, authorization and the client/database split |
| [docs/reference.md](docs/reference.md) | REST API, webhooks, MCP, integrations, schema, auth, dashboard, plans and operations |
| [docs/operations.md](docs/operations.md) | Backups, alerts, on-call, migrations and incident response |
| [docs/self-hosting.md](docs/self-hosting.md) | Runtime, storage, scheduler and deployment constraints |
| [docs/api-versioning.md](docs/api-versioning.md) | REST API compatibility and deprecation policy |
| [docs/launch-checklist.md](docs/launch-checklist.md) | Launch gates and the evidence still required |
| [docs/help/](docs/help/) | Source Markdown for the public help center |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Local setup, check order, no-mock rule and action conventions |

In a running deployment, `/docs` is the public index for the help center, API
reference, changelog, status and trust pages.

## How it fits together

```text
Workspace
  └── Product
      ├── boards → requests → votes, comments and subscribers
      ├── roadmap ← request status
      ├── changelog releases → email and in-app updates
      ├── help center and API docs
      └── widget, surveys, support inbox and win-back
```

- The dashboard lives under `/app` and always requires a session. The public
  portal lives under `/p/{workspaceSlug}/{productSlug}` and uses a separate
  customer session.
- Route files stay thin server components; feature modules own queries,
  mutations and client interactivity. Every tenant read and write is scoped by
  `src/lib/authz.ts`; client code never imports the database.
- `src/proxy.ts` adds request IDs and security headers and rewrites verified
  custom domains. It authorizes nothing.
- Stack: Next.js 16, React 19, TypeScript, Drizzle ORM with Postgres, Better
  Auth and Tailwind CSS.

## Configuration

`.env.example` is the full reference, including Stripe, Slack, GitHub, inbound
email, alert thresholds and retention. Three variables are required:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string. Use the `-pooler` host when the provider supplies one. |
| `BETTER_AUTH_SECRET` | Signs Better Auth sessions. At least 32 characters (`openssl rand -base64 32`). |
| `BETTER_AUTH_URL` | Canonical origin, e.g. `http://localhost:3000`. No trailing slash. |

Common optional groups:

| Group | Variables |
| --- | --- |
| Scheduled jobs | `CRON_SECRET` — required before the cron endpoints will run |
| Email | `RESEND_API_KEY`, `EMAIL_FROM` — set together; otherwise email stays disabled |
| AI | `AI_API_URL`, `AI_API_KEY`, `AI_MODEL` — changelog drafts and Juno |
| Storage | `STORAGE_DIR` — local driver; use a persistent volume in production |
| Billing | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO` |
| Observability | `ERROR_WEBHOOK_URL`, `ALERT_WEBHOOK_URL`, `SENTRY_DSN` |
| API | `FLAG_API=on` — `/api/v1` and `/api/mcp` are **off by default** |

Validation is lazy: `next build` succeeds without configuration, and a missing
or malformed value throws only when the affected feature is invoked.

`/api/health` reports liveness without touching the database;
`/api/health?scope=readiness` checks Postgres, storage, email delivery, backup
verification and queue depth. Readiness returns `503` only when the database or
storage is unavailable.

## Commands

| Command | What it does |
| --- | --- |
| `bun run dev` | Next.js dev server on Node |
| `bun run build` / `start` | Production build / server under Bun |
| `bun run lint` | ESLint 9 with `eslint-config-next` |
| `bun run typecheck` | `tsc --noEmit`, strict mode |
| `bun run test` / `test:unit` | Unit suite — pure logic only, no database or network |
| `bun run test:integration` | Real Postgres in a disposable `herald_test_*` database |
| `bun run test:smoke` | Build plus the dashboard streaming-boundary smoke test |
| `bun run test:browser` | Playwright browser projects |
| `bun run test:all` | Unit and integration suites together |
| `bun run check:no-mocks` | Fails when a test mocks a module or import |
| `bun run db:generate` / `db:migrate` / `db:studio` | Drizzle workflow |
| `bun run db:seed-herald` / `db:import-help` | Load the demo workspace and publish `docs/help` |
| `bun run db:reconcile-boards` | Read-only board-backfill report; add `--apply` to repair |
| `bun run backups:verify` / `alerts:test` | Check backup integrity / deliver a synthetic alert |
| `bun run analytics:signup-funnel` | Aggregate signup funnel report, no PII |

`next lint` was removed upstream in Next 16, so linting uses `eslint` directly
with [eslint.config.mjs](eslint.config.mjs).

## Testing

Two server suites run with Bun, plus Playwright for browser coverage. Install
the browsers once with `bunx playwright install` if the browser suite is new.

- **Unit** (`test:unit`): pure logic — permissions, validation, tenancy guards,
  session tokens, entitlements, import adapters, widget parsing and
  observability helpers.
- **Integration** (`test:integration`): real Postgres, real migrations and real
  queries. The harness creates a unique `herald_test_*` database, applies every
  journal entry, and rolls each test back. `TEST_DATABASE_URL` needs a role with
  `CREATEDB`; without a database the suite fails loudly rather than skipping.
- **Browser** (`test:browser`): Playwright projects for public and dashboard
  flows. `test:smoke` covers the streaming boundary after a production build.

CI runs `typecheck` → `lint` → `test:unit` → `test:integration` →
`check:no-mocks` → `build` against Postgres 16. Tests do not mock modules or the
database; the no-mock check enforces it.

## Deploying

1. Build with `bun run build`.
2. **Bun as the package manager does not make your host run Bun.** `bun.lock`
   governs installs; the platform's Node runtime can run the `next start`
   output. To run the server under Bun, the host must explicitly use Bun.
3. Set the required variables as real secrets, plus `CRON_SECRET` for scheduled
   publishing and `RESEND_API_KEY` + `EMAIL_FROM` for notifications.
4. Run `bun run db:migrate` as a release step — migrations never run at startup.
5. Run `backups:verify` and `alerts:test` with production secrets, then check
   `/docs`, `/status` and `/api/health?scope=readiness`.
6. Point health checks at `/api/health?scope=readiness`.

## Known limits

- CRM sync is read-only: it caches HubSpot and Salesforce totals but never
  writes back.
- No cloud object-storage driver ships. `STORAGE_DIR` must be a persistent
  volume, or the operator implements `StorageProvider`.
- A scanned PDF with no text layer is refused as a knowledge source; there is no
  OCR fallback. Moderation image checks use a separate OCR provider.
- Provider deliveries are implemented, but CI uses local injected endpoints, not
  live Resend, Stripe, AI or Sentry accounts. Test them in staging.
- Custom-domain host routing is implemented but has not been exercised against
  live DNS and TLS.
- No official container image or infrastructure-as-code ships; packaging and the
  scheduler are operator choices.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) for local setup, the exact check order,
the no-mock rule, server-action conventions and help-center front matter.
