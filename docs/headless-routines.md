# Headless routines

Seven prompts for running Herald from an agent over MCP (`POST /api/mcp`) or the
REST API. Each one is deliberately read-first: an agent may collect evidence
and draft, but a human confirms anything that reaches a customer.

Rules that apply to every routine:

- Read before writing. Use `list_*` and `get_*` tools to establish the current
  state; never guess an id.
- Use `add_conversation_note` for working notes. `reply_to_conversation` sends
  a customer email and needs explicit human approval.
- Changelog tools create drafts only. Never claim something shipped without a
  published changelog entry.
- Pass `idempotency_key` on every write so a retry cannot duplicate content.
- Report only what the tools returned. If a call fails, show the error code and
  stop rather than retrying blindly.

## 1. Inbox triage

> List conversations in `inbox_state=queue` (limit 25). For each, read the
> timeline and classify it as bug report, feature request, billing/account,
> or other. Add an internal note with the classification and a one-line
> summary. Set status `open` only when a teammate should reply; leave spam in
> the queue and flag it in your summary. Do not send any customer reply.

Tools: `list_conversations`, `get_conversation`, `list_messages`,
`add_conversation_note`, `update_conversation`.

## 2. Bug report capture

> Search requests with `q=<symptom>` and `status=open`. If a matching request
> exists, add an internal note with the new report and the affected customer
> (use `author`/`customer.external_id`), and vote for it on the customer's
> behalf only if they asked. Otherwise create one request with
> `category=bug`, the exact reproduction steps, and the customer as author.
> Never merge or close anything.

Tools: `list_requests`, `get_request`, `create_request`, `create_comment`,
`vote_request`.

## 3. Feature capture

> Read the board list and choose the board whose description best matches the
> request. Check for duplicates with `list_requests?q=…` before creating
> anything. Create at most one request per conversation, with the customer's
> own words in the body and a short title. If the board moderates posts, tell
> the user the request is awaiting review instead of implying it is public.

Tools: `list_boards`, `list_requests`, `create_request`.

## 4. Changelog draft

> Gather requests with `status=shipped` updated in the last 14 days. Group them
> into one or two themes, then create a changelog draft for the product with a
> factual summary and links to those request ids. Use `category=improvement`
> unless every item is a new capability. Do not publish; report the draft id
> and what still needs a human edit.

Tools: `list_requests`, `list_changelogs`, `create_changelog`, `get_changelog`.

## 5. Weekly demand

> For the last 7 days, list new requests and the current backlog by status.
> Summarise the top themes by vote count and tag, note which boards grew, and
> call out requests with no team response. Do not change statuses; produce a
> report a human can paste into a planning doc.

Tools: `list_requests`, `list_tags`, `list_boards`, `list_comments`.

## 6. Ship replies

> For each request in a supplied list that is now `shipped`, check whether a
> public comment already announces it. Draft a short reply that links the
> changelog entry, add it as an internal note for review, and stop. Only after
> a human approves should the same text be posted with `create_comment`
> (`internal=false`), one call per request with an idempotency key.

Tools: `get_request`, `list_comments`, `list_changelogs`, `create_comment`.

## 7. Request brief to PRD draft

> Read the request and then `get_request_brief`. Treat the brief as the source
> of truth: never invent evidence, voters or quotes that it does not contain.
> Draft a PRD with problem, evidence, demand, scope, out of scope, open
> questions and acceptance criteria. Ask the human to resolve every open
> question that would change the scope. Do not create the ticket and do not
> change the request's status until they approve the draft. If you need more
> context, read the public comments with `list_comments`; internal notes are
> for you, never for a customer-visible document.

Tools: `get_request`, `get_request_brief`, `list_comments`, `list_changelogs`.
