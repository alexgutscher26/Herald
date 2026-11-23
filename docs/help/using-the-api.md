---
title: Using the API
slug: using-the-api
collection: API
---

The REST API exposes the same tenant-scoped data as the dashboard. It is a
good fit for a script that submits requests, a backend that reads the
changelog, or a two-way sync you own. The OpenAPI document at
`/api/v1/openapi.json` is the reference; this page is the client behaviour
that a generated client will not explain.

## Authentication

Create a token under **Settings → API tokens**. The value is shown once.

```bash
curl -sS "https://herald.example.com/api/v1/boards" \
  -H "Authorization: Bearer $HERALD_TOKEN"
```

The token resolves to exactly one workspace. There is no workspace header or
path parameter, so a token cannot be pointed at another tenant. Scopes are
checked per request:

- `read` — workspace-wide reads, kept for existing integrations;
- `feedback:read`, `support:read` — narrower reads;
- `write` — mutations;
- `admin` — every scope.

A read-only token receives `403 forbidden` on a write. The REST API is
included on Professional and Founding Lifetime and is also behind the
deployment flag `FLAG_API`. A workspace on another plan answers `403
plan_required`, and a deployment with the flag off answers `503 api_disabled`.

## Pagination

List endpoints accept `limit` and `cursor`:

```bash
curl -sS "https://herald.example.com/api/v1/requests?limit=50" \
  -H "Authorization: Bearer $HERALD_TOKEN"
```

- `limit` is 1–100 and defaults to 25.
- The response carries `pagination.has_more` and `pagination.next_cursor`.
- Pass `next_cursor` back as `cursor` to continue. Stop when `has_more` is
  false.
- A cursor is opaque base64url JSON. It is not a secret and contains no tenant
  id, but it is bound to the sort it was issued for. Reusing it with a
  different `sort` returns `400 invalid_request`.
- Keep every filter identical between pages. A cursor resumes after the last
  row of the previous page; changing the filter mid-stream can skip or repeat
  rows.
- An invalid or truncated cursor is a `400`, not a silent restart at page one.
  That is deliberate: silently restarting loops a client over the same data.

Sort values that support cursors are listed per endpoint in the OpenAPI
document. A keyset cursor is stable under inserts, unlike an offset.

## Idempotency

Send `Idempotency-Key` on a write that you may retry. The key must be 8–255
characters of letters, digits, dot, colon, underscore or hyphen.

```bash
curl -sS -X POST "https://herald.example.com/api/v1/requests" \
  -H "Authorization: Bearer $HERALD_TOKEN" \
  -H "Idempotency-Key: submit-export-csv-1" \
  -H "Content-Type: application/json" \
  -d '{"board_id":"…","title":"Export reports as CSV"}'
```

The contract:

- The first non-5xx response is stored and replayed for the same method, path
  and body. The replay carries `idempotency-replayed: true`.
- Reusing the key with a different body or endpoint is `422
  idempotency_key_reused`, never a silent replay of the old response.
- A concurrent retry while the first request is still running is `409
  idempotency_in_progress` with `Retry-After: 1`.
- A 5xx is **not** stored; retry the same key and the work can run again.
- The key lives for the deployment's replay window (`API_IDEMPOTENCY_TTL_HOURS`,
  1–168 hours, 24 by default).

Generate one key per intent, not per HTTP attempt: `crypto.randomUUID()` is
enough. Reusing a key for a genuinely new request is a bug the API will catch
with a 422.

## Error recovery

Every error has the same shape:

```json
{
  "error": {
    "code": "validation_failed",
    "message": "…",
    "request_id": "…"
  }
}
```

Branch on `code`, not on `message`:

| Status | Code | What to do |
| --- | --- | --- |
| 400 | `invalid_request`, `invalid_json` | Fix the request. Do not retry unchanged. |
| 401 | `unauthorized` | Replace the token. |
| 403 | `forbidden`, `plan_required` | Add the scope or change the plan. |
| 404 | `not_found` | The record does not exist in this token's workspace. |
| 409 | `conflict`, `idempotency_in_progress` | Read `Retry-After`, then retry the same key. |
| 422 | `validation_failed`, `idempotency_key_reused` | Fix the fields, or use a new key for a new intent. |
| 429 | `rate_limited` | Wait for `Retry-After`, then retry. |
| 503 | `api_disabled`, `service_unavailable` | Back off. The deployment is not accepting work. |

A practical retry policy:

- Retry `429`, `409` and `5xx` with exponential backoff and jitter, capped at
  a few minutes. Keep the same `Idempotency-Key`.
- Do not retry other `4xx` responses; the same request will fail the same way.
- Treat a network timeout as unknown. Retry with the same idempotency key
  rather than assuming the write failed.
- Log `request_id` and quote it in support. It ties a dashboard error to the
  exact server request without exposing payloads.

## Rate limits

Limits are per token and durable in PostgreSQL, so scaling out does not
multiply the allowance. The window is 60 seconds.

| Plan | Requests per minute, per token |
| --- | --- |
| Professional | 600 |
| Founding Lifetime | 300 |

The API is not included on Free or Indie; a token from a workspace on those
plans answers `403 plan_required` before any work runs.

A `429` carries `Retry-After: 60`, `x-ratelimit-limit` and
`x-ratelimit-remaining: 0`. The bucket is consumed after the token resolves,
so an invalid token never burns the allowance. A plan change applies on the
next request; a downgrade clamps the existing counter.

Do not poll for changes. Use outbound webhooks for `request.created`,
`request.updated`, `comment.created`, `changelog.created`,
`conversation.updated` and `message.created`, and fall back to a scheduled
incremental read if a delivery is missed.

## A complete pagination loop

```bash
cursor=""
while :; do
  response=$(curl -sS \
    "https://herald.example.com/api/v1/requests?limit=100${cursor:+&cursor=$cursor}" \
    -H "Authorization: Bearer $HERALD_TOKEN")
  echo "$response" | jq -c '.data[] | {id, title, status}'
  has_more=$(echo "$response" | jq -r '.pagination.has_more')
  cursor=$(echo "$response" | jq -r '.pagination.next_cursor // empty')
  [ "$has_more" = "true" ] || break
done
```

If `has_more` is true but `next_cursor` is empty, stop and report it rather
than looping; that is a server bug, not a reason to restart from page one.

## Where the examples live

`docs/api-workflows.md` has worked create/triage/reply/changelog examples.
The OpenAPI document is generated from the same route definitions the server
uses, and the contract test walks every documented operation through the
router, so a documented endpoint that does not exist fails the test suite.
