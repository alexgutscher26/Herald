# Dashboard analytics privacy review

Product analytics on the dashboard answers one question: **which settings
sections do teammates actually open?** It exists to remove dead settings, not to
build a behavioural profile of a customer's team.

This review covers every field in `dashboard_view_events`, the write path
(`/api/app/{workspaceSlug}/dashboard-views`) and the reader
(`/app/admin`).

## Data stored

| Field | Purpose | Why it is acceptable |
| --- | --- | --- |
| `workspace_id` | Attribute the view to a tenant | Already the tenancy key; no new disclosure |
| `product_id` | Distinguish product settings from workspace settings | Nullable; product ids are not customer data |
| `surface` | One of two fixed values: `workspace_settings`, `product_settings` | Closed allowlist, enforced by a check constraint |
| `section` | A fixed slug such as `billing` or `juno` | Server-owned list, regex-validated, max 60 chars |
| `actor_ref` | Count distinct people without counting one person twice | Keyed HMAC-SHA256 of the user id, truncated to 32 hex chars; not reversible and not joinable to `user.id` without the deployment secret |
| `created_at` | Retention and trend window | Timestamp only |

## Data deliberately not stored

- Page HTML, text, labels, form values, selected options or draft content.
- URL, query string, fragment, referrer or navigation history.
- IP address, user agent, device fingerprint, locale or timezone.
- Customer records, feedback content, conversation content or email addresses.
- The raw Better Auth user id, name or email.
- Cross-site identifiers or third-party cookies.

The write path accepts only a surface and section slugs. It rejects unknown
surfaces, unknown section formats, bodies over the section cap and requests
without a same-origin `Origin`/`Sec-Fetch-Site` signal. It requires a signed-in
workspace member and resolves the workspace from that membership, never from a
request-supplied id.

## Purpose and lawful basis

This is first-party operational analytics used to improve the product for the
workspace that is already signed in. It is not advertising, profiling,
automated decision-making or cross-site tracking, and no data is sold or shared
with a third party. The workspace's own members are the data subjects; the
workspace already sees their membership and role in settings.

## Access

Only an operator listed in `INTERNAL_ADMIN_EMAILS` can read the aggregate on
`/app/admin`. Workspace owners and admins cannot read another workspace's
settings usage, and the page shows no tenant names or content. The aggregate is
`count(*)` and `count(distinct actor_ref)` only.

## Retention

Rows older than `DASHBOARD_VIEW_RETENTION_DAYS` (default **180 days**) are
deleted by the daily `prune_observability` job. Lowering the value takes effect
on the next run. Workspace deletion cascades the rows immediately through the
`workspace_id` foreign key.

## Review checklist for a change

Before adding a field or a new surface:

1. Can the question be answered with the section slug alone? If yes, do not add
   the field.
2. Does the field contain customer content, a raw identifier, an IP address, a
   user agent or a URL? If yes, reject the change.
3. Is the value from a closed allowlist? If not, add one and a database check.
4. Is the retention window still the shortest that answers the question?
5. Does the write path still require auth and a same-origin request?
6. Update this document and `docs/observability.md` in the same change.

## Kill switch

The client beacon is the only writer. Removing it stops collection immediately;
the endpoint can also be disabled by returning 404 in the route without touching
stored data. Retention continues to prune existing rows.

## PostHog forwarding (public activity)

Public view and sign-up funnel events are forwarded from the server to PostHog
(`src/lib/posthog.ts`) so the same privacy-reviewed events can be explored as
funnels. The forwarding is deliberately narrow:

- **What travels:** the event name (`board_view`, `request_view`,
  `submit_started`, `widget_open`, `portal_page_view`, and the `signup_funnel`
  stages), a 32-character one-way SHA-256 key, the page slug where one exists,
  and a hashed product key. Nothing else.
- **What never travels:** email addresses, names, raw account, workspace,
  product or customer ids, board ids, request ids, IP addresses, user agents,
  URLs, referrers or message content. `enableExceptionAutocapture`,
  `disableGeoip` and `captureTracingHeaders` are all off.
- **Consent:** `trackPublicView` returns before any hash or event is produced
  when optional analytics is declined, so no request reaches PostHog either.
  Sign-up funnel stages carry no identifier of their own and were already
  aggregate-only.
- **Duplicates:** a funnel stage is forwarded only when the database insert
  created a row, so replaying a milestone cannot inflate a funnel.
- **Cookies:** there is no browser SDK. PostHog receives no request from a
  visitor's browser and sets no cookie, so the cookie table is unchanged.
- **Kill switch:** unset `POSTHOG_API_KEY`. Capture becomes a no-op and the
  first-party rows keep working exactly as before.
- **Retention:** governed by the retention setting on the PostHog project, not
  by a Herald cron job. Confirm it matches the published policy before launch.

Open items before this is final: the contracting entity and DPA for the PostHog
account, and whether the project runs on PostHog Cloud US or EU. Both change the
sub-processor row and the transfer paragraph in `src/features/trust/content.ts`.
