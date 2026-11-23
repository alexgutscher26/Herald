# Data processing and retention

This document describes what Herald stores, why, and which deletion windows are
actually enforced by code. It is written from the schema and the retention
jobs, not from a policy template. Where a window is a provider setting rather
than an application rule, it says so.

Read it with [security-review.md](security-review.md),
[observability.md](observability.md#log-retention) and the public
[subprocessor list](/legal/subprocessors). It is not a DPA and it does not
replace the customer's own records-of-processing obligation.

## Roles and scope

- **Workspace members** authenticate with Better Auth and belong to a
  workspace through `workspace_members`. Roles are workspace-wide.
- **Customers** are the people who submit, vote, comment, follow or converse.
  A customer is not a workspace user and cannot reach the dashboard
  (ADR [0001](adr/0001-customers-are-not-workspace-users.md)).
- A **workspace** is the tenant boundary. The API token, dashboard session and
  server actions all resolve the workspace from the authenticated principal,
  never from a client-supplied id.
- A **product** scopes boards, releases, help articles and analytics inside a
  workspace.

## What is stored

| Category | Examples | Notes |
| --- | --- | --- |
| Account | Member name, email, image, email-verification state, sessions, SSO/SCIM identifiers | Managed by Better Auth; sessions are rows, not JWTs. |
| Workspace | Name, slug, plan, branding, domains, invitations, roles, audit entries | Billing identifiers are Stripe ids, not card data. |
| Customer | Email, optional name, company link, traits, external id, session and notification preferences | Unique per workspace by normalised email. |
| Customer content | Requests, votes, comments, insights, conversations, messages, attachments, survey responses | Some rows keep the author with `ON DELETE SET NULL` when a customer is erased. |
| Evidence | `feedback_insights` (quote, source, timestamp), context links to help/changelog | Internal only; no public projection reads insights. |
| Help and docs | Collections, articles, revisions, translations | Published public articles are also projected into a Juno knowledge source. |
| Email | Delivery rows, status, provider error text, suppression list | Provider message ids are stored; message bodies are rendered from the row, not copied to the provider log by Herald. |
| Integrations | Slack bindings, issue links, CRM ids, webhook endpoints and signing secrets | Tokens and secrets are stored server-side and never rendered. |
| Billing | Stripe customer/subscription ids, plan, invoice status, trial dates | Card data stays at Stripe. |
| Operations | Jobs and payloads, `job_runs`, alerts, backup verification, audit log | Job payloads can reference customer ids; `/app/admin` never selects them. |
| Analytics | `request_metrics`, `dashboard_view_events`, `signup_funnel_events`, product events | See the privacy notes below. |
| AI | `ai_usage_events` (tokens, estimated cost, model), Juno answers and citations, knowledge chunks and embeddings | Prompts and completions are not copied into usage events. |
| Logs | JSON application logs, error events | Scrubbed before they leave the process. |

### Analytics fields worth naming

- `request_metrics` is one aggregate row per route, method, status class and
  UTC minute. It carries no workspace or user identifier.
- `dashboard_view_events` stores the surface, section, workspace/product and a
  keyed HMAC-SHA256 `actor_ref` truncated to 32 hex characters. It never stores
  the raw user id. The full field list and purpose are in
  [dashboard-analytics-privacy.md](dashboard-analytics-privacy.md).
- `signup_funnel_events` stores a stage, a UTC timestamp and a one-way subject
  hash. It stores no email, IP address, user agent, workspace id or account id.
  See [signup-funnel-privacy.md](signup-funnel-privacy.md).
- Product events store the event name, customer id, timestamp and a JSON
  property bag supplied by the workspace. An event older than 90 days is
  refused at ingestion (`occurred_at` window), which bounds backfill but is not
  a deletion policy.

### What is deliberately not stored

- Card numbers or CVCs. Checkout and the customer portal are Stripe-hosted.
- Raw passwords. Better Auth stores a password hash, never the password.
- API tokens in plaintext. Only a SHA-256 hash is stored; the value is shown
  once at creation.
- Full IP addresses for API token usage. The last-used field keeps a network
  prefix and a short user-agent label.
- Request bodies, cookies or authorization headers in logs. The scrubber also
  removes emails, bearer tokens, JWTs, secret query parameters, IP addresses,
  phone numbers and Luhn-valid card numbers from strings.
- Prompts and completions in `ai_usage_events`; those tables answer "how much",
  not "what was said".

## Retention enforced by code

| Data | Window | Enforced by |
| --- | --- | --- |
| Workspace content | While the workspace is active | — |
| Workspace deletion | 30-day grace, then cascade | `purge_workspaces` job, owner request |
| Customer erasure | Immediate on request | `eraseCustomerData`, owner-only |
| Audit log | 365 days | `prune_audit_events` (`AUDIT_RETENTION_DAYS`) |
| Signup funnel events | 400 days | `prune_audit_events` / signup-funnel prune |
| Request metrics | 7 days | `prune_observability` (`REQUEST_METRICS_RETENTION_DAYS`) |
| Dashboard view events | 180 days | `prune_observability` (`DASHBOARD_VIEW_RETENTION_DAYS`) |
| AI usage events | 400 days | `prune_observability` (`AI_USAGE_RETENTION_DAYS`) |
| Backup verifications | 90 days | `prune_observability` (`BACKUP_VERIFICATION_RETENTION_DAYS`) |
| Backup manifests | 35 days | `prune_observability` (`BACKUP_MANIFEST_RETENTION_DAYS`) |
| Application logs | 30 days | Log drain, operator setting |
| Error events | 90 days | Sentry-compatible collector, operator setting |
| Database backups | Provider schedule | Provider PITR/backup setting, not an app table |

Every database window is a delete-by-age statement in a daily job, not a
best-effort UI filter. Lowering an environment value shrinks the window on the
next run; raising it cannot restore rows already deleted.

### What the table does not cover

- **Product events** (`customer_events`) are not pruned by
  `prune_observability`. Deleting a customer or workspace cascades them; there
  is no independent age-based deletion. Treat the workspace's retention
  decision as the control, not this table.
- **Suppression entries** are kept while the address must not be mailed. They
  are removed by an operator action, not by age.
- **Webhook delivery rows**, job payloads and email delivery rows have no
  age-based deletion in this repository. They go with the workspace cascade.
- **Provider backups** age out on the provider's schedule. Herald cannot
  shorten it from application code.
- **Log drains and error collectors** are external. The 30/90-day figures are
  the documented operator setting, not an application guarantee.

If a window above has no code reference in the right-hand column, it is a
provider or operator setting and must be configured where that system lives.

## Deletion and export

- **Export.** `GET /api/app/{workspaceSlug}/export?format=json|csv` requires
  `settings:manage`, is scoped to the authorized workspace and answers
  `private, no-store`. It includes private and archived rows, comments, votes,
  followers, tags and merge history.
- **Customer erasure.** An owner supplies the customer's email in
  **Settings → Privacy**. The customer row is deleted; sessions, votes,
  followers and in-app notifications cascade. Content whose author foreign key
  is `SET NULL` remains for the workspace's record.
- **Workspace deletion.** An owner requests deletion; a 30-day grace period
  starts. Cancelling leaves the workspace intact and a later request starts a
  new period. `purge_workspaces` deletes only uncancelled requests whose
  `purge_after` has passed. The audit row is written before the cascade and is
  intentionally not foreign-key-bound, so it survives as the record that the
  deletion happened.
- **Attachments and covers.** Bytes live in the storage driver; metadata lives
  in Postgres. Deleting a workspace cascades the metadata; the storage objects
  must be removed by the same deletion path or by the operator. A
  database-only restore is incomplete.

## Third parties

Herald sends data to a processor only when that capability is configured:

| Capability | Processor | Data |
| --- | --- | --- |
| Email | Resend or a compatible endpoint (`EMAIL_API_URL`) | Recipient address, rendered message, delivery events. |
| Payments | Stripe | Customer email, plan, subscription and invoice state. |
| Error tracking | Sentry-compatible endpoint (`SENTRY_DSN`) | Scrubbed error context and release tags. |
| AI drafting / Juno | OpenAI-compatible endpoint (`AI_API_URL`) | The prompt needed for the request; usage tokens are stored locally. With no endpoint, Juno cannot generate. |
| Embeddings | Same endpoint when `AI_EMBEDDING_MODEL` is set | Chunk text. Unset uses a local deterministic embedding. |
| Image moderation | `OCR_API_URL` | The image being checked. Unset means checks are recorded as unavailable. |
| Slack, issue trackers, CRM | The workspace's own connection | Only the records the operator links or syncs. |
| Object storage | The storage driver | Uploaded bytes. The shipped driver is local; a cloud driver is an operator extension. |

The public [subprocessor list](/legal/subprocessors) and
[data-residency statement](/legal/data-residency) are the customer-facing
versions. If a workspace enables a capability, that processor receives the
data described above; disabling it stops new sends but does not recall data
already delivered.

## Access and isolation

- Every dashboard page and server action resolves the product or workspace
  from the session and checks a permission before reading or writing.
- Public projections read only published, public rows. Removed, private,
  hidden and never-existing records are indistinguishable at the HTTP layer
  (ADR [0004](adr/0004-public-removals-return-404.md)).
- API tokens are scoped to one workspace and checked per request; a foreign id
  is a `404`, not a permission error that confirms existence.
- Storage downloads are signed, expiring URLs; a key is not a capability on its
  own. The exception is a key referenced by a published public release body,
  which is intentionally readable.
- `/app/admin` is gated by `INTERNAL_ADMIN_EMAILS`, is `noindex` and selects
  aggregates only — no workspace names, customer rows, payloads or error text.

## Open items

These are known gaps in the documentation above, recorded rather than
hidden:

1. Product events, webhook deliveries, job payloads and email delivery rows
   have no independent age-based retention. They are removed by the workspace
   cascade.
2. Provider backup retention is not visible to the application; the operator
   must record it in the incident log and the provider console.
3. The local storage driver has no object lifecycle rule. A future cloud driver
   would need one for orphaned objects.
4. This document describes the code in this repository. A hosted deployment
   may add a log drain, a different database provider or an egress proxy; those
   must be reflected in that deployment's own record.
