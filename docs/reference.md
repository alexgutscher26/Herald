# Herald reference

Long-form reference for the Herald API, integrations, data model, public surfaces, authentication, dashboard, plans and operations. For setup, commands and deployment, start with the [README](../README.md).

## REST API

`/api/v1` is a workspace-scoped JSON API for boards, requests, comments,
votes, tags, changelog drafts, members, companies, support conversations and
product events. It is behind the `FLAG_API` kill switch and is **off by default**; set
`FLAG_API=on` on a deployment that should serve it.

```bash
curl -H "Authorization: Bearer hrl_…" \
  "$BETTER_AUTH_URL/api/v1/requests?status=planned&limit=25"
```

The machine-readable contract is [OpenAPI 3.1](/api/v1/openapi.json) at
`/api/v1/openapi.json`. It is public (it describes the surface, not the data),
so a client generator can read it before it has a token. Its paths are built
from the route manifest in `src/features/api-v1/routes.ts`, and the unit suite
fails if the served document and that manifest disagree. The compatibility and
deprecation policy is in [docs/api-versioning.md](../docs/api-versioning.md).

**Tokens.** A token belongs to one workspace and is created by a signed-in
member with `settings:manage`:

- `GET /api/app/{workspaceSlug}/api-tokens` lists tokens (prefix, scopes,
  `last_used_at`, `revoked_at`, `expires_at`, `rotated_from_id` and a derived
  `status` of `active`, `retiring`, `expired` or `revoked` — never the secret).
- `POST /api/app/{workspaceSlug}/api-tokens` with
  `{ "name": "CI", "scopes": ["read", "write"] }` returns the raw token
  **once**; only its SHA-256 hash is stored. The settings screen at
  `/app/{workspaceSlug}/settings#tokens` can create, copy once, rotate and revoke tokens
  and explains each scope.
- `POST /api/app/{workspaceSlug}/api-tokens/{tokenId}/rotate` with
  `{ "grace_hours": 24 }` (0–168) issues a replacement with the same name and
  scopes and retires the old token after the grace period, so a deploy can
  switch secrets without an outage. The replacement is returned **once**.
- `DELETE /api/app/{workspaceSlug}/api-tokens?token_id=…` revokes it. Rows are
  kept for audit, including a scheduled retirement.
- `GET /api/app/{workspaceSlug}/api-idempotency` lists recent replay rows
  (metadata only: key, endpoint, token, state, timestamps) for owners/admins.

Tokens have fine-grained scopes. `read` covers every GET and `write` every
mutation; `feedback:read` limits reads to boards, requests, tags, custom fields
and changelog; `support:read` limits reads to companies and conversations; and
`admin` implies every current and future scope. A token without the matching
scope gets 403. The workspace is taken from the token row, never from a path or
header, and `/api/v1` has no endpoint that spans tenants.

Each token reports `last_used_at` and a derived `status` (`active`, `retiring`
while a rotation grace period is running, `expired` for an OAuth access token
past its 30-day lifetime, `revoked` afterwards), plus coarse
last-seen metadata: a network prefix (`/24` for IPv4, `/48` for IPv6) and a
short user-agent label. A full client IP is never stored. When the person who
minted a token loses `settings:manage` — demoted in settings, removed, or
deprovisioned over SCIM — the tokens they created are revoked in the same
transaction, so a departed admin cannot leave a working key behind.

**Pagination and filters.** List endpoints take `limit` (1–100, default 25) and
an opaque `cursor` from `pagination.next_cursor`; the cursor is bound to the
sort it was issued for. Requests filter on `status`, `board` (id or slug),
`tag`, `author` (customer id, external id or email), `updated_since`, `q` and
repeatable `custom_field=key:value` pairs. Conversations filter on `inbox_state`
and `assignee`. Supported sorts are `newest`, `oldest`, `updated` and, for
requests, `votes` plus custom-field sorts `custom_field_asc:<key>` and
`custom_field_desc:<key>`. A custom-field key must resolve to one storage type
across the workspace; missing values sort last. Archived and merged requests
are excluded unless `include_archived` / `include_merged` is true.

**Idempotency.** Send `Idempotency-Key` (8–255 characters) on request
creation, comments, changelog creation, conversation replies and notes, and
event ingestion. The first response is stored for the deployment's
`API_IDEMPOTENCY_TTL_HOURS` (24 by default); a retry with the same method, path
and body replays it (`idempotency-replayed: true`) without running the write
again. Reusing the key for a different payload returns 422 and a concurrent
retry returns 409 with `Retry-After`. Owners/admins can inspect replay metadata
at `/api/app/{workspaceSlug}/api-idempotency`.

**Safe defaults.** API-created changelog entries are always drafts — there is
no publish action on the API. `internal: true` comments and `/notes` are
team-only and never returned by a customer-facing surface. When a request is
created with `customer`, the board's approval policy still applies, so a
moderated board answers `visibility: awaiting_review` instead of bypassing
moderation.

**Limits and errors.** Each token gets a plan allowance per 60 seconds — Free
60, Indie 120, Professional 600 and Founding Lifetime 300 (durable, per token).
The API itself is available on Professional and Founding Lifetime. A 429
carries `Retry-After` and the current `x-ratelimit-limit`. Every response is
`private, no-store` and carries `x-request-id` plus `x-api-version: 1`. Errors
use one shape: `{ "error": { "code", "message", "request_id", "details?" } }`.

Worked examples for the main write workflows live in
[docs/api-workflows.md](../docs/api-workflows.md) and in the OpenAPI document's
`examples` blocks. Event ingestion, `event_id` dedupe and the SDK helper are
covered in [docs/api-events.md](../docs/api-events.md). MCP clients can use a
bearer token or the OAuth flow described in [docs/mcp-clients.md](../docs/mcp-clients.md).

## Webhooks

Workspaces can subscribe an HTTPS endpoint to API writes. Webhooks are managed
by a signed-in owner/admin at `/api/app/{workspaceSlug}/webhooks` or the
**Integrations → Webhooks** console at
`/app/{workspaceSlug}/{productSlug}/integrations/webhooks`. The console lists
every event with its complete JSON envelope, sends a real test event through
the normal signed path, rotates secrets and replays dead-letter deliveries.
Delivery is owned by the `/api/cron/webhooks` scheduler.

Events: `request.created`, `request.updated`, `comment.created`,
`changelog.created`, `conversation.updated`, `message.created`, and
`customer.event`. A delivery is enqueued in the same unit of work as the API mutation; a webhook failure never
fails the customer request.

```bash
# Create (returns the signing secret once)
curl -X POST "$BETTER_AUTH_URL/api/app/acme/webhooks" \
  -H 'content-type: application/json' \
  -d '{"name":"CI","url":"https://hooks.example.com/herald","events":["request.created"]}'
```

Each POST carries `x-herald-event`, `x-herald-delivery`, `x-herald-timestamp`
(Unix seconds) and `x-herald-signature: v1=<hex>`, where the HMAC-SHA256 is
computed over `${timestamp}.${rawBody}`. Verify against the raw bytes before
parsing, reject timestamps outside five minutes, and deduplicate on
`x-herald-delivery`.

Retries use exponential backoff (`30s → 2m → 8m → 32m → 2h8m`) with 20%
jitter (five attempts). A 2xx marks the delivery succeeded; anything else,
including a timeout, retries. The delivery
log is at `GET /api/app/{workspaceSlug}/webhooks/{webhookId}/deliveries`
(optionally `?status=pending|succeeded|failed|skipped`), and a single delivery
can be requeued with `POST …/deliveries/{deliveryId}/replay`. Both require
`settings:manage`.

Rotate a signing secret with `POST /api/app/{workspaceSlug}/webhooks/{webhookId}/rotate`.
The replacement is returned once; the old secret remains valid for 24 hours and
is sent in `x-herald-signature-previous` so a receiver can deploy the new value
without dropping in-flight deliveries.

The dead-letter view is `GET /api/app/{workspaceSlug}/webhooks/deliveries`,
which lists failed deliveries across every hook with the hook's name and URL
(`?status=` accepts the same values; the default is `failed`). Replaying a row
puts it back in the queue and removes it from the failed view; the original
payload, already frozen and signed in storage, is what gets sent. Bulk replay
is `POST /api/app/{workspaceSlug}/webhooks/deliveries/replay` with
`{ "delivery_ids": [...] }` (1–100 ids).

In sandbox mode (`SANDBOX_MODE=on`) deliveries are marked `skipped` with a
reason instead of calling the receiver, so they appear in the log but never in
the failed count.

Scheduled delivery needs `CRON_SECRET` and a scheduler call, e.g. every minute:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "$BETTER_AUTH_URL/api/cron/webhooks"
```

Webhook URLs must be absolute `http(s)` URLs without credentials, and loopback,
link-local and private addresses are refused so a workspace cannot use a
webhook to probe the deployment's network. DNS is not pinned at send time. A
production deployment **must** route outbound webhook traffic through an egress
proxy that resolves and pins public addresses, blocks private, loopback,
link-local and metadata ranges, and re-checks every redirect. Without that
control, a hostname that passes validation can rebind to an internal address;
this is a hard deployment requirement, not an optional hardening step.

## Slack

Each product can connect one Slack channel from **Integrations**. A top-level
message in that channel becomes a request on a suggested board, and status
changes reply under the original message. The app uses Slack OAuth with
`channels:history`, `channels:read`, `chat:write`, `commands`, `groups:history`,
`groups:read`, `links:read`, `links:write` and `team:read`; configure its
Events API URL at `/api/integrations/slack/events`, slash-command URL at
`/api/integrations/slack/commands` and redirect URL at
`/api/integrations/slack/callback`, then set `SLACK_CLIENT_ID`,
`SLACK_CLIENT_SECRET` and `SLACK_SIGNING_SECRET`.

The events endpoint verifies Slack's signed request over the raw body,
deduplicates retries by `team_id + event_id`, and acknowledges before a durable
job files the request. Board and title suggestions use the configured AI
provider when one is available; otherwise the first line and first active board
are used. A top-level message beginning `!support` starts a support
conversation instead of filing feedback; replies in that thread continue it,
and a team reply from the inbox mirrors back into the thread. A Slack team can
connect different products to different channels, but a channel belongs to one
product. Pasting a public Herald request URL in a connected channel unfurls a
title/status/vote preview, resolved through the public projection so private or
hidden requests cannot leak. `/herald <text>` files a request from any message
in the connected channel and replies through Slack's response URL. See
[docs/slack-integration.md](../docs/slack-integration.md) for the app setup and the
exact message/support behavior.

## Support-tool capture

Intercom and Zendesk can turn a conversation or ticket into a feedback request
without an OAuth or provider API token. Connect one provider per product under **Integrations →
Support-tool capture**, choose the destination board, and paste the generated
URL into the provider's webhook configuration:

`https://app.example.com/api/integrations/support-tools/<token>`

