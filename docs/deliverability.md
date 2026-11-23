# Email deliverability runbook

This runbook covers production sending for Herald: warm-up, reputation,
blocklist recovery, suppression handling, quiet hours, retries and the checks
that should happen before a campaign or a sender change.

The outbox is `notification_deliveries`. A row is created before any provider
call and updated with the final outcome. The provider webhook moves rows to
`sent`, `bounced` or `complained`; the periodic outbox sweep retries only a
bounded number of times. Test sends are not written to the outbox.

## Before the first send

1. Configure `RESEND_API_KEY` and `EMAIL_FROM`, then save a workspace sender
   identity: From address, Reply-To and a real postal address.
2. Verify both the From and Reply-To mailboxes. Campaign and win-back sending
   stays blocked until verification completes.
3. Publish the sending domain's SPF, DKIM and DMARC records. The settings page
   checks DNS separately for the workspace identity and the deployment
   fallback and shows the exact records. Do not approve a campaign while any
   check is red.
4. Send to yourself in Settings → Email previews and use the test send with
   "Send to me as a customer". Check that the sender, Reply-To and footer look
   correct in a real inbox.
5. Make sure the physical postal address is current. It is required in the
   footer of every marketing message.

## Warm-up

New domains and new IPs should not start with the full list.

- Start with the most engaged recipients: recent request authors, voters and
  people who opened a previous update.
- Send a small batch first (a few hundred at most). Keep daily volume steady
  for several days, then increase in steps rather than doubling overnight.
- Pause if the bounce rate rises above roughly 2% or complaints rise above
  0.1%. Investigate before the next batch.
- Transactional mail (support replies, status updates, CSAT) can start
  immediately; it is expected and has its own engagement. Do not mix it into
  the marketing warm-up count.
- Suppress hard bounces and complaints automatically. Never re-enable an
  address that bounced or complained.

## Reputation monitoring

Check these weekly, and after every campaign:

- Provider dashboard: delivery, bounce, complaint and unsubscribe rates.
- `notification_deliveries`: failed, bounced and complained rows for the
  product; use the delivery log search and status filter.
- Domain authentication: SPF/DKIM/DMARC still pass after DNS or sender
  changes.
- Reply-To mailbox: real replies are reaching support, and auto-replies are
  being recorded as internal notes instead of being treated as customer
  messages.
- List hygiene: suppression CSV export and subscriber export are current; no
  stale imports are adding previously bounced addresses.

A sudden drop in opens or a rise in deferrals is a reputation signal even when
no hard failure appears in the log. Stop new campaigns until the cause is
understood.

## Blocklist recovery

If a major provider or blocklist is rejecting mail:

1. Confirm the rejection in the provider dashboard and the delivery log. Read
   the exact SMTP/provider code; do not guess from a generic failure.
2. Pause marketing. Keep transactional support replies flowing only if the
   provider confirms they are unaffected.
3. Check the sending domain and IP against the blocklist's own lookup page.
   Record the listing name, the reason and the date.
4. Fix the cause first: remove purchased or stale addresses, correct
   authentication, stop a campaign that caused complaints, or fix a compromised
   form. Requesting delisting without a fix usually gets relisted.
5. Submit the delisting request with the concrete remediation and the date it
   was completed. Keep the ticket reference.
6. Resume with a small engaged batch, not the full list. Watch bounce and
   complaint rates for several days.
7. If the blocklist has no self-service process, contact the provider's
   deliverability support and include the message IDs from the delivery log.

Do not create a new domain to route around a listing; that usually spreads the
problem and loses the domain's history.

## Suppressions

The suppression list is workspace-wide. It is checked before every send and
before a test send.

- Manual adds require a reason: `manual`, `hard_bounce`, `complaint` or
  `unsubscribe`. Use `manual` only for an operator decision; do not use it to
  hide a bounce or complaint.
- Import a CSV with `email` and optional `reason` and `note`. Up to 10,000 rows
  or 5 MB. Unknown reasons are imported as `manual` and reported in the result.
  Invalid addresses are skipped and counted.
- Export the list before a large cleanup. The export includes reason, note and
  creation time; re-importing an address updates its reason and note.
- Removing a suppression is a deliberate action. Re-check the original bounce
  or complaint first. A removed hard bounce can damage reputation again.

## Quiet hours

Subscribers can set a local quiet window on their preference page. The window
is stored as two minutes-past-midnight values plus an IANA timezone, so it
survives DST changes.

- Quiet hours apply to non-urgent subscriber mail: releases, win-back,
  request status and reply notifications, digests and outbound messages.
- They do not apply to support replies, CSAT, transcripts, account security or
  billing notices.
- A deferred row stays `pending` with `defer_until` and an explanatory error.
  The job succeeds without consuming a provider attempt; the sweep picks the
  row up after the marker and re-evaluates the window. A manual retry clears
  the marker.
- If a subscriber's timezone is invalid, the sender does not defer; fix the
  preference rather than silently holding mail forever.

## Retries and failures

- Transient provider failures retry up to three attempts; permanent failures
  land in `failed`.
- The delivery log supports search by recipient, content title, provider
  message ID and error, plus a status filter. A failed, bounced, complaint or
  skipped row can be retried from the UI by someone with `settings:manage`.
- Retrying resets the attempt counter and queues a fresh `send_email` job. It
  does not bypass suppression, authentication, quiet hours or the sender
  identity check.
- Bounced and complained rows are normally not worth retrying. Fix the address
  or the content first; a complaint retry risks another complaint.

## Rendering checks

Every outbound template is rendered in Settings → Email previews with fixed
sample data. Before changing a template:

- Check light and dark mode at desktop width.
- Check 375 px width; the card should lose its side border and padding and the
  call to action should become full width.
- Check the HTML still uses the table envelope and the MSO conditional wrapper
  for Outlook. Previews cannot run Outlook itself; open a test send in Outlook
  when the change is material.
- Keep `color-scheme` and `supported-color-schemes` meta tags. They tell clients
  the message supports both schemes.
- Do not put essential content only in an image, and do not rely on CSS that
  Outlook strips.

## Auto-replies

Inbound auto-replies (RFC 3834 `Auto-Submitted`, `X-Autoreply` and the usual
vacation subjects) are still dropped before the inbox. When the auto-reply is
addressed to a conversation reply token, Herald also writes one idempotent
internal note on that thread. The thread status, unread count, last-message
preview and customer-visible messages are unchanged. An auto-reply never
creates a new support conversation and never triggers an away reply.

## Incident checklist

- [ ] Is the failure provider-wide, domain-wide or one recipient?
- [ ] Are SPF, DKIM and DMARC still passing?
- [ ] Is the bounce/complaint rate above threshold?
- [ ] Are suppression imports and exports current?
- [ ] Is the sender identity verified and the postal address current?
- [ ] Are quiet-hour deferrals expected, or is a bad timezone holding mail?
- [ ] Did the delivery log retry succeed, and did it bypass any guard?
- [ ] Was the provider or blocklist ticket recorded with message IDs?
- [ ] Did the first resumed batch stay small and clean?
