# Slack integration

Each product can connect one Slack channel. A top-level message in that channel
becomes a feedback request on a suggested board, and later status changes reply
under the original message. A message that begins with `!support` starts a
support conversation instead, and replies in that thread continue it. The bot
never writes to a channel it was not connected to, and a message in a different
channel is ignored.

## Slack app setup

A hosted Herald instance already has its Slack app configured: skip to
**Connect a product**. Create your own app only when you self-host Herald or
want a separate app for your team, and configure it with:

- **OAuth redirect URL:** `https://your-herald.example/api/integrations/slack/callback`
- **Events API request URL:** `https://your-herald.example/api/integrations/slack/events`
- **Slash command request URL:** `https://your-herald.example/api/integrations/slack/commands`
- **Bot scopes:** `channels:history`, `channels:read`, `chat:write`,
  `commands`, `groups:history`, `groups:read`, `links:read`, `links:write`,
  `team:read`
- **Bot events:** `message.channels`, `message.groups`, `link_shared`
- **Unfurl domains:** the canonical Herald origin.

Set these server-side environment variables:

```bash
SLACK_CLIENT_ID=...
SLACK_CLIENT_SECRET=...
SLACK_SIGNING_SECRET=...
BETTER_AUTH_URL=https://your-herald.example
```

`SLACK_REDIRECT_URI` overrides the callback URL if the app is behind a different
public origin. `SLACK_API_URL` and `SLACK_AUTHORIZE_URL` are test-only overrides.
No Slack token is exposed to the browser; only the server stores the bot token.

## Connect a product

1. Open **Product → Integrations**.
2. Choose **Connect Slack** and approve the app.
3. Invite the app to the channel: `/invite @Herald`.
4. Reload the page and choose the channel under **Notification channel**.

A Slack team can connect different products to different channels. A channel
can only belong to one product.

## What happens

- A top-level message with text is acknowledged immediately. Slack retries are
  deduplicated by `team_id + event_id`.
- A durable job chooses a title and board. When `AI_API_URL` and `AI_MODEL` are
  configured, the model gets the active board ids and returns JSON; an unknown
  board, invalid JSON or provider failure falls back to the first line and the
  first active board. Filing never depends on the AI provider.
- The request is written with `source = 'slack'`, the Slack display name as its
  author label, and a link row tying the request to the channel/thread.
- A confirmation replies in the original thread. Bot messages, edits and
  messages in unconnected channels are ignored. A reply in a feedback thread is
  ignored; a reply in a support thread is handled as described below.
- A status change from the dashboard or REST API queues `slack_status_update`
  and posts e.g. `*Fix the export* is now *Planned*` under the same message.
  Repeating the same transition does not post twice.
- In sandbox mode requests are still filed but no Slack message is posted.

## Link previews

Pasting a public Herald request URL into a connected channel queues a
`chat.unfurl` preview with the request title, status, vote count, comment count,
product and board. The link is resolved through the public projection; private,
hidden, archived, merged, moderation-rejected and foreign-origin links do not
unfurl. The old `/board/requests/<id>` shape is accepted so messages sent before
the canonical URL fix still preview.

## Slash command

`/herald <text>` files a request from the connected channel. Slack's
three-second deadline is respected by acknowledging with an ephemeral message
and queueing a durable `slack_command` job; the job uses the configured AI
provider when available and replies through the command's one-shot
`response_url` with the new request link. The command only works in a channel
that is connected to a product, so a team with several products stays
unambiguous. The request has no source message, so it does not create a
`slack_request_links` row and later status updates do not reply in a thread.

## Support threads

A top-level message whose first word is `!support` opens a support conversation
instead of a feedback request. Everything after the command is the first
customer message; `!support` with no body is rejected in the thread.

- The Slack author becomes a workspace customer keyed by `team_id + user_id`, so
  the same person keeps one identity across threads without crossing into
  another workspace.
- `slack_conversation_links` maps the channel and thread root to the
  conversation. It is unique on both `(team_id, channel_id, thread_ts)` and
  `conversation_id`, so a retry cannot create a second thread.
- A reply in the mapped thread is appended as a customer message with
  `channel = 'slack'`. A message id is unique, so Slack's retry is inert. The
  thread reopens if it was resolved or archived, and the team unread counter and
  preview update in the same transaction.
- A team reply from the Herald inbox is mirrored into the Slack thread by the
  `slack_support_mirror` job. Notes are never mirrored, and the job's dedupe key
  is the Herald message id. The mirror is best-effort; a Slack outage never
  fails the inbox reply.
- A reply in any other thread, or a thread mapped to another product, is
  ignored. The route still verifies the raw-body signature before parsing and
  resolves the integration by `team_id + channel_id`, so the normal tenant
  boundary applies.

Slack threads are not mirrored on creation in sandbox mode; the conversation,
link and messages are still written. Attachments in a support reply are not
imported. Status replies for support threads are not sent automatically; the
inbox owns the conversation status.

## Data and limits

`slack_integrations` stores the installation and token; `slack_oauth_states`
holds one-time OAuth state hashes; `slack_request_links` maps a request to its
origin thread; `slack_conversation_links` maps a support thread to a
conversation. Deleting the product cascades the integration and both link
tables.

The events and command routes verify the `v0` HMAC and a five-minute timestamp
window before parsing the body. Events requests are limited to 256 KB and
commands to 64 KB. No attachment downloading or interactive buttons are
implemented.

## Verification

`tests/integration/slack.test.ts` runs the real routes and services against a
local Slack-compatible server and real Postgres: signature challenge/rejection,
OAuth exchange and one-time state, channel isolation, duplicate event delivery,
AI suggestion, deterministic fallback, confirmation reply, and a status reply in
the original thread. `tests/integration/slack-support.test.ts` covers `!support`
parsing, thread mapping, retry dedupe, reopening, cross-product rejection and
the outbound mirror job.

Request-link parsing for unfurls is covered without a database by
`tests/slack-links.test.ts`.
