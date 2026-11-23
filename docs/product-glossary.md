# Product glossary

**Decided:** 2026-11-21

One object, one noun. These terms apply to dashboard copy, public pages, email,
API descriptions and marketing strings.

| Term | Meaning | Never use for it |
| --- | --- | --- |
| **request** | One item a customer submits, votes on or comments on. | post, ticket, idea, item |
| **Feedback** | The dashboard section and the collection of requests. Capitalised as a section name, mass noun in prose. | Feedback as a countable noun ("a feedback") |
| **Inbox** | The dashboard section for customer conversations. | using "inbox" for the feedback request list |
| **conversation** | One customer thread inside the Inbox. | ticket, case |
| **comment** | A public or internal reply on a request or conversation. | post |
| **release** | One changelog entry, draft, scheduled or published. | changelog post, update (as the object) |
| **changelog** | The public list of published releases. | updates page |
| **workspace** | The billing, membership and audit boundary. One workspace contains products and is the tenant the API token belongs to. | account, organisation |
| **product** | One thing the workspace ships. It owns its boards, roadmap, changelog, help center and widget identity. | project, brand |
| **board** | A collection of requests inside a product, public or private. Creating a product creates its first board. | list, forum, category |
| **insight** | One internal evidence row attached to a request: a quoted sentence, call, email or chat message with its source and date. Never public. | comment, note, feedback item |
| **experience** | A widget banner or product tour with audience rules, a schedule and a frequency cap. Surveys are their own object, not an experience. | survey, popup, announcement |
| **outbound** | A scheduled message to customers, in-app or by email, chosen by audience or saved segment. Not a changelog entry and not a win-back campaign. | campaign, broadcast, newsletter |
| **campaign** | A win-back campaign: an approval-gated send to an eligible cancelled-customer audience. Announcing a release never starts one. | outbound message, sequence, drip |
| **run** | One recorded execution of a background job (`job_runs`). Qualified uses keep their qualifier: report run, eval run, agent-action run. | job, task |

## Rules

- The countable object is a **request**: "3 requests", "New request",
  "Submit a request". This is also the public API's resource name.
- **Feedback** names the area, not the object. "Feedback" in a sentence is fine;
  "a feedback" and "feedbacks" are not.
- **Post** is not a product noun. Use **submit** for the action, **request** for
  the object, **comment** for a reply and **release** / **changelog entry** for
  publishing.
- The **Inbox** holds conversations. The feedback request list is not an inbox.
- A **campaign** is not a release announcement. A release announcement is a
  changelog entry with the subscriber-email channel; a campaign has its own
  audience, approval and send state.
- An **insight** is evidence, not demand. Votes and requesters carry demand; an
  insight preserves what a customer said and when.
- The **widget** hosts panels, not pages. It is the launcher and the embed, not
  a synonym for the public portal.
- "Run" without a qualifier means a background-job execution. Do not use it
  for a campaign send or a customer's trial.
- Keep API field names stable (`feedback_posts` and `post_id` remain the storage
  and compatibility names); only user-facing copy follows this glossary.

## Audit anchors

- Public catalogue: `src/features/public/i18n/messages/en.ts` and `es.ts`.
- Dashboard: `src/features/feedback/feedback-view.tsx`,
  `src/features/conversations/*`, `src/features/roadmap/*`,
  `src/features/releases/*`.
- API/MCP descriptions: `src/features/mcp/catalog.ts`,
  `src/features/api-v1/openapi.ts`.
- Marketing: `src/features/marketing/comparisons.ts`,
  `src/features/marketing/landing-page.tsx`.
