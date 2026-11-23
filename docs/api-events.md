# Product events

`POST /api/v1/events` records a customer-scoped product event for analytics
and outbound targeting. It uses the same workspace token, `write` scope,
idempotency, rate limit and error shape as the rest of `/api/v1`. The event is
stored in `customer_events`; it is not a feedback request and never appears on
a public board.

## Record an event

```bash
curl -X POST "$BETTER_AUTH_URL/api/v1/events" \
  -H "Authorization: Bearer hrl_…" \
  -H "content-type: application/json" \
  -H "Idempotency-Key: export-user_123-01HZX5R8K4" \
  -d '{
    "product_id": "c9f0f895-fb98-4c49-8f27-3a4d5e6f7081",
    "name": "report.exported",
    "customer": {
      "external_id": "user_123",
      "email": "ada@example.com",
      "name": "Ada Lovelace"
    },
    "event_id": "evt_01HZX5R8K4",
    "occurred_at": "2026-02-03T04:05:06.000Z",
    "properties": {
      "format": "csv",
      "rows": 1200,
      "scheduled": false
    }
  }'
```

A successful first write answers `201`:

```json
{
  "data": {
    "id": "b1e0c8f2-6a2e-4f0e-9d4a-1c2b3a4d5e6f",
    "name": "report.exported",
    "customer_id": "8c1f0e2a-4b6d-4c8e-9f0a-2b3c4d5e6f70",
    "external_id": "user_123",
    "occurred_at": "2026-02-03T04:05:06.000Z",
    "received_at": "2026-02-03T04:05:07.120Z",
    "duplicate": false
  }
}
```

The customer is resolved inside the token's workspace by `id`, then
`external_id`, then `email`. A missing customer is created, so an event can be
the first time a person appears. `email` is normalized for matching. An `id`
from another workspace is treated as missing.

## Fields and limits

| Field | Required | Meaning |
| --- | --- | --- |
| `product_id` | yes | Product in the token's workspace that owns the event. |
| `name` | yes | Stable name: letters, digits, `.`, `:`, `_`, `-`; 1–100 chars. |
| `customer` | yes | At least one of `id`, `external_id`, `email`; `name` is used on create. |
| `event_id` | no | Your dedupe id, unique per product, up to 200 chars. |
| `occurred_at` | no | ISO 8601 with an offset; defaults to now. Must be within the last 90 days and no more than five minutes in the future. |
| `properties` | no | Flat object of string/number/boolean/null values; at most 50 keys and 4 KB serialized. Nested objects are rejected. |

`event_id` and `Idempotency-Key` answer different questions. `event_id`
deduplicates the event itself: posting the same `event_id` against the same
product returns the stored event with `duplicate: true`, even with a new
idempotency key. `Idempotency-Key` replays the whole HTTP response for the
configured `API_IDEMPOTENCY_TTL_HOURS` (24 hours by default)
and also guards a request that has no `event_id`. Send both when you have them.

A duplicate event answers `200`. A first insert answers `201`. Only the first
insert emits the `customer.event` webhook, so a retry or replay cannot trigger
an automation twice.

## SDK helper

`src/features/api-v1/events-sdk.ts` is dependency-free and safe to import from a
server, a script or a worker. Keep the token server-side; do not ship it to a
browser.

```ts
import { createHeraldEventsClient } from "@/features/api-v1/events-sdk";

const herald = createHeraldEventsClient({
  baseUrl: process.env.HERALD_URL!, // origin or origin + /api/v1
  token: process.env.HERALD_API_TOKEN!, // server-side only
  timeoutMs: 10_000,
});

const result = await herald.track({
  name: "report.exported",
  customer: { externalId: "user_123", email: "ada@example.com" },
  eventId: "evt_01HZX5R8K4",
  properties: { format: "csv", rows: 1200 },
});

if (!result.ok) {
  // result.status === 0 means the request never reached Herald.
  console.error(result.status, result.error, result.details);
}
```

`track` uses `eventId` as the default `Idempotency-Key`, or generates one when
neither an event id nor an explicit `idempotencyKey` is supplied. It returns a
result object instead of throwing on HTTP and transport failures.

## Outbound webhook

Subscribing to `customer.event` delivers the usual signed envelope:

```json
{
  "id": "delivery-id",
  "type": "customer.event",
  "workspace_id": "…",
  "created_at": "2026-02-03T04:05:07.120Z",
  "data": {
    "event_id": "b1e0c8f2-6a2e-4f0e-9d4a-1c2b3a4d5e6f",
    "name": "report.exported",
    "customer_id": "8c1f0e2a-4b6d-4c8e-9f0a-2b3c4d5e6f70",
    "external_id": "user_123",
    "occurred_at": "2026-02-03T04:05:06.000Z",
    "properties": { "format": "csv", "rows": 1200 }
  }
}
```

The same signature, retry and dead-letter rules as every other webhook event
apply; see [Webhooks](reference.md#webhooks).
