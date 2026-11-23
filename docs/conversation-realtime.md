# Conversation realtime: SSE decision and measurement

Status: implemented; production traffic has not been measured.

## Decision

Use **Server-Sent Events**, not WebSocket. The dashboard needs server→browser
updates only, Next.js route handlers can return a streaming response, and a
WebSocket server would add a second deployable process and connection lifecycle
for no product capability. Typing and presence use the same stream.

The event source is Postgres triggers + `pg_notify` (`drizzle/0068_conversation_events.sql`),
so every writer is covered: dashboard, widget, inbound email, Slack and Juno.
The dashboard keeps its 5-second refresh and the widget keeps its 3-second poll
as fallbacks when the stream or `LISTEN` is unavailable.

There are two authorized consumers of the same fan-out:

- the dashboard route (`/api/app/.../conversations/events`) scoped by the
  signed-in operator and product;
- the widget route (`/api/public/conversations/{id}/stream`) scoped by the
  first-party customer session, product and thread ownership.

The widget stream only forwards events for its own conversation id. It shows a
“Juno is typing…” indicator while the latest message is the customer’s and Juno
is enabled; the persisted answer then arrives as a normal conversation event.
This is message-level streaming, not token-level model output, because
generation runs in the durable job queue.

## Measured numbers

Measured on 2026-11-21 with `bun` and the actual frame shape from
`src/features/live/conversation-event.ts`:

| Item | Value |
| --- | --- |
| Conversation event frame | 219 bytes |
| Heartbeat frame (`: ping`) | 8 bytes |
| 5-second polling, one tab | 720 refresh requests/hour |
| 3-second polling, one tab | 1,200 refresh requests/hour |
| SSE heartbeats, one connection | 240 frames/hour (15-second interval) |

A dashboard tab using SSE therefore replaces 720 round trips per hour with one
long-lived connection and 240 small heartbeat frames. The exact byte saving
depends on the RSC/HTML payload of a refresh, which was not measured here; the
request count is exact from the configured intervals.

The backlog's “3 s thread” note was stale for the dashboard: both inbox and
thread used the same 5-second cadence (`ConversationPoller` default and the
`ConversationLive` fallback). The widget thread now uses SSE with its previous
3-second poll retained as the fallback.

## What is verified

- `tests/conversation-events.test.ts` covers event parsing and rejection of
  malformed payloads (4 tests).
- `bun run typecheck` passes.
- The dashboard SSE route uses the same `authorizeAppApi` session/product
  check and filters events by `productId` before writing a frame.
- The widget SSE route calls the same `loadCustomerThread` authorization as the
  JSON thread route and filters events by `conversationId`; a signed-out or
  foreign thread gets 401/404 before a stream starts. The stream path builder is
  pinned by `tests/widget-conversations-api.test.ts`.
- Typing is an ephemeral same-origin POST with a 4-second client TTL; it writes
  no row. Presence uses the existing `workspace_operators.last_seen_at`
  heartbeat and its 3-minute window.

## Not verified here

- No local Postgres is available in this workspace, so the migration, triggers,
  `LISTEN`, an open SSE response, typing and presence were not exercised at
  runtime. Unit checks do not prove the database path.
- No production request volume, p95, reconnect rate or proxy timeout data was
  collected. The decision uses the static cost above, not an A/B measurement.
- The widget stream and typing indicator were not exercised in a browser or
  against a live Postgres feed; only the path builder and typecheck cover them.
- `pg.Client` `LISTEN` may not work through a transaction-pooled endpoint such
  as some Neon URLs. In that case the fallback polling remains the behaviour.
  Verify `pg_stat_activity` shows a dedicated listener connection before
  claiming live updates in production.
- Because a fallback still polls every 5 seconds, this is not a hard guarantee
  of instant delivery; it is an upgrade with a safe degraded mode.

## Rollout checks

1. Apply `0068_conversation_events.sql` and confirm the three triggers exist.
2. Open two dashboard sessions; verify a message written by one appears in the
   other without waiting for the poll, and that the typing hint expires.
3. Confirm one extra database connection per app instance, not per browser tab.
4. Watch reconnect and `LISTEN failed` logs for a full day. If they are common,
   fix the endpoint/pooler rather than hiding the fallback.
