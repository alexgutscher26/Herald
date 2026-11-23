# Twilio Segment destination for board activity

Send Herald board activity to Twilio Segment, Twilio's customer data platform,
where it can fan out to analytics, warehouses and activation destinations.

Twilio Segment's catalog has **no "Webhooks" source**: Webhooks is a
*destination*. Receiving Herald's signed webhook therefore uses a **Source
Function**, which exposes an HTTPS endpoint and runs the mapping code you write.
Herald posts the envelope, the source function calls `Segment.track`, and
Segment routes the event onward.

Segment has been part of Twilio since 2020 and is sold and documented as
**Twilio Segment**. Since 26 February 2026 the Segment website has merged into
Twilio.com: the console, documentation and support now live under Twilio, while
the product and its API endpoints are unchanged. Old Segment-only links redirect
to their new home.

## 1. Create the Twilio Segment source function

1. In Twilio Segment, open **Connections → Catalog**, then the **Functions**
   tab.
2. Click **New Function**, choose **Source** as the function type, then
   **Build**.
3. Paste the mapping from step 3 below into the editor, click **Configure**,
   name it `Herald`, and click **Create Function**.
4. From the Functions tab, click **Connect Source** and follow the prompts to
   add it to your workspace.
5. Open the connected source and copy the endpoint URL from **Overview** or
   **Settings → Endpoint**. It looks like
   `https://fn.segmentapis.com/?b=<base64>`, where the `b` parameter is the
   source id and its write key encoded together: the URL *is* the credential.
   Anyone who has it can inject events, so keep it out of tickets, screenshots,
   chat logs and public repositories, and reconnect the source to get a fresh one
   if it leaks.

Use that connected-source endpoint, not the "Auto-fill via Webhook" URL shown
inside the function editor: the editor URL is a test endpoint that expects a
Segment Public API bearer token, and Herald sends no custom headers. The
connected source's endpoint authenticates by its own unguessable URL instead.

Herald requires a public `http(s)` destination and refuses loopback and private
addresses, so this endpoint is the only thing Herald needs. No Segment write key
is stored anywhere in Herald.

## 2. Subscribe Herald

1. In the Herald dashboard open **Integrations → Outbound webhooks → Open
   webhook console** (the route is
   `/app/{workspace}/{product}/integrations/webhooks`). Creating or rotating an
   endpoint needs `settings:manage`, so an owner or admin does it.
2. In the **Name** field enter `Twilio Segment — board activity`.
3. In the **HTTPS URL** field paste the source function endpoint exactly as
   copied, including its `?b=…` query string, then click **Create endpoint**.
4. Select the events you want:

   - `request.created`
   - `request.updated`
   - `comment.created`
   - `changelog.created`
   - `conversation.updated`
   - `message.created`
   - `customer.event`

5. The console also shows a signing secret (`whsec_…`) once at creation time.
   You do not need it for this setup — see "The signing secret" below — so do not
   store it in the function or anywhere in Herald. It is not displayed again;
   rotating it keeps the previous secret valid for 24 hours.
6. Click **Send test**. The delivery is queued, then sent by the webhook cron
   worker (see step 4), and the log records Twilio Segment's HTTP answer — which
   is an acknowledgement, not proof the event was emitted (see step 4).

An endpoint with no events is rejected. Herald sends `POST` with
`content-type: application/json` and `user-agent: Herald-Webhooks/1`, preserves
the query string, refuses a URL with a `#fragment` or embedded `user:pass@`,
refuses loopback and private hosts, allows 10 seconds per attempt and does not
follow redirects — a 3xx answer counts as a failed attempt.

`POST /api/app/{workspaceSlug}/webhooks` creates the same endpoint from code,
but it is authenticated by a signed-in dashboard session plus a same-origin
`Origin`/`Sec-Fetch-Site` check — there is no bearer token for that route — so
the webhook console is the supported path for a Segment setup.

Herald makes up to five delivery attempts with exponential backoff (30s, 2m,
8m, 32m, then about 2h08m, ±20% jitter). When the function keeps answering
non-2xx, the delivery moves to the dead-letter view in the webhook console,
where it can be replayed after the function is fixed.

### The signing secret

Herald signs every delivery: `x-herald-signature: v1=<hmac-sha256 hex>` over
`<x-herald-timestamp>.<raw body>`, with a five-minute timestamp window, plus an
`x-herald-delivery` id you can dedupe on.

A Twilio Segment source function is the wrong place to verify it. The function
API exposes the parsed body (`request.json()`) and the headers, not the raw
bytes, and the HMAC covers the exact bytes Herald sent — re-serialising the
parsed object can change spacing or key order and fail an otherwise correct
signature. The endpoint URL is already an unguessable credential, so rely on
that and leave the secret unstored.

Keep the secret for receivers you control, where the raw body is available (your
own HTTP handler, or a proxy in front of Segment). If a secret is exposed, click
**Rotate secret** in the webhook console: the new secret is used immediately, the
old one stays valid for 24 hours and is sent as `x-herald-signature-previous`,
so a receiver can switch without dropping deliveries.