The URL token is the authenticator and is treated as a secret. Zendesk tickets
use the ticket id, subject/description, requester and comments; Intercom uses
the conversation source and parts. The external id is unique per connection, so
a provider retry returns the original request instead of creating a duplicate.
Captured requests are written with `source = 'support'` and `privacy = 'author'`:
a teammate can triage them on the board, but they cannot become public merely
because the provider webhook arrived. Rotating the URL in settings invalidates
the previous one immediately; disconnecting does the same and leaves existing
requests untouched.

## GitHub App

Private-repository issue imports and GitHub issue-tracker connections use a
GitHub App installation, not a personal access token. Set `GITHUB_APP_ID`, `GITHUB_APP_SLUG` and
`GITHUB_APP_PRIVATE_KEY`, and configure the App's **Setup URL** as
`https://app.example.com/api/integrations/github/callback`. Then install it from
**Integrations → GitHub**. Herald stores only the installation id and public
account metadata; it mints a one-hour installation token when an import or
issue-tracker call needs one and never persists it. A personal token remains
optional for a one-off import or issue-tracker connection when the App is not
configured.

## Issue-tracker sync

Each product can connect one issue tracker per provider: Linear, Jira, GitHub,
ClickUp or Azure DevOps. On a request, **Create issue** files it in the tracker
and **Link existing** attaches an issue that already exists. The connection's
status map turns an external status name into a Herald status, so moving the
issue moves the request. Writes are attributed to the signed-in member in
`workspace_audit_events`, and to the external actor when a webhook supplies one.

| Provider | Connection fields | Webhook authentication |
| --- | --- | --- |
| Linear | team id, API key, signing secret | `Linear-Signature` HMAC-SHA256 |
| Jira | site origin, API user email, project key, issue type, API token | unguessable URL token |
| GitHub | owner, repository, token (optional with the GitHub App), signing secret | `X-Hub-Signature-256` |
| ClickUp | list id, token, signing secret | `X-Signature` HMAC-SHA256 |
| Azure DevOps | organization, project, work-item type, area path (optional), PAT | unguessable URL token |

Point the tracker's webhook at the URL shown on **Integrations**, for example
`https://app.example.com/api/integrations/issues/<token>`. Jira and Azure
DevOps admin webhooks do not sign reliably, so their unguessable URL token is
the authenticator; the signed providers are checked over the raw body before
the payload is parsed. Rotate a Jira/Azure URL token from **Integrations** at
any time; the old URL stops working immediately. **Disconnect** also deactivates
the connection, so its old token returns 404 as well.

The pending link is inserted before the provider call and `(request,
connection)` is unique, so a double click or retry cannot create two external
issues. If a provider reply is lost, the link stays failed and the UI asks a
person to link the issue manually rather than silently retrying. Inbound
deliveries are deduplicated by a unique event key: a retry applies no second
status change and writes no second audit row. A merged request is never moved
by a webhook — its canonical request owns the status. A mapped status change
queues the normal follower notifications, Slack reply and `request.updated`
webhook.

Herald also pushes its own status changes out to every linked issue (dashboard,
API and release publishing), using the first external status mapped to the new
Herald status. Each push is recorded as an `issue.status_push` event; an
unmapped status is skipped rather than guessed, and a tracker outage leaves the
committed Herald write intact with the error on the link.

## CRM sync

A workspace can connect one HubSpot or one Salesforce account, read-only, from
**Integrations**. A daily job (`schedule_crm_sync`) enqueues one
`sync_crm_connection` job per active connection; **Sync now** queues the same
job. HubSpot is matched by the company's stored domain or cached HubSpot id,
Salesforce by account id or website. Only a match updates the cache.

The job writes `customer_companies.crm_contact_count`,
`crm_open_deal_count`, `crm_open_deal_value_cents` and
`crm_annual_revenue_cents`, and attaches HubSpot contact ids, lifecycle stage
and company id to customers who already belong to that company. A customer only
receives a CRM contact when its normalized email is in the company's contact
list. Cached fields are never accepted from a form or API client: they are
read-only on the request and on the integrations page, and every update is
scoped by the connection's workspace.

CRM credentials are workspace-scoped and never rendered after saving. The
adapters expose no create, update or delete call. A failure marks only the
affected company with `crm_sync_error` and the connection's `last_error`; other
companies continue. One run processes up to 200 companies and reports
`truncated` when more remain.

## Sandbox mode

Set `SANDBOX_MODE=on` to exercise real flows without contacting anyone. While
it is on, every outbound email is recorded as `skipped` at send time (test
emails return a clear sandbox error) and every webhook delivery is marked
`skipped` without an HTTP request. Database writes, outbox rows, idempotency,
rate limits and audit fields all behave normally, so imports, moderation and
reply flows can be tested end to end. This is a deployment switch, not a
workspace preference, and it is checked at the provider boundary as a last line
of defence.

## MCP server

`POST /api/mcp` is a remote MCP server (Streamable HTTP) whose tools mirror the
v1 API. It accepts a workspace bearer token or the built-in OAuth 2.1 flow, and
uses the same scopes, rate-limit bucket, tenant rules and idempotency as
`/api/v1`; one MCP request consumes one rate-limit unit.
Tools are read-first and safe by default: changelogs are created as drafts,
customer replies are separate from internal notes, and every write accepts an
`idempotency_key`. There is no MCP tool that publishes, sends email or changes
billing.

Client setup for Cursor, Claude, ChatGPT and VS Code is published in
[docs/mcp-clients.md](../docs/mcp-clients.md). Zapier and Twilio Segment setups are in
[docs/integrations/zapier.md](../docs/integrations/zapier.md) and
[docs/integrations/segment.md](../docs/integrations/segment.md); both use Herald's
signed webhooks rather than marketplace apps.

Setup uses a placeholder origin and a token created as described above. Keep
the token in an environment variable, never in a committed file.

**Claude Code**

```bash
claude mcp add --transport http herald https://app.example.com/api/mcp \
  --header "Authorization: Bearer $HERALD_TOKEN"
```

