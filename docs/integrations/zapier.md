# Zapier triggers

Herald's signed webhooks are the Zapier trigger source. You do not need a
Zapier app listing: create a **Webhooks by Zapier → Catch Hook** trigger, then
subscribe Herald to the events you want. Each delivery starts one Zap run with
the event envelope as its input.

This is the supported trigger set:

| Trigger | Herald event | Fires when |
| --- | --- | --- |
| New feedback request | `request.created` | A request is created by the dashboard, API, public board, Slack or a capture integration. |
| Request updated | `request.updated` | A request changes status, title, body, tags, visibility or merge state. |
| New comment | `comment.created` | A customer or teammate comments on a request. |
| New changelog entry | `changelog.created` | A changelog draft is created through the API. |
| Conversation updated | `conversation.updated` | A support conversation changes status or assignee through the API. |
| New support message | `message.created` | A team reply or internal note is added to a conversation through the API. |
| Product event | `customer.event` | `POST /api/v1/events` stores a customer event. |

## Set up a Zap

1. In Zapier, create a Zap whose trigger is **Webhooks by Zapier → Catch Hook**
   and copy the hook URL. Catch Hook parses the JSON body into fields, which is
   all the field mapping below needs; pick **Catch Raw Hook** instead only when
   you want to verify signatures (see below).
2. Create a Herald webhook for that URL in the dashboard at **Integrations →
   Outbound webhooks → Open webhook console**, subscribed only to the events the
   Zap handles. These are the fields the console saves:

   ```json
   {
     "name": "Zapier — new requests",
     "url": "https://hooks.zapier.com/hooks/catch/…",
     "events": ["request.created", "comment.created"]
   }
   ```

   The console is the supported path. `POST /api/app/{workspaceSlug}/webhooks`
   creates the same endpoint, but it is authenticated by a signed-in dashboard
   session plus a same-origin `Origin`/`Sec-Fetch-Site` check, so it cannot be
   called with a bearer token.

   The signing secret is shown once at creation and you only need it when a Zap
   verifies signatures. **Rotate secret** replaces it and keeps the previous
   secret valid for 24 hours, sent as `x-herald-signature-previous`.
3. In Zapier, click **Test trigger**, then create a request in Herald or use
   **Send test** on the endpoint in the console. A test delivery is queued and
   sent by the `/api/cron/webhooks` worker (see below); the envelope the trigger
   receives is that delivery.
4. Add a **Filter** step on `type` when the hook carries more than one event,
   then use fields such as `data.title`, `data.status`, `data.request_id` and
   `data.board_id` in later steps. `data` carries only what that event holds, so
   map per event type instead of assuming every field exists.

Every delivery has this envelope:

```json
{
  "id": "delivery-id",
  "type": "request.created",
  "workspace_id": "…",
  "created_at": "2026-02-03T04:05:06.000Z",
  "data": { "request_id": "…", "title": "…", "status": "open" }
}
```

## Verify the signature

Herald signs `${timestamp}.${rawBody}` with HMAC-SHA256 and sends
`x-herald-signature: v1=<hex>`, `x-herald-timestamp`, `x-herald-event`,
`x-herald-delivery` and `content-type: application/json`. Zapier does not verify
the signature for you.

Verification needs the exact bytes Herald sent, so this is the one case where the
trigger must be **Catch Raw Hook**, not Catch Hook: Catch Hook parses the body and
does not expose headers, while Catch Raw Hook returns the unparsed body (up to
2 MB) together with the headers.

Add a **Code by Zapier** step and map three inputs from the Catch Raw Hook step:
`raw_body` → **Raw Body**, `signature` → **Headers X-Herald-Signature**, and
`timestamp` → **Headers X-Herald-Timestamp**. Keep the secret in a Zapier Storage
value and map it as `secret`; do not paste it into the code step.

```js
const crypto = require("crypto");

const secret = inputData.secret;
const timestamp = inputData.timestamp;
const supplied = inputData.signature;
const body = inputData.raw_body;

if (!secret || !timestamp || !supplied) throw new Error("Missing signature headers");
if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
  throw new Error("Stale delivery");
}

const expected =
  "v1=" +
  crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");

const valid =
  supplied.length === expected.length &&
  crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
if (!valid) throw new Error("Invalid signature");
return { body: JSON.parse(body) };
```

Without access to the raw body — Catch Hook only — treat the hook URL as the
credential: anyone holding it can start the Zap, so do not publish it or reuse it
across workspaces, and dedupe on the envelope `id`.

## Limits and retries

Herald makes up to five delivery attempts with exponential backoff (`30s → 2m →
8m → 32m → ~2h08m`, ±20% jitter) and records every attempt in the webhook
console's delivery log. Zapier answers `200` as soon as it accepts a hook, so a
Zap that fails afterwards is not retried by Herald — use Zapier's own replay for
that. Deduplicate on the envelope `id` if a hook can be replayed.

Delivery is owned by the `/api/cron/webhooks` worker (`Authorization: Bearer
$CRON_SECRET`, every minute in the documented deployment). A queued delivery
stays `pending` until that worker runs, a deployment with `SANDBOX_MODE` on
records it as `skipped` without calling Zapier, and five failed attempts move it
to the dead-letter view for replay.

Private, loopback and link-local webhook URLs are refused. Zapier's public hook
URLs are accepted without extra configuration.
