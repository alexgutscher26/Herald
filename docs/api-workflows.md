# API workflows

Every request below is documented with a worked example in the OpenAPI
document at `/api/v1/openapi.json` (`requestBody.content["application/json"].examples.workflow`).
The examples are part of the spec, so a generated client or docs site shows the
same values as this page.

Set these first:

```bash
export HERALD_URL="https://your-herald.example"
export HERALD_TOKEN="hrld_..."   # shown once when the token is created
export BOARD_ID="..."            # GET /api/v1/boards
export PRODUCT_ID="..."          # GET /api/v1/boards -> product
```

All writes accept `Idempotency-Key`. Reuse the same key only when retrying the
same body; a different body returns `422`.

## 1. Submit a request for a customer

```bash
curl -sS -X POST "$HERALD_URL/api/v1/requests" \
  -H "Authorization: Bearer $HERALD_TOKEN" \
  -H "Idempotency-Key: submit-export-csv-1" \
  -H "Content-Type: application/json" \
  -d '{
    "board_id": "'"$BOARD_ID"'",
    "title": "Export reports as CSV",
    "body": "We need a CSV export for the monthly finance review.",
    "category": "feature_request",
    "customer": { "email": "ada@example.com", "name": "Ada Lovelace" }
  }'
```

The response includes `visibility`. `awaiting_review` means the board's
moderation policy held it back; it is not public yet.

## 2. Triage status and tags

```bash
curl -sS -X PATCH "$HERALD_URL/api/v1/requests/$REQUEST_ID" \
  -H "Authorization: Bearer $HERALD_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "status": "planned", "tag_ids": ["'"$TAG_ID"'"] }'
```

A status change runs the same customer-notification pipeline as the dashboard.

## 3. Reply, or leave an internal note

```bash
curl -sS -X POST "$HERALD_URL/api/v1/requests/$REQUEST_ID/comments" \
  -H "Authorization: Bearer $HERALD_TOKEN" \
  -H "Idempotency-Key: reply-export-csv-1" \
  -H "Content-Type: application/json" \
  -d '{ "body": "This is now planned for the next release." }'
```

Set `"internal": true` to store a team note. Internal notes never appear on a
customer-facing surface.

## 4. Draft a changelog entry

```bash
curl -sS -X POST "$HERALD_URL/api/v1/changelogs" \
  -H "Authorization: Bearer $HERALD_TOKEN" \
  -H "Idempotency-Key: changelog-csv-1" \
  -H "Content-Type: application/json" \
  -d '{
    "product_id": "'"$PRODUCT_ID"'",
    "title": "CSV exports are here",
    "slug": "csv-exports",
    "summary": "Download any report as CSV from the reports page.",
    "body": "Open Reports, choose a date range, and select Export CSV.",
    "category": "feature",
    "channels": { "publicChangelog": true, "subscriberEmail": true }
  }'
```

This always creates a draft. Publishing remains an explicit dashboard action.

## 5. Reply to a support conversation

```bash
curl -sS -X POST "$HERALD_URL/api/v1/conversations/$CONVERSATION_ID/messages" \
  -H "Authorization: Bearer $HERALD_TOKEN" \
  -H "Idempotency-Key: support-reply-1" \
  -H "Content-Type: application/json" \
  -d '{ "body": "I refreshed the export; it should arrive in a minute." }'
```

The reply and the customer email are queued in the same transaction. Use
`/notes` instead of `/messages` for an internal note, which is never emailed.

## 6. Attach a customer to a company

```bash
curl -sS -X POST "$HERALD_URL/api/v1/companies/$COMPANY_ID/customers" \
  -H "Authorization: Bearer $HERALD_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "customer": { "email": "ada@example.com" }, "role": "admin" }'
```

## Checking the examples in the spec

```bash
curl -sS "$HERALD_URL/api/v1/openapi.json" \
  | jq '.paths["/requests"].post.requestBody.content["application/json"].examples'
```

## Webhooks for these workflows

API writes also enqueue signed webhooks for the events listed in the README:
`request.created`, `request.updated`, `comment.created`, `changelog.created`,
`conversation.updated` and `message.created`. A webhook is a notification, not
a transaction: the API response does not wait for it.
