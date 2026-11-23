# Security review

Scope: the dashboard, public boards, widget, API v1, webhooks, email inbound and
background jobs. This is a review of the current implementation (November 2026),
not a pen-test report. Every item names the code or test that enforces it.

## Tenant isolation and IDOR

| Control | Evidence |
| --- | --- |
| URL slugs are resolved to a membership before a workspace/product id is used | `src/lib/authz.ts`; `findMembershipBySlug` takes the session user id. Unknown workspaces return 404, not 403. |
| Product lookups are scoped by `workspaceId` | `findProductInWorkspace`; every product page starts with `requireProductContext`. |
| Public content is resolved by all three slugs in one query | `resolvePublicBoard` joins boards → products → workspaces and enforces the public flags, board visibility and archive state. |
| Cross-tenant guessed ids behave like missing rows | `tests/integration/cross-tenant.test.ts` passes real ids from another tenant into public writes, dashboard reads and merges. |
| API and token routes derive the workspace from the token, never the path | `src/features/api-v1/auth.ts`; `/api/v1` has no cross-tenant endpoint. |
| Mutations require the same server-side permission as the page | `requirePermission` in `src/lib/permissions.ts`; hiding a UI control is not authorization. |

**Review note:** audit events are deliberately not FK-bound to a workspace so
the deletion record survives a purge. They contain no customer email, token,
webhook secret or request body.

## XSS and markdown

- Customer-authored markdown is rendered through `react-markdown` without
  `dangerouslySetInnerHTML`; raw HTML is not enabled. Links are rendered by the
  component, not concatenated into HTML.
- Release and knowledge editing use the same renderer. An uploaded SVG is never
  rendered inline; images are served from the storage route with a controlled
  content type.
- The public board and widget use React text interpolation for titles, bodies
  and author labels. `tests/integration/moderation.test.ts` and public tests
  exercise the sanitisation boundary.

**Residual risk:** markdown link schemes are rendered by the upstream component;
do not add a custom `rehype-raw` plugin without an explicit allowlist.

## SSRF

The knowledge crawler (`src/features/juno/crawl.ts`) rejects non-http(s) schemes,
credentials, forbidden ports, loopback/private/link-local IPs (after DNS
resolution), and follows redirects manually with a capped count. It caps response
bytes and time, and re-checks every redirect target. This blocks the usual
`169.254.169.254`, `localhost`, DNS-rebinding and redirect-to-internal patterns.
Webhook destinations are validated separately and loopback/private hosts are
refused.

## Uploads

- `validateUpload` checks MIME type, extension and byte size before storage.
- Image bytes are inspected for sensitive information when the board enables
  it; an unavailable scanner fails closed for that board setting.
- Stored objects are addressed by generated keys, not customer filenames, and
  are served with a content type derived from the stored record.
- Attachments are deleted with their request; a failed database write removes
  objects already written.

## Rate limits, CSRF and origin checks

- Public writes use durable rate-limit counters keyed by request/address:
  submissions, votes, comments, follows, widget events and API tokens.
- Public cookie-authenticated writes call `rejectCrossOrigin` and accept only the
  expected `Origin`; the widget install counter is intentionally unauthenticated
  but limited and stores no identity.
- Dashboard server actions are same-origin React actions; API token creation and
  all `/api/v1` writes require an `Authorization` header, not a cookie.
- Webhook replay and API idempotency use dedupe keys and stored responses.

## Webhook signatures and secret handling

- Outbound webhooks sign `${timestamp}.${rawBody}` with HMAC-SHA256 and send
  `x-herald-signature: v1=<hex>`. Receivers should reject timestamps outside five
  minutes and deduplicate the delivery id.
- Signing secrets and API tokens are stored hashed or encrypted as appropriate;
  the raw token is returned once. The browser never receives the signing secret
  after creation.
- `.env` is ignored. Error reports and job payload views deliberately omit
  secrets; `docs/operations.md` covers rotation.