**Cursor** — `.cursor/mcp.json` (or `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "herald": {
      "url": "https://app.example.com/api/mcp",
      "headers": { "Authorization": "Bearer ${env:HERALD_TOKEN}" }
    }
  }
}
```

**Codex CLI** — `~/.codex/config.toml`:

```toml
[mcp_servers.herald]
url = "https://app.example.com/api/mcp"
bearer_token_env_var = "HERALD_TOKEN"
```

**Windsurf** — `~/.codeium/windsurf/mcp_config.json` (or the per-user
`mcp_config.json` opened by “Open MCP config file”):

```json
{
  "mcpServers": {
    "herald": {
      "serverUrl": "https://app.example.com/api/mcp",
      "headers": { "Authorization": "Bearer ${env:HERALD_TOKEN}" }
    }
  }
}
```

**ChatGPT and other OAuth clients** use the connector URL
`https://app.example.com/api/mcp` and discover the authorization server from
`/.well-known/oauth-protected-resource`. Herald registers a public client,
requires PKCE S256, asks the signed-in owner/admin to choose a workspace and
issues a 30-day token that appears under Settings → API tokens as
`MCP · <client>`. Revoking that token disconnects the client. The full flow and
manual endpoint URLs are in [docs/mcp-clients.md](../docs/mcp-clients.md).

The server supports the session-era MCP revisions (`2025-03-26`,
`2025-06-18`, `2025-11-25`) and accepts the newer `2026-07-28` revision; it
answers JSON (not SSE) and issues no session id, so any request is
self-contained. Prompts for common operator jobs are in
[docs/headless-routines.md](../docs/headless-routines.md).

## Neon connection configuration

**Driver:** `pg` (node-postgres) over TCP through a `pg.Pool`
([src/db/index.ts](../src/db/index.ts)).

The HTTP-only Neon driver was rejected on purpose: it issues each statement as an
independent HTTP request and cannot run an interactive transaction. This
application needs real transactions — onboarding creates a workspace, its owner
membership and the first product atomically, and Better Auth's Drizzle adapter
runs multi-statement units of work.

Use Neon's **pooled** endpoint (`ep-xxxx-pooler...`) so connection counts stay
within Neon's limits. `BEGIN`/`COMMIT` behave correctly through the pooler's
transaction pooling mode.

## Migrations

Migrations are the production workflow. Nothing pushes schema changes or loads
data at startup. The `db:seed*` scripts are explicit local/demo commands; they
refuse production and are never part of a deploy.

```bash
bun run db:generate   # generate versioned SQL + snapshot into ./drizzle
bun run db:migrate    # apply pending migrations (needs DATABASE_URL)
bun run db:studio     # Drizzle Studio
```

`db:generate` needs no database. The committed migrations in
[drizzle/](../drizzle/) create the tables, enums, indexes, composite foreign keys
and check constraints.

### Board backfill reconciliation

`bun run db:reconcile-boards` re-checks the invariant migration `0003`
established: one default `feedback` board per product and every feedback post
assigned to a board. It prints counts only — never product names or ids — and
exits `1` when it finds drift.

`--apply` creates missing default boards and assigns posts with a null board in
one transaction, re-checks the result before committing, and refuses to run
while a post points at a board from another product. The command is idempotent;
run it without the flag first to see what would change.

## Database schema at a glance

- **Auth:** `user`, `session`, `account`, `verification`
- **Tenancy:** `workspaces`, `workspace_members`, `products`
- **Customers:** `customers`, `customer_companies`,
  `customer_company_memberships`, `customer_sessions`, `customer_login_tokens`,
  `workspace_identity_settings`
- **Boards and feedback extensions:** `boards`, `board_tags`,
  `feedback_tag_links`, `feedback_followers`, `feedback_reactions`,
  `feedback_attachments`, `feedback_customer_votes`, `moderation_reviews`,
  `blocked_customers`, `feedback_merges`, `feedback_imports`,
  `feedback_import_rows`
- **Appearance:** `workspace_branding` (brand name, logo key, accent colour,
  theme, locale)
- **Product:** `releases`, `feedback_posts`, `feedback_votes`,
  `release_feedback_links`, `subscribers`, `notification_deliveries`,
  `in_app_notifications`.
- **Conversations:** `conversations`, `conversation_messages`,
  `conversation_participants`, `conversation_attachments`,
  `conversation_reminders`, `conversation_notifications`, `conversation_drafts`,
  `product_email_settings`, `workspace_operators`, `product_support_settings`,
  `intake_questions`.
  Messages carry `channel` (`team`/`widget`/`email`) and an optional provider
  `external_id`; `unread_for_customer` is separate from the team counter.
  `source_context` holds the widget referrer, locale, timezone and a truncated
  user agent (no IP address), and `away_reply_sent_at` marks an away period.
  CSAT lives on the thread (`csat_requested_at`, `csat_rating`, `csat_rated_at`),
  never as a message; intake answers live in `customers.traits`.
  There is no roadmap table: Planned, In progress and Done are feedback statuses.
- **Win-back:** `cancellation_reasons`, `customer_accounts`,
  `customer_cancellations`, `release_reason_links`, `winback_campaigns`,
  `winback_campaign_recipients`, `workspace_email_identities`
- **Operations:** `jobs`, `job_runs`, `email_suppressions`, `rate_limit_counters`
- **Plans:** `workspaces.plan` (`free` | `starter` | `pro`, default `free`) is
  a denormalised cache. `workspace_subscriptions` is the billing source of
  truth; limits and feature definitions live in code.

Invariants worth knowing:

- Workspace slugs are globally unique; product slugs are unique **per
  workspace**; release slugs are unique **per product**.
- Customer external ids are unique per **(product, provider)**.
- Subscriber emails are unique per **product**, keyed on the normalized form
  (`trim` + lowercase; no dot or `+tag` stripping).
- Customer emails and external ids are unique per **workspace**, and only
  when present — a guest customer exists before either is known.
- Board slugs are unique per **product**; a customer-company membership keeps
  both sides in the same workspace through composite foreign keys.
- Reactions and attachments have exactly one target (post *or* comment),
  enforced by a check constraint; partial unique indexes prevent duplicate
  reactions where the other target is null.
- One vote per **(post, authenticated voter)** in `feedback_votes`, and one
  per **(post, customer)** in `feedback_customer_votes` — each enforced by a
  unique constraint, not just application code. The public count is the sum of
  both, so a team vote and a customer vote are never conflated.
- `release_feedback_links` uses a **composite foreign key** including
  `product_id`, so a row can never join a release and a request from two
  different products.
- The roadmap has no rows of its own. `feedback_posts.status` is the only
  source: `planned`, `in_progress` and `shipped` become Planned, In progress
  and Done, and merging a duplicate removes it from the projection.
- `notification_deliveries.dedupe_key` is unique and is the idempotency key for
  outbound messages. A delivery may point at a release, a feedback request or
  comment, a win-back recipient or a weekly-digest week; the dedupe key, not a
  source constraint, prevents the same event being queued twice.
- `in_app_notifications.dedupe_key` is unique too, so a retried status change or
  job cannot create a second unread row for the same customer and event.
- Campaign `approval_status` and `send_status` are separate columns;
  `winback_campaign_recipients.exclusion_reason` is populated whenever a
  recipient is excluded, and `attribution_basis` distinguishes `inferred` from
  `confirmed` conversions — an inferred conversion is never presented as proof
  of causation. A return only counts within 30 days of the recipient's
  `sent_at`; the write path and the UI both enforce the cutoff.
- Sending starts with a canary of at most five recipients. The remaining
  audience is refused until no canary recipient is still `pending`/`queued`.
  `winback_campaigns.stopped_at` is the kill switch: pending recipients become
  `campaign_stopped` exclusions, queued deliveries become `skipped`, and the
  worker refuses to send a stopped campaign.
- Feedback has six database states (`open`, `under_review`, `planned`,
  `in_progress`, `shipped`, `closed`); the former `declined` value is
  backfilled to `closed`.
- Every product has one default `feedback` board; existing feedback posts were
  assigned to it in migration `0003_jazzy_queen_noir.sql`, and onboarding
  creates the board for new products.
- Subscription status (`subscribers.status`, preserved on unsubscribe) is
  separate from win-back eligibility
  (`customer_accounts.winback_eligibility`, default `unknown`).
- Imported posts are unique per **(import, source row)**, so a retried import
  job resumes without duplicating a request. `feedback_posts.imported_vote_count`
  keeps external votes separate from live team and customer votes, and merge
  history records the imported votes it moved.
- A workspace has at most one branding row (the workspace id is the primary
  key); absent rows mean the documented defaults, not a second "unset" state.

## Architecture decisions

- [ADR 0001: customers are not workspace users](../docs/adr/0001-customers-are-not-workspace-users.md)
  — public visitors are workspace-scoped `customers` with their own hashed
  cookie, never Better Auth users.
- [ADR 0002: feedback status is the roadmap source of truth](../docs/adr/0002-feedback-status-is-the-roadmap-source-of-truth.md)
  — the six feedback states answer "what are we building"; the retired
  roadmap item tables are replaced by that projection.
- [ADR 0003: roles are workspace-wide](../docs/adr/0003-workspace-wide-roles.md)
  — permissions and custom roles apply to the whole workspace, not per product.
- [ADR 0004: public removals return 404, not 410](../docs/adr/0004-public-removals-return-404.md)
  — removed, private and never-existing public URLs stay indistinguishable;
  merged duplicates still redirect permanently.

## Public surface

Public reads do not use a dashboard session:

- `GET /api/public/boards/{workspace}/{product}/{board}` resolves the board by
  path and returns only public requests. Unknown, private and archived boards
  all return 404.
- `GET /api/public/boards/{workspace}/{product}/{board}/requests/{id}` looks the
  request up *inside* that board, so guessed UUIDs cannot cross tenants.
- `GET /p/{workspace}/{product}/{board}` is the server-rendered board. Search
  (`q`), `status`, `tag`, `sort=top|trending|newest` and `page`/`pageSize` are
  plain query parameters, so every view is linkable and works without
  JavaScript. Each board generates its own title, description, canonical URL,
  generated Open Graph image and large Twitter card; filtered or paginated
  views are `noindex, follow`. Unknown, private and archived boards are a 404.
- `GET /p/{workspace}/{product}/roadmap` is the public roadmap: Planned, In
  progress and Done, with vote counts and per-column empty states. It reads
  only approved, visible, unmerged requests on public, non-archived boards.
  The product's `public_roadmap_enabled` switch controls it independently of
  `public_feedback_enabled`; when feedback is off the roadmap renders cards as
  plain text instead of linking to request pages.
- `GET /p/{workspace}/{product}/updates` is the public changelog, with an
  entry page at `/updates/{slug}` and an RSS feed at `/updates/rss.xml`. The
  product's `public_changelog_enabled` switch is independent of boards and the
  roadmap. Entries carry tags, multiple authors, a YouTube embed when set, SEO
  metadata, generated Open Graph images and a “Built from your feedback” list
  filtered to the viewer's visible requests.
- `GET /p/{workspace}/{product}/notifications` is the signed-in customer's
  in-app inbox. It is `noindex`, scoped to the session cookie and product, and
  links each row to the request or changelog entry that caused it.
- `GET /p/{workspace}/{product}/{board}/{requestId}` is the request page:
  votes, comments, reactions, follow/unfollow, merged duplicates, similar
  requests, signed attachment links and published releases that cite the
  request. A pending submission is visible to its author as an “awaiting
  review” receipt and to nobody else; a rejected one is the same 404 as a
  missing id. A merged duplicate’s old URL permanently redirects (308) to the
  canonical request when that request is still public.
- `GET /p/{workspace}/{product}/{board}/submit` is the submission form: board
  picker, image/PDF/text attachments with per-file removal, duplicate
  suggestions while typing, an optional email that identifies the session,
  and a receipt that says whether the request is live or awaiting review. When
  the product opts in and AI is configured, the form can preview one rewrite
  and up to three split drafts; the customer must choose the wording and each
  split, the original wording is retained, and every split records its parent.
  It can also capture the screen, paste an image, or pick a screenshot, then draw
  boxes and freehand marks before attaching the annotated PNG to the same
  submission. Capture is optional and stays local until submit; paste and the
  normal picker work when a browser or iframe blocks display capture.
- `POST .../requests` accepts multipart form data. `POST|DELETE` on
  `.../{id}/vote`, `.../{id}/follow` and `.../{id}/reactions`, plus
  `POST .../{id}/comments`, are the engagement writes. All are same-origin and
  rate-limited; guest sessions are created only where the board allows guest
  posting.
- `GET .../requests/suggestions?q=` searches every public board of the product
  for duplicates and skips private, archived, hidden, merged and pending
  requests.
- Merging a request moves its comments, votes, reactions, followers, tags and
  attachments to the canonical request; engagement the target already had is
  never counted twice. The merge is recorded and can be undone from the
  dashboard, which moves back exactly what the merge moved. Only the canonical
  request's status appears on the public roadmap.
- Hiding one request takes it out of boards, search, duplicate suggestions,
  similar requests and its own URL without deleting it. Banned authors' content
  disappears the same way, and their sessions are revoked immediately.
- Tags are board-scoped and assigned from the dashboard. The public board
  exposes them as filters, and a tag from another board is never accepted.
- Public pages are branded per workspace: `workspace_branding` holds an optional
  logo, brand name, six-digit accent colour, light/dark/auto theme and a locale
  of `auto`, English or Spanish. The layout applies the accent as CSS variables
  only after validating it as hex, and `auto` theme follows the visitor's OS.
- Copy is translated through one typed catalogue
  ([src/features/public/i18n/](../src/features/public/i18n/)). Locale precedence
  is an explicit visitor choice cookie, then the workspace setting, then
  `Accept-Language`, then English; customer-written titles and bodies are never
  translated. The header language switch sets a year-long cookie and returns to
  a validated same-site path.
- `GET /p/{workspace}/{product}/preferences?token=…` is the email preference
  page linked from product-update emails. The token identifies the subscriber;
  it can stop or resume product updates and separately opt out of win-back
  messages.
- The resolver and projections live in `src/features/public/`. They exclude
  internal comments, archived and merged requests, banned authors, rejected
  moderation decisions and every email or customer trait; there is no public
  import of the dashboard snapshot.
- Discoverability is generated from those projections: `/sitemap.xml` lists
  enabled public roadmaps, public, non-archived boards and the requests
  visible on them,
  `/robots.txt` keeps `/app`, `/api`, the auth screens and token-bearing
  preference/login pages out, and `BETTER_AUTH_URL` supplies the absolute
  origin for canonicals, Open Graph URLs and the sitemap. Open Graph images are
  rendered per board and per request at 1200×630 from the same resolved record.
- Removed, private and archived URLs all return the same 404 with a public
  not-found page, so a non-public board is never disclosed. App Router pages
  cannot emit 410; archived boards deliberately share the 404 rather than
  weaken that anti-enumeration rule, while merged duplicates get a 308 to the
  canonical request. The permanent-404 choice is recorded in
  [ADR 0004](../docs/adr/0004-public-removals-return-404.md).
- Public search explains its ordering, offers the product's enabled sections
  when a query has no matches, and emits `noindex, follow` on every query page;
  `/robots.txt` also excludes the search route.
- Cookie consent is one first-party `herald_consent` cookie. Optional public
  analytics is gated server-side, YouTube iframes wait for an explicit embed
  choice, and the default is restrictive in the EU/EEA, UK, Switzerland and
  similar jurisdictions. Privacy and terms sit alongside the DPA,
  sub-processor and residency pages.

Customer sessions are short-lived and separate from Better Auth:

- `POST /api/public/session` creates a guest customer and a 24-hour `httpOnly`
  `herald_customer_session` cookie for a workspace with a public board.
- `POST /api/public/session/identify` attaches an email and optional name, then
  **rotates the token**. An email owned by another customer is rejected until a
  future verified sign-in flow can safely merge it.
- `POST /api/public/session/logout` revokes the row and clears the cookie.
- `POST /api/public/session/sso` and `POST /api/widget/identify` verify a
  workspace-signed HS256 JWT (`sub`, `iss`, `aud`, `iat`, `exp`) and establish
  or upgrade the customer session. Tokens are checked against the workspace's
  encrypted signing secret and fail closed when SSO is disabled, the secret was
  rotated, or a claim does not match.
- `POST /api/public/auth/magic-link` emails a single-use, 15-minute sign-in
  link; `GET /api/public/auth/magic-link/verify` consumes it and redirects to a
  re-validated same-site path. Signing in upgrades the visitor's guest session
  and moves that guest's posts and votes onto the verified customer rather than
  creating a duplicate. Only a hash of each token is stored, and issuing a new
  link invalidates any outstanding one.
- `/p/{workspace}/{product}/login` is the customer sign-in page. The public
  profile menu lists the signed-in identity and signs out.

Support conversations share the same session:

- `GET /api/public/conversations?workspaceSlug=…&productSlug=…` lists the
  signed-in customer's threads. `POST` starts one, issuing a guest session first
  when the visitor has none. Both require a public, widget-enabled product and
  scope every read by the session's `customer_id`.
- `GET|POST|PATCH /api/public/conversations/{id}?workspaceSlug=…&productSlug=…`
  reads a thread, replies to it, or marks it read. A thread that belongs to
  another customer is a 404, never a 403. POST and PATCH reject a foreign
  `Origin`/`Sec-Fetch-Site`.
- `POST /api/public/conversations/{id}/csat?workspaceSlug=…&productSlug=…`
  records one 1–5 rating for a resolved thread owned by the session, and
  refuses a second rating with a 400.
- `POST /api/email/inbound` accepts either a signed Resend `email.received`
  event or normalized JSON
  `{ to, from, fromName?, subject?, text, messageId?, headers? }` with
  `Authorization: Bearer $EMAIL_INBOUND_SECRET`. The Resend path verifies the
  `svix-*` headers over the raw body with `RESEND_INBOUND_WEBHOOK_SECRET`, then
  fetches the body from `GET /emails/receiving/{email_id}` because Resend's
  webhook carries metadata only. Both paths enter the same parser and thread
  dedupe.
- A new thread is addressed to `support+<product token>@$EMAIL_INBOUND_DOMAIN`;
  a reply goes to `reply+<thread token>@…`. Tokens are case-sensitive. Bounces,
  auto-replies/OOO and marketing are dropped before the inbox, a sender who
  does not own the thread is rejected, and a provider retry with the same
  `Message-ID` adds no second message.
- A team reply queues one `conversation_reply` email whose `Reply-To` is the
  thread address, but only when the customer has an address, the thread has a
  reply token and the address is enabled. Pause, rename and rotate it on
  Settings → Email forwarding; operator hours and presence live beside it.
- Operators choose their own alerts (email, in-app, new conversations, replies)
  on Settings → Operators. Alerts are per-user rows in
  `conversation_notifications` with a unique dedupe key, and email uses the
  `conversation_notification` template; the inbox shows them with “Mark all
  read” and opening a thread clears that thread's alerts. While nobody is
  available, one customer message per away period gets a system reply on the
  thread plus a `conversation_away_reply` email when the customer's address and
  forwarding allow it; a human reply ends that period.
- CSAT is off by default per product (`product_support_settings.csat_enabled`).
  On the first transition to `resolved`, a trigger stamps `csat_requested_at`
  once; the widget then offers one 1–5 rating, stored on the conversation in
  `csat_rating`/`csat_rated_at`, never as a message. Reopening and resolving
  again does not ask twice, `POST /api/public/conversations/{id}/csat` refuses a
  replay, and Analytics reports the average and response count. Email-only
  customers do not yet receive a rating link.
- Structured intake questions live in `intake_questions` (widget-wide or scoped
  to one board) and are asked as optional fields on the widget start form and
  the public submit form. Answers merge into `customers.traits`; blank, unknown
  and invalid answers are dropped, and a guest can always submit without
  answering. A trait key that already gates a board cannot be used for intake,
  and an intake key cannot be added to a board access rule, so self-reported
  answers never authorize access.
- The composer keeps a draft per operator and thread in `conversation_drafts`,
  saves it 800 ms after typing stops, and deletes it after a successful send or
  when the composer is cleared.
- A widget thread stores the page it started from, locale, timezone and a
  truncated user agent in `conversations.source_context`; only http(s)
  referrers and real IANA zones are kept, and no IP address is stored. The
  thread shows that context, the customer's five latest linked requests,
  contribution counts and an Unverified badge until the address is verified.
- Widget starts, widget replies and inbound mail pass a conservative
  pre-inbox filter ([spam.ts](../src/features/conversations/spam.ts)) before any
  notification or away reply is queued. Two or more signals — spam keywords,
  four links, shouting plus repetition, a money promise — file the thread in
  Spam with the rules recorded in `conversations.spam_reason`, zero team unread
  and no operator alert, so it never appears in Queue first. One weak signal
  (for example a single screenshot link) stays in Queue.
- **Create request** on a thread files the customer's message on a chosen board
  with that customer as the author (title from the subject, body from their
  first message), adds an internal note and leaves the thread in place, so the
  context is not retyped. It requires `feedback:write` and refuses a board or
  conversation from another product.
- Updates arrive by polling, not a socket: the dashboard inbox and an open
  thread refresh every 5 s while visible, and the widget refreshes its list
  every 5 s and an open thread every 3 s.
- Tokens are random, HMAC-signed with a key derived from `BETTER_AUTH_SECRET`,
  and stored only as SHA-256 hashes. Writes require a matching `Origin` (or
  `Sec-Fetch-Site: same-origin` when the browser omits it) and are rate-limited
  through `rate_limit_counters`.
- Custom-domain host resolution is deliberately not enabled yet; the launch
  URL is path-based (see [plan.md](../plan.md) D4).

The UI types in [src/types/index.ts](../src/types/index.ts) mirror the columns the
dashboard displays without importing the database layer into client components.

### Public accessibility

Public pages share a skip link, one focusable `main#public-main` landmark, visible
focus, labelled controls and 24 px minimum targets. The W1 release gate and its
browser evidence are in [docs/accessibility-checklist.md](../docs/accessibility-checklist.md);
the criterion-by-criterion source audit, the defects it fixed and the remaining
manual checks are in [docs/accessibility-audit.md](../docs/accessibility-audit.md).
[tests/public-accessibility.test.ts](../tests/public-accessibility.test.ts) guards
the structure and labels. The audit is not an independent certification; its
residual VoiceOver/NVDA, zoom, reflow and focus-order checks are still manual.

### Embeddable widget

The dashboard Widget page renders the exact snippet for the current product.
At least one public surface (feedback, roadmap or changelog) must be enabled,
the workspace plan must include `widget` (both shipped plans do), and the
deployment's `FLAG_WIDGET` kill switch must be on.

```html
<script async id="herald-widget"
        src="https://herald.example.com/widget/v1.js"
        data-project="workspace/product"
        data-key="hpk_..."
        data-position="bottom-right"
        data-theme="auto"></script>
```

The Widget page issues the key and writes the saved position and theme into the
snippet, so copying it is all an installation needs. Once a workspace has
widget settings, `data-key` is mandatory; a request without it, with a stale
key, or from an origin outside the saved allowlist renders the 404 page. An
empty allowlist keeps the widget open to any embedding origin, and origins are
exact scheme/host/port values with no wildcards or paths. The page also has a
verification panel that exercises the loader, embed route, key gate, allowlist
and SSO secret from the deployed origin, and prints React and Next.js examples
beside the plain-HTML snippet. A complete installation guide with those
examples and the CSP each needs is in
[docs/widget-installation.md](../docs/widget-installation.md).

`data-position` accepts `bottom-right` (default), `bottom-left`, `top-right`
and `top-left`; `data-theme` accepts `light`, `dark` or `auto`; `data-locale`
accepts `en` or `es`; `data-panel` chooses the initial panel; `data-trigger`
takes a CSS selector for a custom launcher; `data-label` overrides the
accessible label; `data-nonce` forwards a host CSP nonce to the stylesheet.
The loader is async and versioned, queues calls made before it mounts, and is
served immutable from `/widget/v1.js`; a breaking change ships as a new URL.
`HeraldWidget.version` is the major URL and `HeraldWidget.protocol` the
loader/frame handshake; the v1 → v2 upgrade path, cache-key rule and how hosts
are warned are in [docs/widget-versioning.md](../docs/widget-versioning.md). It writes one host element with an open shadow root and loads
`/widget/v1.css` there, so host CSS cannot leak in. CSP needs `script-src`,
`style-src` and `frame-src` for the Herald origin; there is no inline script or
style and therefore no `unsafe-inline` requirement. The launcher is keyboard-operable: opening
moves focus into the panel, `Tab` and `Shift+Tab` cycle inside it while it is
open, and `Escape` or the close button closes it and returns focus to the
launcher. [tests/widget-accessibility.test.ts](../tests/widget-accessibility.test.ts)
guards that contract and the panel's skip-link target. The loader and
stylesheet have raw and gzip ceilings in
[tests/widget-budget.test.ts](../tests/widget-budget.test.ts), which also pins the
first-open properties (no network request of the loader's own; the embed frame
is preloaded at mount, so opening only toggles visibility).
[tests/widget-first-panel-budget.test.tsx](../tests/widget-first-panel-budget.test.tsx)
extends that to the first panel's own server-rendered markup, so loader + CSS +
panel cannot grow as a set. The same launcher contract is exercised for real in
Chromium, Firefox and WebKit by `bun run test:browser`
([tests/browser/widget-matrix.spec.ts](../tests/browser/widget-matrix.spec.ts));
the remaining manual checks and the latency measurement are in
[docs/widget-browser-smoke.md](../docs/widget-browser-smoke.md). The same page
shows a **Widget health** card (last install, loader version, observed origin
and unread notification count) from the loader's once-per-boot install beacon;
the beacon carries no page URL, visitor identity or session.

Three hardening behaviours are part of that contract. The launcher honours
`prefers-reduced-motion` (the panel animation and launch transition are off),
announces unread and readiness changes through a polite live region inside the
shadow root, and replaces a blank frame with a retryable message when the host
is offline, the embed cannot be reached, or the browser blocks the iframe's
session cookies. A host with a nonce-based style policy can add
`data-nonce="<nonce>"` to the script tag; the loader copies it to the
shadow-root stylesheet; no inline `<script>` or `<style>` element is created. Position and theme can
also differ per embedding origin (`originOverrides`), resolved by the embed
route from the `host` it was loaded with and applied by the loader.

A custom launcher only needs your own element and `data-trigger`:

```html
<button id="feedback-launcher" type="button">
  Feedback <span id="feedback-unread" hidden></span>
</button>
<script async id="herald-widget"
        src="https://herald.example.com/widget/v1.js"
        data-project="workspace/product"
        data-trigger="#feedback-launcher"></script>
```

The loader sets `data-herald-unread` and `data-herald-online` on that element
and mirrors the same values through the `unread` and `presence` events, so the
badge can be styled without reaching into the shadow root.

The iframe under `/p/{workspace}/{product}/embed` renders real routes rather
than client-side panel state: home, feedback (board, compose and a specific
request), roadmap, updates (list and a specific entry), messages and
notifications. Reload and the browser's back button preserve the panel, and
every link keeps the validated `host` origin plus the theme and locale. An
unknown or malformed panel path is a 404. Messages is a placeholder until
conversations ship (W4) and links back to compose.

For a page where the widget is the content rather than a floating panel, mount
it into a container:

```html
<div id="herald-feedback"></div>
<script>
  document
    .getElementById("herald-widget")
    .addEventListener("load", () => {
      HeraldWidget.embed("#herald-feedback", {
        panel: "feedback",
        syncUrl: true,
      });
    });
</script>
```

`embed(target, options)` accepts a selector or element. The container should
have a height; otherwise the inline host uses a 560px minimum. `panel` chooses
the first route; an existing `?herald=` value wins, so reloads and shared links
reopen the same panel. `theme` and `locale` override the public branding, and
`syncUrl` (default on for inline mode) writes the current panel to `?herald=`
with `history.replaceState` so a copied URL reopens the same request or update.
`urlParam` renames that query key. `navigate(panel)` changes the panel in either
mode, and `destroy()` removes the host and listeners. The inline embed does not
render a launcher; a custom trigger remains available for the floating mode.

`HeraldWidget` exposes `embed`, `open`, `close`, `toggle`, `navigate`,
`identify`, `logout`, `setTheme`, `setLocale`, `on`, `off`, `getState` and
`destroy`. Events are `ready`, `open`, `close`, `identify`, `unread`,
`presence`, `statechange` and `error`; `getState()` returns the same snapshot,
including `mode` (`floating` or `inline`), `identified` and the last
`identityError`.

`identify(token)` also accepts `{ token }`. The token must be a workspace-signed
HS256 JWT (`sub`/`iss`/`aud`/`iat`/`exp`, at most one hour) with optional
`email`, `name` or `firstName`/`lastName`, `picture`, scalar `traits`, and
`companies` (id/name/domain/role/traits). The handshake runs inside the iframe
against `/api/widget/identify`, so the token never enters the host DOM; an
invalid, expired or disabled-SSO token fails closed, and the frame reloads after
success. Companies are matched by external id, then normalized domain, then
name, so repeated sign-ins update the same rows instead of duplicating them.
There is no unsigned identity path: `requireSignedTokens` starts on and stays
on. `logout()` posts through the same bridge to `/api/public/session/logout` and
clears the shared session.

Because the iframe shares the first-party public customer session, a successful
identify immediately signs the visitor in on public pages, and a guest's posts
and votes are merged into the same customer instead of creating a duplicate.
The unread state, presence and notifications agree with the public site.

The launcher does not wait for a host page reload: the frame re-reads the
session-scoped count at `/api/public/notifications/unread` when the launcher
opens, when the tab regains focus or becomes visible, and every 30 seconds
while it is loaded, then reports only a changed count through `unread` and
`statechange`. A changelog published or a reply written in another tab updates
`data-herald-unread` and the launcher label in place. A reply notification now
carries `#comment-<id>`: the public request page marks every comment with that
id, so the link lands on the reply rather than the top of the request, and the
widget's notification row opens that page directly.

The Widget page also reports installation health from the loader's one-per-boot
beacon: last seen install, loader version, last origin, distinct origins seen
and the product's unread in-app notification count. The beacon carries only the
public workspace/product slugs, the loader version and the exact host origin —
no page URL, identity or session.

## Authentication

[Better Auth](https://www.better-auth.com) 1.7 with the Drizzle adapter and
email/password sign-in.

- Server instance: [src/lib/auth.ts](../src/lib/auth.ts)
- Browser client: [src/lib/auth-client.ts](../src/lib/auth-client.ts)
- Route handler: `src/app/api/auth/[...all]/route.ts`
- Pages: `/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password`,
  `/app/account` (React Hook Form + Zod, loading states, safe post-auth
  redirects)

The four core tables were **verified against the installed package**: the schema
was dumped with `getSchema()` and diffed with `getExpectedSchema()` +
`diffSchema()` — zero findings. Two load-bearing adapter requirements:

1. the Drizzle export names must stay exactly `user`, `session`, `account`,
   `verification` (the adapter keys off the export name, not the SQL table name),
2. the Drizzle property names must match Better Auth's camelCase field names
   (`emailVerified`, `userId`, `expiresAt`, ...).

### Email verification, password reset and change password

- **Signing up confirms the address** whenever an email provider is configured
  (`RESEND_API_KEY` + `EMAIL_FROM`): Better Auth issues no session at sign-up,
  sends a one-hour link and signs the account in when that link is opened. With
  no provider the gate is off — requiring verification that can never arrive
  would create accounts nobody can activate. A half-configured provider logs
  `auth.email_misconfigured` and leaves the gate off rather than failing every
  request.
- The sign-in form turns `EMAIL_NOT_VERIFIED` into a **resend** button. Accounts
  created before verification existed are not locked out: they can self-serve a
  new link, and existing sessions stay valid.
- **Password reset** is `/forgot-password` → emailed link → `/reset-password`.
  The link is single use, expires in an hour, and only a sha256 hash of the token
  is stored ([reset-token.ts](../src/features/auth/reset-token.ts),
  [reset-token-store.ts](../src/features/auth/reset-token-store.ts)); issuing a new
  token deletes any earlier pending one. Completing it posts to
  `/api/auth/password-reset`, which spends the token and hands it to Better Auth
  so the new password is hashed and every existing session is revoked inside one
  transaction. The account then receives a "password changed" notice.
- **Change password** lives at `/app/account` (linked from the account menu) for
  every role, and requires the current password. Saving signs out the other
  sessions and keeps this browser signed in.
- Account mail is sent directly by
  [auth-mail.ts](../src/features/email/auth-mail.ts), not through the workspace
  outbox, and is suppressed in sandbox mode. Sending is best-effort: a provider
  outage is logged and the sign-up or reset request still succeeds, so the user
  can retry.
- **Changing the address** is two confirmations: the current inbox first, then
  the new address, and the address changes only after both links are opened
  (`changeEmail.sendChangeEmailConfirmation`). The form is hidden when no email
  provider is configured.
- **Deleting your account** at `/app/account` requires the password and typing
  `DELETE`. It is not workspace deletion: the guard in
  [account-settings.ts](../src/features/account/account-settings.ts) blocks the
  account while it is the only owner of a workspace (transfer ownership first),
  so no workspace is left without one. The cascade removes the user, sessions,
  linked accounts and memberships; workspace data is untouched.
- **Throttling.** Better Auth's limiter is on in every environment (not just
  production), and its counters live in Postgres through the same
  `rate_limit_counters` table as the public endpoints, so a lockout holds across
  instances and deploys. Rules ([rate-limit.ts](../src/features/auth/rate-limit.ts)):
  sign-in 10 per 5 min, sign-up 20 per hour, reset and verification mail 5 per
  hour, change-password 10 per 5 min, change-email 5 per 5 min. A blocked
  request gets `429` + `X-Retry-After`, and the sign-in and forgot-password
  forms say how to recover. The limiter fails open and logs
  `auth.rate_limit_unavailable`, because a counter outage must not lock everyone
  out.

## Authorization

Helpers live in [src/lib/authz.ts](../src/lib/authz.ts); the pure matrix is
[src/lib/permissions.ts](../src/lib/permissions.ts).

- `requireUser()` — authenticates, or redirects to `/sign-in`.
- `requireProductContext(workspaceSlug, productSlug, permission?)` —
  authenticates, resolves membership **by the user's own id**, resolves the
  product *inside* that workspace, then asserts the permission.
- `assertSameProduct` / `assertSameWorkspace` in
  [src/lib/tenancy.ts](../src/lib/tenancy.ts) — pre-write checks mirroring the
  composite foreign keys.

Rules:

- **Deny by default.** A permission missing from a role's list is denied.
- **Middleware is not the boundary.** No `middleware.ts` exists; every page,
  server action and privileged query checks authorization itself.
- **Unknown workspaces/products 404**, so membership in another tenant is never
  disclosed.
- **Client-supplied identifiers are never trusted.** The owner is always the
  authenticated session user.
- Hiding a navigation item is usability, not authorization.

### Permission matrix

| Permission | owner | admin | editor | viewer |
| --- | :---: | :---: | :---: | :---: |
| `workspace:read` | ✅ | ✅ | ✅ | ✅ |
| `workspace:update` | ✅ | ❌ | ❌ | ❌ |
| `workspace:delete` | ✅ | ❌ | ❌ | ❌ |
| `member:read` | ✅ | ✅ | ❌ | ❌ |
| `member:manage` | ✅ | ❌ | ❌ | ❌ |
| `product:read` | ✅ | ✅ | ✅ | ✅ |
| `product:create` / `update` / `delete` | ✅ | ✅ | ❌ | ❌ |
| `release:read` | ✅ | ✅ | ✅ | ✅ |
| `release:write` | ✅ | ✅ | ✅ | ❌ |
| `feedback:read` / `feedback:comment` | ✅ | ✅ | ✅ | ✅ |
| `feedback:write` | ✅ | ✅ | ✅ | ❌ |
| `moderation:read` / `moderation:manage` | ✅ | ✅ | ✅ | ❌ |
| `roadmap:read` | ✅ | ✅ | ✅ | ✅ |
| `roadmap:write` | ✅ | ✅ | ✅ | ❌ |
| `subscriber:read` | ✅ | ✅ | ✅ | ❌ |
| `subscriber:write` | ✅ | ✅ | ❌ | ❌ |
| `winback:read` | ✅ | ✅ | ✅ | ❌ |
| `winback:manage` / `winback:approve` | ✅ | ✅ | ❌ | ❌ |
| `conversation:read` / `conversation:write` | ✅ | ✅ | ❌ | ❌ |
| `juno:read` / `juno:manage` | ✅ | ✅ | ❌ | ❌ |
| `widget:manage` | ✅ | ✅ | ❌ | ❌ |
| `analytics:read` | ✅ | ✅ | ✅ | ❌ |
| `integration:manage` | ✅ | ✅ | ❌ | ❌ |
| `settings:manage` | ✅ | ✅ | ❌ | ❌ |

Owners alone manage membership, sensitive workspace settings and workspace
deletion. Viewers are free seats: read and comment only, never a paid member.
Roles apply to the whole workspace, not per product — the decision and its
trade-offs are in [ADR 0003](../docs/adr/0003-workspace-wide-roles.md).

This table is documentation; the app renders the same matrix from
[src/lib/permissions.ts](../src/lib/permissions.ts) at
`/app/{workspaceSlug}/settings/access` (`member:read`), including each member's
effective base-plus-custom permissions.

## Dashboard

A persistent shell with a collapsible sidebar, workspace/product switcher,
breadcrumbs, account menu and mobile navigation. The signed-in role is shown in
the account menu; writes are re-checked by the server action that performs them.

| Route | Status |
| --- | --- |
| `.../releases` | **Implemented.** Search, status/category filters, load-more; create, edit, preview, duplicate, publish, archive, restore and “Draft with AI” from shipped requests. |
| `.../releases/new`, `.../releases/[releaseId]/edit` | **Implemented.** Markdown editor with edit/preview tabs, slug generation, category, cover, tags, multiple authors, YouTube, linked feedback, linked cancellation reasons, distribution channels, autosave, publish-now or schedule with an explicit timezone, save draft, preview and a publish review dialog. |
| `.../feedback` | **Implemented.** Inbox plus detail: search, status/category filters, private saved views, multi-select bulk status and hide/restore, `j`/`k`/`x`/`/`/`?` keyboard shortcuts, vote toggling, public comments, separate internal notes, status changes, release links, manual board tags, hide/restore one request, ban or unban the author, and merge with an undo that restores moved comments, votes and reactions. |
| `.../conversations`, `.../conversations/[conversationId]` | **Implemented.** Operator inbox with Queue/Open/All/Snoozed/Resolved/Spam/Archived tabs, search over subject, customer and last message, assignment filters, bulk resolve/reopen/spam/archive, and a thread view with replies, internal notes, slash commands (`/resolve`, `/reopen`, `/snooze 2h`, `/note`), assignment, snooze, block sender and personal reminders. The inbox also lists the operator's unread alerts with **Mark all read**; the thread autosaves a personal draft, shows visitor context, linked requests and contribution counts, offers **Create request** to file the conversation on a board, and both refresh by 5 s polling. Widget and inbound messages are screened for spam before they reach Queue, and the thread shows the stored spam reason. Requires `conversation:read` / `conversation:write`, which owner and admin hold and editor does not. |
| `.../conversations/answers` | **Implemented.** Team-only Mira answer inspection: retrieved passages and scores, confidence band with low-confidence filter, model, prompt version, cost, outcome, stored thumbs and an admin add-to-evaluation form. `juno:read` to view; `juno:manage` to add an evaluation case. |
| `.../feedback/duplicates` | **Implemented.** Uncertain duplicate triage: source and target side by side, match score and mode, merge through the existing merge transaction or dismiss without changing either request. `feedback:read` to view, `feedback:write` to decide. |
| `.../moderation` | **Implemented.** Pending/approved/rejected queue for submissions and comments with counts, automated spam/abuse and sensitive-information reasons, image-scan status, and Approve, Publish, Keep, Keep hidden, Delete and retry. `moderation:read` to view, `moderation:manage` to decide. |
| `.../boards` | **Implemented.** Create, edit, archive and restore boards, with visibility, guest posting, moderation rules, icon/colour, order and the public URL. Owners and admins only (`settings:manage`); the per-product board limit and the private-board/guest-posting features are re-checked by the server actions, not just the form. |
| `.../import` | **Implemented.** CSV upload with format detection (Canny, Productboard, Nolt, Frill, Beamer or generic), per-field column mapping with workspace-scoped presets, a dry run that reports importable/failed/skipped counts without writing, board/status/author/votes/created-date handling, and public cover-image URLs fetched through the SSRF guard into storage. GitHub Issues and another Herald workspace's API can be imported as sources (token used for the fetch only). The background job reports progress, row errors and imported-image counts, and a queued or running import can be cancelled. A complete JSON or CSV export marks merged duplicates. `settings:manage`. |
| `.../` (overview) | **Implemented.** Live counts for published/open records, active subscribers and roadmap requests; recent releases and feedback; release pipeline, attention list and activity from database timestamps. |
| `.../roadmap` | **Implemented.** Status-driven kanban over feedback (New through Closed) with drag/drop or a keyboard-friendly status menu, vote counts, public-roadmap and public-feedback switches. `roadmap:read` to view, `feedback:write` to move cards, `settings:manage` for visibility. |
| `.../widget` | **Implemented.** Copy-ready keyed snippet with saved position/theme, public key, exact allowed origins, optional attributes, `HeraldWidget` API, CSP guidance, a link to the live frame and an installation check for the loader, key gate, allowlist and SSO secret. The plan/flag gates and public-projection panels are shared with the embed route. |
| `.../subscribers` | **Implemented.** Search and status/source filters, add, status changes, CSV import with row errors, a full CSV export that round-trips through the same parser, follower sync, unsubscribe records and the workspace suppression list. An import cannot reactivate an address that previously unsubscribed. `subscriber:read` to view, `subscriber:write` to change. |
| `.../winback`, `.../winback/new`, `.../winback/campaigns/[campaignId]` | **Implemented.** Cancellation CSV import, estimated audience with excluded-because counts, linked release and cancellation reasons, draft → submit → separate approval, per-campaign test send, canary batch before the full audience, irreversible stop, suppression and late opt-out re-checks at queue time and before the provider call, per-recipient delivery/error/opt-out reporting, and confirmed vs inferred return attribution inside a 30-day window. `winback:read` to view, `winback:manage` to edit/test/send, `winback:approve` to decide or stop. |
| `.../analytics` | **Implemented.** Public views, submit conversion, votes, widget open/install, status funnel, average time-to-ship, conversation volume/first response, Mira resolution and email delivery over a trailing 30-day window. Raw events are privacy-scoped; daily rollups are recomputed by the job runner. |
| `.../operations` | **Implemented.** Product-scoped pending/running/succeeded/failed job counts, recent job types and a failed-job attention list. Payloads and tenant identifiers are never selected. `settings:manage`. |
| `.../integrations` | **Implemented.** Slack OAuth install and channel binding; one issue-tracker connection per provider with a webhook URL, editable status map, issue create/link, outbound status push and last-event time; one workspace-scoped HubSpot or Salesforce connection with manual sync, matched-company count and last error; Intercom/Zendesk capture connections; a GitHub App installation; and a link to the webhook console. Tokens and signing secrets are never rendered. |
| `.../settings` | **Implemented.** Product branding (logo, name, accent colour, theme, locale and hide-attribution), customer identity/SSO with rotation grace, operators and support email, Mira behavior and duplicate mode, agent-action review/audit, and the public submission assistant opt-in. The workspace settings hub adds General, Team (paid-seat and free-viewer counts, a link to the generated **Who can do what** page, invitations with expiry/resend/revoke, and an owner-only domain capture with its DNS challenge), Billing, API tokens (status, last used and coarse last-seen), Enterprise, Privacy, a **Danger zone** (export, ownership transfer and deletion in one screen, with what each does to data and typed workspace-name confirmation for transfer and deletion), Data & Import links, custom-domain verification/health, and an owner-only audit log with actor/action/target/date/text filters, a CSV export that uses the same filters, and the configured retention window (365 days). Entries carry their detail, for example `editor → admin` for a member. |

Every primary dashboard route is backed by live data. The shell never falls back
to sample data: empty states explain what is missing, and an unavailable page
would render [SectionUnavailable](../src/components/shared/section-unavailable.tsx)
without records or actions rather than invent them.

### Reading and writing live data

The product layout resolves the session, membership and product, then loads one
serializable snapshot per request
([src/features/live/snapshot.ts](../src/features/live/snapshot.ts)). It contains
releases, feedback posts/votes/comments/tags, the signed-in member's saved
feedback views, cancellation reasons and an active-subscriber count. The
snapshot is passed to the client shell; after each server action the
route is refreshed and the same layout loads the new authoritative copy. No
browser storage is involved.

Publishing:

- marks linked feedback `shipped`, which moves it to Done on the public roadmap
  and queues a status notification for everyone engaged with that request;
  hidden, private, archived and merged requests are filtered out of that
  fan-out,
- records one `pending` release delivery per active, unsuppressed subscriber
  whose customer is not banned when the release allows subscriber email, and
  one in-app row per active subscriber or follower of a public linked request
  when the public changelog channel is on (deduplicated by
  `notification_deliveries.dedupe_key` / `in_app_notifications.dedupe_key`),
- never approves or starts a win-back campaign.

Queued deliveries are sent by the `deliver_notification` job once email is
configured; publishing itself never blocks on the provider.

### Mira (AI operator)

Settings → **Mira** turns on an operator that answers from the workspace’s own
knowledge ([src/features/juno](../src/features/juno)). Upload Markdown, text, HTML,
JSON, YAML or PDF up to 10 MB (a scanned PDF needs OCR first), or crawl a public
URL. A crawl stays on the same
origin and beneath the submitted path, resolves and rejects private, loopback
and link-local addresses on every hop, does not follow redirects, and is capped
at 25 pages, 2 MB per page, 8 MB total and 45 seconds. Up to five sources are
allowed in beta. Each replacement or recrawl builds a new version while the
current live version keeps serving; pausing removes a source from retrieval
without deleting its history. Each source is **public** by default; marking it
**internal only** excludes it from every widget, email and Slack answer, while a
team-run evaluation can opt in to those sources. A crawled source can be
checked on its own schedule; the rebuild diffs its pages against the live
version and the Mira settings page raises a **source changed** alert with the
added, removed and edited counts.

Ingestion parses, chunks and embeds into Postgres. With `AI_EMBEDDING_MODEL`
set, chunks use the provider’s `/embeddings` endpoint; otherwise they use the
deterministic local embedding and retrieval never leaves the database. A
question must clear the configured confidence floor before generation. Answers
store their citations on the message (and the widget shows a Sources list),
while an uncovered, low-confidence, billing or account question hands off to the
human queue with a private note explaining why. The widget receives thread
updates over a server-sent event stream, keeps its 3-second poll as a fallback,
and shows a typing indicator while Mira is answering. Tone, reply length,
formality, emoji and language are settings; `language = workspace` answers in the
public-site locale (falling back to the customer’s language) and never
translates the customer’s message, history or sources. The model is limited to
the deployment’s `AI_MODEL` and to the plan’s allowlist: Professional and
Founding Lifetime may use it, Free and Indie have no Mira model. A downgrade
hands off with a **plan** reason instead of leaving a paid model reachable.

Guardrails are deliberate: Mira's only mutation surface is a closed, reviewed
action allowlist, so it cannot change settings, billing, permissions or customer
data; requests for such changes hand off before generation; customer text and
sources are passed to the model as delimited untrusted data; and email addresses,
phone numbers, cards, IBANs, SSNs and provider secrets are redacted before both
the provider and the audit row. Reserved prompt tags inside an uploaded document
are neutralised, so a page cannot close the `<sources>` block and inject a fake
system rule; the injection case is pinned in `tests/juno-guardrails.test.ts`.
The daily budget is a hard stop that hands off rather than degrading silently,
and crossing 80% records a once-a-day alert on the usage row that Settings →
Mira activity surfaces. The Settings toggle is the kill switch: it stops new
pickups but keeps every existing thread and its state.

The only action currently registered is **email a conversation transcript**.
It is off by default, a reviewer must enable it on Settings → Agent actions, and
the customer's own literal wording must ask for it (never model output). Every
attempt writes an `agent_action_runs` row; queued email also uses the normal
outbox and the `conversation_transcript` template. The allowlist has no path to
settings, billing, deletion or identity.

In a widget conversation, a request-shaped question can produce a **feedback
card**. Mira searches public, approved requests and offers to file a new one or
add a vote/follow; nothing happens until the customer confirms, and anonymous
visitors cannot vote or follow. Limits are 3 new requests per conversation, 25
per workspace per UTC day and 10 votes/follows per conversation. A new request
goes through the same board approval and sensitive-content checks as the public
form.

Activity and evaluation live on the same Settings page. The activity meter
shows 30-day pickups, handoff rate and reasons, threads resolved without the
team, cost and cost per resolved thread, plus today’s budget with its 80% alert
and 100% hard stop. A **dry-run retrieval** panel runs the production retrieval
path for a question and shows the ranked passages, lexical/vector scores and
whether they clear the floor; it never calls the chat model or records usage.
The redaction audit in the same page reports workspace totals by kind and never
stores the matched text. The evaluation card keeps a golden set
of questions and records each run with its model and prompt version; a model
change is refused until the latest run passes every current case. A fixed
provider-stub golden set also runs in CI (`test:unit`), and pins the assembled
system prompt by fingerprint, so a prompt change that is not reflected in a
passing golden set fails the build.

**Answer inspection** is at `/app/{workspace}/{product}/conversations/answers`
(team only). Every answer shows its ranked retrieved passages and scores, the
confidence band, model, prompt version, cost and outcome, with an optional
low-confidence filter. Thumbs are stored on the answer; an admin can add the
exact redacted question to the evaluation set from the same row. A thumbs-down
also opens one **knowledge-gap task** (deduplicated per answer) on Settings →
Mira, linking the conversation and the redacted question; a manager marks it
done after adding or fixing the source. The thread sidebar shows Mira’s handoff
reason and says the private note has the detail, without opening answer
inspection.

**Duplicate linking** has three levels on Settings → Mira: off, assisted and
automatic. Assisted queues every candidate above the 0.2 suggestion floor;
automatic merges only at 0.8 or above and queues uncertain matches for a person.
The queue is `/app/{workspace}/{product}/feedback/duplicates`; merging uses the
normal merge transaction, so automatic merges appear in merge history and can be
undone there. Candidate scores combine lexical overlap with embedding cosine
similarity, so a paraphrase can match when a provider embedding model is
configured; the local hash fallback remains lexical. Tag suggestions remain
read-only. The existing **Draft with AI**
release action remains the only changelog path and always writes a private draft.

Limitations: crawling and generation are tested with injected network/model
dependencies, not a live site or paid provider; the answer-inspection,
duplicate-triage, agent-action, dry-run and public rewrite/split surfaces have no
live browser pass; duplicate matching is semantic only when an embedding provider
is configured; the 80% budget alert is in-product (no email); and a
deployment-level `AI_MODEL` change is still not blocked at deploy time — run the
evaluation first. The widget stream carries persisted messages, not token-level
model deltas, because generation runs in the durable job queue.

### AI changelog drafts

Releases → **Draft with AI** asks an OpenAI-compatible provider to draft an
entry from shipped requests ([src/features/releases/ai-draft.ts](../src/features/releases/ai-draft.ts)).
Only requests that pass the public board, moderation, hidden, merged, archived
and banned-author predicates are offered and included in the prompt. The
result is always created as a private `draft` with the selected requests
linked; the AI path never publishes, schedules, notifies or sends email. The
feature requires the workspace's `ai` plan feature and `AI_API_URL` +
`AI_MODEL` (plus `AI_API_KEY` when the provider needs one). Provider output is
validated before use, and failures create no row.

### Changelog draft API

The session-authenticated `/api/app/{workspace}/{product}/changelog` routes
create and update drafts:

```bash
curl -X POST -b cookies.txt -H 'content-type: application/json' \
  -H "Origin: $APP_ORIGIN" \
  -d '{"title":"Faster search","slug":"faster-search","summary":"Search is faster.","body":"### What changed\n\n- Search is faster.","tags":["search"]}' \
  "$APP_ORIGIN/api/app/acme/herald/changelog"

curl -X PATCH -b cookies.txt -H 'content-type: application/json' \
  -H "Origin: $APP_ORIGIN" -d '{"summary":"Search is much faster."}' \
  "$APP_ORIGIN/api/app/acme/herald/changelog/$RELEASE_ID"
```

Both require `release:write` and the same-origin mutation check. There is no
status field: created rows are drafts, and PATCH refuses published, scheduled or
archived entries with `409`. Publishing remains an explicit editor action.

[src/features/releases/draft-service.ts](../src/features/releases/draft-service.ts)
applies the same product, author and linked-record checks as the editor.

The pure selectors in [src/features/live/selectors.ts](../src/features/live/selectors.ts)
scope every lookup to the product already authorized by the layout.

## Scheduled publishing

`GET` or `POST /api/cron/publish-releases` publishes every release whose
`status` is `scheduled` and whose `scheduled_for` has passed
([src/features/releases/publisher.ts](../src/features/releases/publisher.ts)).

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/cron/publish-releases
```

- Closed by default: without `CRON_SECRET` the route returns `503`; a missing
  or wrong bearer token returns `401`. Tokens are compared in constant time.
- Each release is published in its own transaction with an update guarded on
  `status = 'scheduled'`, so overlapping or retried runs cannot publish twice,
  duplicate delivery rows, or re-run feedback effects.
- The same transaction records pending subscriber deliveries and marks linked
  feedback shipped — identical to manual publishing.
- The response reports `published` and `failed` ids. A partial failure returns
  `500` so the scheduler retries; retries are safe.

This repository ships Vercel Cron entries in [vercel.json](../vercel.json) that
request scheduled publishing and the job runner every minute, and the weekly
digest every Monday at 09:00 UTC. The job runner is what delivers queued email,
including the digest:

- Set `CRON_SECRET` in the Vercel project's environment variables. Vercel Cron
  sends it automatically as `Authorization: Bearer <CRON_SECRET>`; without it
  the deployment answers `503` and publishes nothing.
- **Per-minute schedules require Vercel Pro.** Hobby accounts only allow one
  cron run per day — change `schedule` in `vercel.json` (for example
  `0 * * * *` for hourly) if you are on Hobby. Due releases simply publish on
  the next run.
- Runs are visible under Project → Cron Jobs. A `500` means at least one release
  failed; Vercel does not retry cron invocations, but each run is idempotent and
  the next minute's run publishes anything still due. Vercel's delivery is
  best-effort and may occasionally invoke the same run twice — the status-guarded
  update makes that safe.

Other schedulers work with the same route and header: a GitHub Actions schedule
or plain cron only needs the deployed URL and the secret. A once-a-minute
cadence is fine; each run is bounded and idempotent.

Internally, publishing is now the `publish_releases` job type run synchronously
with a per-minute `dedupe_key`. The HTTP contract is unchanged: overlapping
scheduler calls return the stored result instead of publishing twice.

### Background jobs

`GET` or `POST /api/cron/jobs` runs due work from the `jobs` table
([src/features/jobs/queue.ts](../src/features/jobs/queue.ts)). The Vercel config
points the same schedule at it every minute; any other scheduler should do the
same so queued delivery does not sit in the outbox.

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/cron/jobs
```

- Claiming selects one due row with `FOR UPDATE SKIP LOCKED` in a short
transaction, marks it `running` and increments `attempts`; the handler runs
after the commit, so a slow job never holds a lock.
- Each invocation claims at most 20 jobs. Failures retry with exponential
  backoff (30 s doubling, capped at one hour) until `max_attempts`, or
  immediately for a `NonRetryableJobError`.
- Locks older than ten minutes are reclaimed, so a crashed runner cannot strand
  a job. `attempts` is consumed at claim time, which means a crash still counts
  as an attempt.
- The response reports counts and `id`/`type`/`status` per job — never payloads,
  tenant identifiers or error text.
- `byType` groups the counts per job type, for example
  `{ "publish_releases": { "claimed": 1, "succeeded": 1, "failed": 0, "retrying": 0 } }`.
  Types that were not claimed are omitted, so the payload stays compact for a
  scheduler and contains no tenant data.
- `GET /api/cron/jobs?view=history` returns the last ten runner invocations and
  every job that exhausted its attempts (type, attempts, stored error). It
  requires the same bearer secret and runs no work.
- Handlers live in [src/features/jobs/handlers.ts](../src/features/jobs/handlers.ts),
  and every value of the `job_type` enum resolves to one.
  `tests/jobs-handlers.test.ts` fails when the enum gains a type the map cannot
  resolve, so the two cannot drift. A type that nothing schedules is removed
  from the enum by a migration instead of staying registered as a no-op.
  Outbound webhooks are not a job type: `/api/cron/webhooks` calls
  [deliverDueWebhooks](../src/features/webhooks/service.ts) directly, and the
  Trending board sort is computed per query
  ([queries.ts](../src/features/public/queries.ts)), so neither `deliver_webhook`
  nor `recalculate_trending` needed a worker.

## Email

[src/features/email/](../src/features/email/) owns everything except delivery:
templates, the suppression list and the outbox sweep. The provider adapter
([provider.ts](../src/features/email/provider.ts)) is one `fetch` POST to Resend
with the delivery `dedupe_key` as the idempotency key; swapping providers is a
single file.

- A delivery row is claimed per message; `sent`, `skipped`, `failed`,
  `bounced`, `complained` and `pending` outcomes are recorded, with a provider
  message id where available. A short `defer_until` marker holds a quiet-hours
  message without consuming a provider attempt; the outbox sweep picks it up
  after the marker and re-evaluates the subscriber's local window.
- `POST /api/email/webhook` accepts signed Resend delivered/bounced/complained
  events (`RESEND_WEBHOOK_SECRET`) and the normalized bearer batch
  (`EMAIL_WEBHOOK_SECRET`). Resend's `data.email_id` is matched to the stored
  provider id. A bounce or complaint marks the delivery `bounced`/`complained`
  and suppresses the normalized address for the whole workspace, so later sends
  skip it. A replayed event is inert, and an unknown message id is acknowledged
  without a write.
- Settings → Email reports SPF, DKIM (the `resend` selector) and DMARC for the
  workspace sender identity's domain, falling back to `EMAIL_FROM` only when the
  workspace has no identity. SPF is read from the root domain or Resend's
  `send.<domain>` return-path, and the card includes the guided DNS order. Each
  record is `ok`, `missing` or `unknown`; a failed or time-boxed lookup is never
  reported as missing.
- Saving a new From or reply-to address emails a single-use verification link
  to that mailbox. Only a SHA-256 token hash is stored; the token expires after
  24 hours and is scoped to the workspace, purpose and address. `senderIdentityProblem`
  keeps win-back and campaign sending blocked until both the From address and
  any configured reply-to are verified.
- Suppressed addresses are excluded when a release audience is queued, so the
  outbox matches the pre-send preview. If a suppression is added after queueing,
  the delivery is marked `skipped` and never retried. Suppression is keyed per
  workspace on the normalized address. The Subscribers page can add a manual
  suppression with a reason, import a CSV (`email`, optional `reason` and
  `note`) and export the workspace list; unknown imported reasons are treated as
  `manual` and reported.
- `sendTestEmailAction` sends to up to five addresses at once, requires
  `settings:manage` and is rate-limited to five batches per minute per user. The
  optional customer mode uses the configured sender identity and a sample
  changelog email. It is surfaced as **Send test email** on the Subscribers
  page, next to a product-scoped delivery log showing queued, sent, failed,
  bounced, complaint and skipped rows. The log supports search and a status
  filter, and a failed/bounced/complaint/skipped row can be queued for retry by
  an operator with `settings:manage`. Test sends are not written to that log.
- Release notifications link to `/p/{workspace}/{product}/updates/{slug}`.
  Status and reply emails link to the request page, and every customer email
  with a subscriber token links to the preference centre. Marketing-class email
  (release, daily/weekly digest, win-back, outbound) also carries RFC 8058
  `List-Unsubscribe` and `List-Unsubscribe-Post` headers; the one-click endpoint
  turns off every marketing list without touching request-status or reply
  notifications.
- Settings → Email previews renders every outbound template with fixed sample
  data. The shared layout declares `color-scheme`/`supported-color-schemes`, a
  dark-mode stylesheet, a 600px mobile breakpoint and an Outlook table envelope;
  `tests/email-rendering.test.ts` checks those markers across every template.
- Inbound auto-replies are still ignored before the inbox. On a conversation
  reply address they also add one idempotent internal note to the linked thread
  without changing its status, unread count or customer-visible messages.
- Scheduling `deliver_notification` every minute is safe: the outbox sweep is
  bounded, the dedupe key is the provider idempotency key, suppressed addresses
  are skipped and deferred quiet-hours rows are left for a later pass.
- Warm-up, reputation, blocklist recovery, suppression and rendering procedures
  live in [docs/deliverability.md](../docs/deliverability.md).

## Notifications and digests

[src/features/notifications/](../src/features/notifications/) owns fan-out, the
in-app inbox and the digest queue.

- One transaction writes both the email outbox row and the in-app row for a
  feedback status change, a public reply or a published release. Retries and
  repeated actions add nothing because both tables have unique dedupe keys. A
  tracked request's status change also leaves one idempotent internal note on
  every support conversation linked through
  `feedback_insights.source = 'support'`; the note is team-only and does not
  change unread counts or customer-visible messages.
  Rapid status changes on one request reuse an already-pending
  `feedback_status_changed` row for the same recipient, so ten changes produce
  one email (and ten in-app rows).
- Recipients are the request author, voters, non-internal commenters and
  followers — resolved from the request itself, narrowed by each subscriber's
  `notify_status_changes` and `notify_replies` preferences. Hidden, private,
  archived, merged and over-quota content never notifies anyone.
- The public header shows an unread bell for a signed-in customer. The inbox at
  `/p/{workspace}/{product}/notifications` is scoped to the session cookie and
  product, and marking rows read is an explicit same-origin POST.
- `GET|POST /api/cron/weekly-digest` runs daily and queues due digest outbox
  rows for active, opted-in subscribers. Daily subscribers use a UTC-day
  dedupe key and `daily_digest`; weekly subscribers use an ISO-week key and
  `weekly_digest`. Products with no public release in the window are reported
  as empty and send nothing.
- Email preferences cover product updates, win-back, request status changes,
  replies, custom/tag topics, a daily/weekly/off digest and an optional local
  quiet window (start, end and IANA timezone). Quiet hours hold release,
  win-back, request, digest and outbound mail; support replies, CSAT, account
  security and billing notices are never held. Turning product updates off also
  clears the digest, because it is a product-update email.
  The preference page renders every active topic from `subscription_topics`,
  and the topic manager remains the operator surface.

## File storage

[src/features/storage/](../src/features/storage/) is the only module that touches
bytes on disk. `StorageProvider` is the seam for a cloud driver; the shipped
driver writes under `STORAGE_DIR` (default `.storage/`).

- Uploads are validated by magic bytes, not the declared content type, and by a
  per-kind size limit before anything is written.
- Keys are generated, never client-supplied, and every read re-checks that the
  resolved path stays inside the storage root.
- Objects are stored with a SHA-256 checksum and verified on read; a truncated
  or altered file raises instead of being served.
- `GET /api/storage/{key}?expires=&signature=` serves only URLs signed with a
  key derived from `BETTER_AUTH_SECRET`. A malformed, expired or wrongly-signed
  URL returns 404, the same answer as a missing object.
- Uploads are not wired into the release editor or the feedback composer yet;
  the module and the download route are ready for that change.

## Plans and feature flags

Entitlements are sold through Stripe. [src/features/entitlements/](../src/features/entitlements/)
owns the catalogue and server gates; [src/features/billing/](../src/features/billing/)
owns Checkout, the Customer Portal, signature-verified webhooks and the
subscription row. A browser never writes a plan.

- `plans.ts` is pure: plan ids, the feature matrix, limits and `checkUsage`.
  Boards are **2 / 5 / unlimited** on Free / Starter / Professional. Lower
  plans get one integration; Professional is unlimited. Limits use `null` for
  unlimited.
- `workspace_subscriptions` is the source of truth once a workspace has a
  billing row. `trialing` and `active` keep a paid plan; `past_due` and `unpaid`
  keep it through a seven-day dunning grace window and then fall to Free when
  the scheduled `expire_dunning` job runs. The `workspaces.plan` column is
  refreshed for compatibility but is not the authority. Webhook event ids and
  Stripe event timestamps are stored, so retries are idempotent and an older
  event cannot overwrite a newer subscription state.
- Checkout starts a 14-day trial (30 days after setup is complete). Plan changes
  preview Stripe's prorated upcoming invoice before the owner confirms; the
  Customer Portal keeps payment methods, cancellation and invoices. Stripe
  configuration is optional; without all four required `STRIPE_*` values the
  Billing card explains that checkout is disabled.
- Set both `STRIPE_PRICE_STARTER_ANNUAL` and `STRIPE_PRICE_PRO_ANNUAL` to offer
  annual checkout. Annual and monthly prices resolve to the same plan, so every
  entitlement is unchanged. Checkout enables Stripe automatic tax, collects a
  billing address and tax ID, and writes the workspace name plus a Herald footer
  to the customer's invoice settings.
- After a downgrade, boards and integrations above the new allowance stay
  readable and keep working; their configuration becomes read-only. Archiving a
  board or disconnecting an integration frees the slot and is always allowed.
- The billing panel shows usage for boards, paid seats, integrations, monthly
  email volume, survey impressions and AI spend, and warns at 80% of any cap.
  Limit errors carried back from server actions link to the billing section.
- `entitlements.ts` resolves the plan from the database by workspace or product
  id — never from request input — and counts non-archived products, boards,
  members and active integrations. Archived records free their slot.
- Board writes enforce the gates on the server. Creating a board calls
  `checkBoardLimit`; creating or updating one rejects a private board or guest
  posting when the plan lacks that feature.
- Slack installs and webhook creation check the integration allowance. SSO
  settings and signed-identity verification require the `sso` feature. Public
  search falls back to title-only below Professional, and identity masking and
  the “Powered by Herald” attribution are enforced server-side.
- The public resolver re-checks `guestPosting` against the current plan on every
  request. A downgrade closes guest posting immediately even though the stored
  board setting still says it is on.
- The public feedback surface requires the `public_feedback` flag **and** the
  plan feature. If either is off, the public API answers 404.
- Feature flags are deployment-wide kill switches read from `FLAG_*` on each
  call. Defaults describe what ships: public feedback and the widget on, API off.

### Billing and custom domains

Set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_STARTER` and
`STRIPE_PRICE_PRO` together (see `.env.example`). Point a Stripe webhook at
`/api/webhooks/stripe` for `checkout.session.completed`,
`checkout.session.expired`, `customer.subscription.*` and `charge.refunded`.
Checkout and Portal actions require the workspace owner; the webhook verifies
the raw body with the signing secret.

Failed payments start a three-email dunning sequence (immediate, day 3 and day
6) that leads with “your data is safe”. The paid plan stays active until the
seven-day grace period ends. Cancellation feedback is stored with optional
contact consent; a consenting owner gets one win-back email when the
cancellation is confirmed, and a later reactivation stamps `recovered_at`.

Founding Lifetime is a separate one-time `STRIPE_PRICE_LIFETIME` (optional for
subscription-only deployments). It uses `mode: "payment"`, reserves one of 100
pre-seeded seats before creating Checkout, and only the webhook grants the
`lifetime` plan. The panel is on the Billing settings card, the offer band is
on `/pricing`, and the terms are at `/legal/lifetime`. A full refund revokes
the plan and frees the seat; a partial refund does not. The lifetime Mira cap is
150 answered conversations per calendar month, enforced in
`answerConversation` before any model call.

A custom domain is saved under `/app/{workspace}/settings`, then verified with
a TXT record at `_herald.<domain>` containing the generated token. Only after
verification can the health check call
`https://<domain>/api/health?scope=readiness` and record the result. DNS and
TLS attachment remain deployment responsibilities. Once verified and while the
plan includes custom domains, `src/proxy.ts` rewrites requests on that host to
the product's public tree; the live DNS/TLS path has not been exercised.

## Observability

- [src/proxy.ts](../src/proxy.ts) stamps every request and response with
  `x-request-id`. An inbound id is reused only when it is 8–128 characters of
  `[A-Za-z0-9._-]`; otherwise a UUID is generated. The proxy authorizes nothing.
- [src/lib/logger.ts](../src/lib/logger.ts) emits one JSON object per line with
  `time`, `level`, `event` and fields. Keys that look like credentials
  (`secret`, `token`, `password`, `authorization`, `cookie`, `apiKey`, ...) are
  replaced with `[redacted]`; errors become `{name, message, stack}`; long
  strings are truncated and nesting is bounded.
- [src/lib/error-report.ts](../src/lib/error-report.ts) always writes the
  structured log first, then POSTs a compact payload to `ERROR_WEBHOOK_URL`
  when set. Delivery is bounded to three seconds, refuses redirects and never
  throws into the caller.
- The runner records every invocation in `job_runs` (claimed, succeeded, failed,
  retrying, duration), so a stalled queue looks different from an empty one.
- `/api/cron/jobs?view=history` is the no-database-console view of failures.

## Onboarding

1. Sign up at `/sign-up`.
2. `/app` resolves your first workspace and product.
3. If none exists you land on `/app/onboarding`.
4. Submitting creates the workspace, the `owner` membership row **and** the
   first product in a **single transaction**
   ([src/features/onboarding/actions.ts](../src/features/onboarding/actions.ts)).
5. You are redirected to `/app/<workspace>/<product>`.

Duplicate workspace slugs are detected before the insert and also handled by the
unique constraint (mapped back to a field-level message). No demo user or fake
session is created.
