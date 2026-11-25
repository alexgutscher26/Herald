# ADR 0007: Realtime uses Server-Sent Events, not WebSockets

- **Status:** Accepted
- **Date:** 2026-11-22
- **Applies to:** `src/app/api/app/[workspaceSlug]/[productSlug]/conversations/events/route.ts`,
  `src/app/api/public/conversations/[conversationId]/stream/route.ts`,
  `src/features/live/`, `drizzle/0068_conversation_events.sql`,
  `docs/conversation-realtime.md`

## Context

The dashboard inbox and the widget thread need server→browser updates when a
message arrives. The traffic is one-directional: the browser sends a message
through a normal POST, and the server pushes the persisted event. Typing and
presence are ephemeral and can ride the same channel.

The alternatives were:

- **Keep polling.** The dashboard polled every 5 seconds and the widget thread
  every 3 seconds. One dashboard tab made 720 refresh requests per hour; a
  widget thread made 1,200. Each request re-rendered a server component and
  read Postgres.
- **Run a WebSocket server.** Next.js route handlers do not host a durable
  WebSocket endpoint. This would add a second deployable process, a connection
  registry and a new failure mode, for a capability the product does not use
  (the browser never needs to push a stream).
- **Server-Sent Events.** A route handler returns a streaming response; the
  browser reconnects automatically; the protocol is HTTP and passes through the
  existing proxy.

The event source also mattered. A writer could be the dashboard, the widget,
inbound email, Slack or Mira. Hooking each writer in application code would
miss one; Postgres triggers plus `pg_notify` cover every writer because every
writer commits a row.

## Decision

Use SSE, fed by Postgres triggers and `pg_notify`.

- One fan-out: `conversation_events` notifications carry the product and
  conversation id. Two authorized consumers read the same stream.
- The dashboard route authenticates with the signed-in operator and product,
  and filters every event by product before writing a frame.
- The widget route authenticates with the first-party customer session and
  checks thread ownership; a signed-out or foreign thread gets `401`/`404`
  before a stream starts, and only that conversation's events are forwarded.
- A 15-second `: ping` heartbeat keeps proxies from closing an idle stream.
- Polling remains the fallback. The dashboard keeps its 5-second refresh and
  the widget keeps its 3-second poll when the stream or `LISTEN` is
  unavailable. SSE is an upgrade with a safe degraded mode, not the only path.
- Typing is an ephemeral same-origin POST with a 4-second client TTL and writes
  no row. Presence uses the existing operator heartbeat and its 3-minute
  window.
- Message-level streaming only. Token-level model output would require holding
  a provider connection open in the request; generation runs in the durable
  job queue and the persisted answer arrives as a normal event.

## Consequences

- One long-lived connection replaces hundreds of refreshes. Measured frame
  sizes and request counts are in [../conversation-realtime.md](../conversation-realtime.md):
  720 polling requests/hour become one connection and 240 heartbeat frames.
- Each app instance holds one extra database connection for `LISTEN`, not one
  per browser tab. That connection must be counted in `DATABASE_POOL_MAX`.
- A transaction-pooled endpoint (some Neon URLs) may not support `LISTEN`.
  Verify `pg_stat_activity` shows a dedicated listener; if not, the polling
  fallback is the behaviour. Do not hide the fallback.
- Reconnect is automatic but not instantaneous. The client must reconcile by
  refreshing on reconnect; an event missed during the gap is not replayed from
  a stream buffer.
- A proxy must allow a long-lived response and disable response buffering.
  Document the timeout in the deployment notes; the heartbeat is not a
  substitute for a proxy that buffers the whole response.
- No presence beyond the existing heartbeat, no typing persistence, and no
  cross-device cursor. Those are product decisions, not protocol limits.

## Verification

- `tests/conversation-events.test.ts` covers frame parsing and rejects
  malformed payloads.
- The dashboard and widget routes share their existing authorization helpers,
  so an unauthorized request fails before the stream starts.
- The widget stream path builder is pinned by
  `tests/widget-conversations-api.test.ts`.

Limits: no local Postgres was available when the feature was recorded, so the
triggers, `LISTEN`, an open stream and reconnect were not exercised at runtime
in that workspace. No production p95, reconnect rate or proxy-timeout data has
been collected. Test the listener connection against the actual pooler before
claiming instant delivery.