## Dependency audit

Run on 2026-11-20 with `bun audit` (Bun 1.4.0, committed `bun.lock`, 670 packages
checked). **No high or critical advisory; two moderate.**

| Advisory | Package and path | Severity | Exposure | Disposition |
| --- | --- | --- | --- | --- |
| GHSA-67mh-4wv8-2f99 | `esbuild@0.18.20`, nested under `@esbuild-kit/core-utils@3.3.2` → `@esbuild-kit/esm-loader` (drizzle-kit tooling). The top-level copy is 0.25.12 and `tsx` carries 0.28.2; both are outside the affected `<=0.24.2` range. | moderate | Development only. The advisory concerns the esbuild dev server answering any origin; no build output or running app contains it. | Not fixable within ranges: the dependent pins `~0.18.20`. Follow the drizzle-kit → esbuild-kit chain and re-audit when it moves. |
| GHSA-g3hv-75wg-m249 | `minimatch@10.2.6` via `@typescript-eslint/typescript-estree@8.72.0` (eslint-config-next → eslint). `minimatch@3.1.5` in the same tree is below the affected `>=7.0.0 <11.0.1` range. | moderate | Lint time only: a crafted glob pattern amplifies parsing. No runtime path uses minimatch. | Needs typescript-eslint to accept `minimatch@11`. `bun audit fix --dry-run` reports 0 of 2 fixable because both are blocked by a dependent's range. |

Commands used:

```bash
bun audit                      # full report: 2 vulnerabilities (2 moderate)
bun audit --audit-level=high   # exit 0 here; non-zero on high or critical
bun audit fix --dry-run        # 0 of 2 fixable within the declared ranges
```

`bun audit --audit-level=high` exits `1` as soon as a high or critical
advisory appears, which is what the `audit` job in
[.github/workflows/ci.yml](../.github/workflows/ci.yml) runs on every push and
pull request. A moderate advisory does not fail CI; it is recorded here and
re-checked when a dependent moves.

## Native and platform-specific dependencies

`bun.lock` pins every transitive version and CI installs with
`bun install --frozen-lockfile`, so a native package cannot change underneath a
build without a lockfile change in review.

| Package | Version | Native code | Source | Review |
| --- | --- | --- | --- | --- |
| `pg`, `pg-pool`, `pg-protocol`, `pg-types`, `pgpass` | 8.23.1 | No. `pg`'s `package.json` declares no `gypfile` and no install script; the driver is pure JavaScript over TCP. | `package.json` | `pg-native` (the libpq binding) is an optional peer and is **not installed**; `pg-cloudflare` is an optional dependency Bun does not require. Nothing to pin beyond the lockfile. |
| `sharp` | 0.35.5 | Yes — prebuilt `@img/sharp-*` and `@img/sharp-libvips-*` binaries, no compile step and no install script. | Next.js optional dependency (`next > optionalDependencies.sharp`); no application module imports it. | Used only by the Next image optimizer. Pinned by the lockfile; not in the request path of the API, widget, webhooks or cron routes. |
| `@next/swc-*` | 16.4.6 | Yes — prebuilt per-platform binaries. | Next.js optional dependencies. | One platform binary per install, chosen by the lockfile; no postinstall script. |

There is no `bcrypt`, `canvas`, `better-sqlite3` or other native addon in the
tree.

## Findings and follow-ups

1. **Custom-domain host serving is not implemented.** Verification and health
   checks exist, but TLS termination and host-based routing are deployment
   responsibilities. Document this in the deployment runbook; do not advertise a
   verified domain as serving traffic until the edge is configured.
2. **Image scanning depends on `OCR_API_URL`.** When it is unset, boards that
   require sensitive-image checks refuse image uploads rather than accepting
   unscanned content.
3. **No independent pen-test has been run.** The dependency audit is recorded
   above and enforced in CI; an external review is still required before a paid
   launch.
