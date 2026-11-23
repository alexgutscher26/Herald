# API versioning and deprecation

The REST API is versioned in the URL (`/api/v1`) and every response also carries
`x-api-version: 1`. MCP calls through the same router and reports the same
version header. The OpenAPI document is served at `/api/v1/openapi.json` and is
generated from the route manifest in `src/features/api-v1/routes.ts`.

## Compatibility promise for v1

Within `v1`, these changes are additive and do not require a new version:

- a new endpoint, optional query parameter or optional request field;
- a new response field;
- a new enum value that a client should treat as unknown-but-valid;
- a new error code, while existing codes keep their meaning;
- a new scope, while `read`, `write` and existing resource scopes keep theirs;
- a new MCP tool or a new optional tool argument.

These are breaking and require `/api/v2`:

- removing or renaming a field, endpoint or parameter;
- making an optional field required, or narrowing an accepted type;
- changing an existing error code or HTTP status for the same condition;
- changing pagination or cursor semantics;
- changing tenant, scope or authentication semantics.

## Deprecation header plan

When an operation or a whole version is scheduled for retirement, responses
carry all three headers:

```http
Deprecation: Tue, 01 Jun 2027 00:00:00 GMT
Sunset: Tue, 01 Jun 2027 00:00:00 GMT
Link: <https://your-herald.example/api/v2/boards>; rel="successor-version"
```

- **Minimum notice:** 12 months for a whole version, 6 months for a single
  operation. Security fixes may shorten this, but the reason is stated in the
  changelog and the replacement is available before the sunset date.
- **`Deprecation`** is the date the operation became deprecated, not the date it
  stops working. `Sunset` is the last day it is guaranteed to work.
- **`Link`** points at the replacement. For a retired version, the header stays
  on the old base URL and documented clients are expected to migrate.
- The OpenAPI operation is marked `deprecated: true` in the same change.
- A deprecation is announced in `README.md` and in the service status notes. It
  is not silently removed from the OpenAPI document while still served.
- The Data and MCP surfaces follow the same dates. A `v1` tool keeps working
  until the REST operation it maps to is sunset.

`apiDeprecationHeaders()` in `src/features/api-v1/http.ts` builds the three
headers from a `deprecatedAt` date, a `sunsetAt` date and the replacement URL so
they cannot drift into a locale-specific format.

## Rate-limit changes

Plan allowances are catalogue data, not part of the wire contract. Raising a
limit is additive. Lowering a limit is announced at least 30 days before it
takes effect; the response headers `x-ratelimit-limit` and
`x-ratelimit-remaining` always reflect the current value.
