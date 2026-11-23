# Account onboarding email sequence

**Status:** implemented 2026-11-21
**Code:** `src/features/onboarding/emails.ts`,
`src/features/email/templates.ts`, `send_onboarding_emails` job
**Privacy:** account tips only; separate from workspace subscriber mail

## The four emails

| Step | Sent when | Link |
| --- | --- | --- |
| Welcome | The account exists and has no welcome row | `/app/onboarding` |
| First board | The owner has a workspace and product, and the previous step is at least 20 hours old | The public board plus the product dashboard |
| First release | A release for an owned product is published | The public changelog entry |
| Widget installed | A verified public `widget_install` event exists for an owned product | The product widget settings |

The sequence follows observed facts, not button clicks. A user who never
publishes a release does not receive the first-release email. A user who never
installs the widget does not receive the widget email.

## Pacing and idempotency

- At most one onboarding email per account per sweep.
- At least **20 hours** between sends.
- `onboarding_email_sends` has a unique `(user_id, kind)` row. A sent or skipped
  row is terminal; a failed row is retried.
- The provider call uses `onboarding:{userId}:{kind}` as the idempotency key.
- Accounts created before **2026-11-22T00:00:00Z** are excluded, so shipping the
  sequence does not email existing customers with stale tips.
- The sweep is enqueued by the cron route at most once every five minutes and
  processes at most 25 accounts per run. A failed send makes the job retry; the
  successful rows are skipped on the retry.

## Opt-out

Every email links to `/app/account#email-preferences`. The checkbox updates
`user.onboarding_emails` through a server action that uses the session user id,
never a form-supplied id. Turning it off stops only onboarding tips; it does not
affect verification, password, billing or product-update email.

## Configuration and testing

The sequence uses the same provider configuration as the rest of account mail:

```bash
RESEND_API_KEY=...
EMAIL_FROM="Herald <hello@your-domain.example>"
BETTER_AUTH_URL=https://your-herald.example
```

Without a provider the sweep returns `configured: false` and sends nothing.
Sandbox mode also suppresses it. To exercise it locally, set a real provider and
a loopback `BETTER_AUTH_URL`, enqueue the job, and run the cron runner:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "$BETTER_AUTH_URL/api/cron/jobs"
```

Then inspect the ledger without selecting an address:

```sql
SELECT kind, status, sent_at, error
FROM onboarding_email_sends
ORDER BY created_at DESC
LIMIT 20;
```

Do not paste recipient addresses, provider responses or message bodies into an
issue or a screenshot.

## Operational checks

- `send_onboarding_emails` should appear in the cron summary every five minutes.
- A sustained `failed` count is a provider or configuration problem; inspect the
  safe `onboarding.email_failed` log fields (`kind`, `retryable`, `error`).
- The status page already treats failed email jobs as an email-delivery signal.
- If the sequence is paused, disable the cron enqueue rather than deleting the
  ledger; resuming should not resend completed steps.
