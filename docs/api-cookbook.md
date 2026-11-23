# API cookbook

The workflows page ([api-workflows.md](api-workflows.md)) shows one request per
use case. This page is the client behaviour around those requests: paging a
whole collection, retrying without duplicating a write, recovering from each
error class and staying inside the per-token rate limit. The OpenAPI document
at `/api/v1/openapi.json` remains the field-level reference.

## Conventions

| Item | Value |
| --- | --- |
| Base path | `/api/v1` |
| Auth | `Authorization: Bearer hrl_…` |
| Version header | `x-api-version: 1` on every response |
| Response envelope | `{ "data": … }` or `{ "error": { "code", "message", "request_id" } }` |
| Caching | `Cache-Control: private, no-store` |
| Request id | `x-request-id` on every response; the same value is in an error body |

A token belongs to one workspace and is the only tenant selector. There is no
workspace id in a path, query or header, so a token cannot be aimed at
another tenant. A revoked, expired, foreign or malformed token all produce the
same `401` body.

## Pagination

Every list endpoint accepts `limit` and `cursor` and answers:

```json
{
  "data": [{ "id": "…" }],
  "pagination": { "limit": 50, "has_more": true, "next_cursor": "eyJ2Ijox…" }
}
```

- `limit`: 1–100, default 25. Values outside the range are a `400`, not a
  clamp.
- `cursor`: opaque base64url JSON `{ v, sort, value, id }`. It is not a secret
  and contains no tenant id, but it is bound to the sort that issued it.
- Reusing a cursor with another `sort` is `400` (`cursor belongs to a
  different sort`). Restart without it.
- A malformed or truncated cursor is a `400`. Do not treat it as page one.
- Keep every filter constant across pages. A keyset resumes after the last
  row; changing the filter can skip or repeat rows.
- `has_more: true` with `next_cursor: null` is a server defect. Stop and
  report it rather than looping.

Cursor listings are stable under inserts because they seek from the last
row's sort value and id; they are not offset pages. There is no total count
to fetch, which is also why a client should not build "page N of M" UI from
this API.