## 3. Map the envelope in a source function

In the source function editor, use this mapping. It turns each Herald envelope
into a stable Twilio Segment event name and flattens the useful ids to the top
level. Twilio Segment's function runtime exposes the `Segment` API
(`identify`, `page`, `track`); `Segment.track` keeps its name — only the product
branding moved to Twilio.

```js
async function onRequest(request, settings) {
  const envelope = request.json();
  const type = envelope.type;
  const data = envelope.data || {};

  const names = {
    "request.created": "Herald Request Created",
    "request.updated": "Herald Request Updated",
    "comment.created": "Herald Comment Created",
    "changelog.created": "Herald Changelog Created",
    "conversation.updated": "Herald Conversation Updated",
    "message.created": "Herald Message Created",
    "customer.event": data.name || "Herald Product Event"
  };

  const name = names[type];
  if (!name) return;

  // Only `customer.event` carries a customer id; the other six events carry
  // record ids. A userId-only guard would drop six of the seven event types
  // while still answering 200, so fall back to a stable workspace key.
  const customerId =
    data.customer_external_id ||
    data.external_id ||
    data.author_external_id ||
    data.customer_id;

  Segment.track({
    userId: String(customerId || `workspace:${envelope.workspace_id}`),
    event: name,
    properties: {
      herald_event: type,
      herald_delivery_id: envelope.id,
      workspace_id: envelope.workspace_id,
      occurred_at: envelope.created_at,
      ...data
    }
  });
}
```

Keep the `userId` mapping aligned with the identity you use in your product. For
`customer.event`, `data.external_id` is your own customer id and is the best
choice. For comments and messages, Herald sends the author and customer ids; add
`author_external_id` to the webhook payload mapping if you need it, or join on
`customer_id` in your warehouse.

The six non-customer events have no person attached, so the mapping above falls
back to `workspace:<workspace_id>`: those events arrive, grouped per workspace.
If you would rather keep them out of person profiles, send
`anonymousId: "workspace:" + envelope.workspace_id` instead of the fallback
`userId` for those events — Segment accepts either identifier.

## Event mapping

| Herald event | Twilio Segment event | Useful properties |
| --- | --- | --- |
| `request.created` | `Herald Request Created` | `request_id`, `board_id`, `title`, `status`, `source` |
| `request.updated` | `Herald Request Updated` | `request_id`, `status`, `previous_status` |
| `comment.created` | `Herald Comment Created` | `request_id`, `comment_id`, `internal` |
| `changelog.created` | `Herald Changelog Created` | `release_id`, `title`, `status` |
| `conversation.updated` | `Herald Conversation Updated` | `conversation_id`, `status`, `assignee_id` |
| `message.created` | `Herald Message Created` | `conversation_id`, `message_id`, `author_type` |
| `customer.event` | event `data.name` (e.g. `report.exported`) | `customer_id`, `external_id`, `properties` |

## 4. Verify

**"Send test" queues a delivery; it never calls Segment inline.** Delivery is
owned by the `/api/cron/webhooks` scheduler (every minute in the documented
self-hosted deployment), so a queued test stays `pending` until that worker
runs:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "$BETTER_AUTH_URL/api/cron/webhooks"
```

The response reports `claimed`, `succeeded` and `failed` counts and never echoes
a URL or payload. A row that stays `pending` means the scheduler never ran —
nothing is wrong with Twilio Segment.

1. Click **Send test**, then trigger the worker (or wait for the schedule).
2. Read the delivery row:
   - `succeeded` — Twilio Segment accepted the request. A source function
     acknowledges the HTTP call before running your code, so this does not yet
     mean the event was emitted; function errors show up in Twilio Segment, not
     here.
   - `failed` — `responseStatus`/`error` carry the receiver's answer. A 404 means
     the endpoint URL is wrong or truncated (the `?b=` value must be intact), a
     3xx means the receiver redirected and Herald does not follow redirects, and
     a 5xx means the function threw.
   - `skipped` — nothing was sent. `Sandbox mode: webhook delivery suppressed.`
     means the deployment has `SANDBOX_MODE` on, which records rows and audit
     entries but never calls a receiver; set `SANDBOX_MODE=off` and restart before
     testing a real endpoint.
3. In the Twilio Segment **Debugger** for that source, confirm the mapped event.
   If nothing arrives, open the function's own **Logs**: `RetryError: Invalid
   URL` and similar messages mean the deployed function code threw (Twilio
   Segment retries those payloads itself), and the mapping in step 3 never
   builds or parses a URL — so a URL error means the deployed code is not that
   mapping. Redeploy it. A function that returns without calling
   `Segment.track` (for example the old `userId`-only guard) shows nothing in
   either place.
4. Replay a delivery and confirm Twilio Segment receives the same `id`; dedupe on
   `herald_delivery_id` if your warehouse needs it.

A test payload carries `test: true` plus the catalogue example. Six of the seven
types have no customer id, so use `customer.event` for the first end-to-end check
if you want to see a real customer id in the event.

Five failed attempts move a delivery to the dead-letter view, where it can be
replayed after the source function is fixed.