```ts
type Page<T> = {
  data: T[];
  pagination: { limit: number; has_more: boolean; next_cursor: string | null };
};

async function* paginate<T>(
  path: string,
  token: string,
  params: Record<string, string> = {},
): AsyncGenerator<T> {
  let cursor: string | null = null;

  for (let guard = 0; guard < 10_000; guard += 1) {
    const query = new URLSearchParams({ ...params, limit: "100" });
    if (cursor) query.set("cursor", cursor);

    const response = await fetch(`${BASE}${path}?${query}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw await apiError(response);

    const page = (await response.json()) as Page<T>;
    yield* page.data;

    if (!page.pagination.has_more) return;
    if (!page.pagination.next_cursor) {
      throw new Error("has_more without next_cursor");
    }
    cursor = page.pagination.next_cursor;
  }

  throw new Error("pagination did not terminate");
}
```

## Idempotency

Send `Idempotency-Key` on creates and other retryable writes. The key is
8–255 characters of letters, digits, dot, colon, underscore or hyphen.

| Situation | Result |
| --- | --- |
| First request | Work runs; the non-5xx response is stored |
| Same key, same method/path/body | Stored response replayed with `idempotency-replayed: true` |
| Same key, different body or endpoint | `422 idempotency_key_reused` |
| Same key while the first is still running | `409 idempotency_in_progress`, `Retry-After: 1` |
| First attempt answered 5xx | Nothing stored; retry the same key |
| TTL elapsed (default 24 h, `API_IDEMPOTENCY_TTL_HOURS`) | The key may be claimed again |

The key is claimed with a unique insert before the handler runs, so two
simultaneous requests cannot both execute the write. A concurrent loser gets
the `409`, not a second mutation.

Generate one key per intent:

```ts
const key = crypto.randomUUID(); // once, outside the retry loop
await createRequest(body, { idempotencyKey: key });
```

Do not derive the key from the body alone. Two legitimate submissions with
identical text are still two intentions, and a body hash would silently drop
the second.

A replay returns the original status and body. If the first response was a
`4xx`, the replay repeats that `4xx`; fix the request and use a new key rather
than retrying the old one.

## Error recovery

Branch on `error.code`, not on prose. The codes are a closed set in
`src/features/api-v1/http.ts`.

| Status | Code | Retry? | Action |
| --- | --- | --- | --- |
| 400 | `invalid_request` | No | Fix query, cursor, header or JSON. |
| 400 | `invalid_json` | No | Send valid JSON with `Content-Type: application/json`. |
| 401 | `unauthorized` | No | Replace the token; do not retry with the same value. |
| 403 | `forbidden` | No | Add the missing scope (`feedback:read`, `support:read`, `write`, `admin`). |
| 403 | `plan_required` | No | The workspace plan does not include the API. |
| 404 | `not_found` | No | The row is absent in this token's workspace. A foreign id is indistinguishable from a missing one. |
| 409 | `conflict` | Sometimes | The resource changed state; re-read it. |
| 409 | `idempotency_in_progress` | Yes | Wait `Retry-After`, retry with the same key. |
| 422 | `validation_failed` | No | Fix the fields listed in the message; a new body needs a new key. |
| 422 | `idempotency_key_reused` | No | Use a new key for a new intent. |
| 429 | `rate_limited` | Yes | Wait `Retry-After`, then retry. |
| 503 | `api_disabled` | No | The deployment flag is off; an operator must enable it. |
| 503 | `service_unavailable` | Yes | Capacity or connection failure; back off. |
| 500 | `internal_error` | Yes | Back off with the same idempotency key and report `request_id`. |

A timeout is an unknown outcome, not a failure. The write may have committed.
Retry with the same idempotency key; do not inspect by title or re-POST with a
fresh key.

```ts
async function requestWithRetry<T>(
  url: string,
  init: RequestInit,
  idempotencyKey?: string,
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${process.env.HERALD_TOKEN}`);
  if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(url, { ...init, headers });
    if (response.ok) return response.json() as Promise<T>;

    const body = await response.json().catch(() => null);
    const code = body?.error?.code as string | undefined;
    const retryable =
      response.status === 429 ||
      response.status === 409 ||
      response.status >= 500;

    if (!retryable || attempt === 5) throw new ApiError(response.status, body);

    const retryAfter = Number(response.headers.get("retry-after") ?? "0");
    const backoff = Math.min(2 ** attempt * 500, 30_000);
    const jitter = Math.random() * 250;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(retryAfter * 1_000, backoff) + jitter),
    );
  }

  throw new Error("unreachable");
}
```

Do not retry a `401` or a `403` in a loop; that is how a bad deployment turns
a permissions bug into an outage and burns the rate limit.

## Rate limits

Limits are per token, counted over a fixed 60-second window and stored in
PostgreSQL, so every app instance shares the bucket.

| Plan | Requests per minute, per token |
| --- | --- |
| Professional | 600 |
| Founding Lifetime | 300 |

The REST API is included on Professional and Founding Lifetime. Free and Indie
workspaces answer `403 plan_required` before a request reaches the limiter; the
`starter` catalogue value exists, but the feature gate is what applies. A `429`
carries:

```http
Retry-After: 60
x-ratelimit-limit: 600
x-ratelimit-remaining: 0
```

The bucket is consumed after the token resolves, so junk bearer tokens never
reach the limiter. An upgrade applies on the next request; a downgrade clamps
the existing counter without resetting it.

Practical guidance:

- Batch reads and rely on `limit=100`.
- Use webhooks instead of polling. If a webhook is missed, reconcile with an
  incremental cursor read rather than a full scan every minute.
- A single-token integration that fans out to many workers should queue
  locally and pace at the plan's rate. Multiple tokens do not multiply a
  plan's allowance in spirit; they are separate buckets, and the plan is the
  contract.
- Do not use the rate limit as a clock. It is an allowance, not a schedule.

## Reconciliation recipe

Webhooks are notifications, not a ledger. A delivery can be missed while your
endpoint is down, and a retry can arrive twice.

1. Store the event id from the webhook envelope and ignore a duplicate.
2. On a schedule, read the collection with `sort=newest` (or the endpoint's
   incremental sort) and `limit=100` until you reach a row you already have.
3. Compare by resource id and `updated_at`, not by list position.
4. Never delete local data because a full scan did not include it; fetch the
   id directly and treat `404` as the authoritative removal.

`docs/api-events.md` lists the events and their payloads; `docs/api-versioning.md`
covers the 12-month deprecation policy and the `Deprecation`/`Sunset` headers.

## Checking a client against the spec

```bash
curl -sS "$HERALD_URL/api/v1/openapi.json" | jq '.paths | keys'
curl -sS "$HERALD_URL/api/v1/openapi.json" \
  | jq '.paths["/requests"].get.parameters[] | {name, in}'
```

`tests/integration/openapi-contract.test.ts` walks every documented operation
through the router, so the document and the routes cannot drift silently.
