# Herald — UserJot feature parity plan

**Status:** Draft for review  
**Research date:** 2026-10-24  
**Execution companion:** [HERALD_PLAN.md](HERALD_PLAN.md) — Herald's baseline audit, workstreams, milestone gates, improvement backlog and first ten working days. This file is the external parity reference; the companion is the build sequence.  
**Reference product:** [UserJot](https://userjot.com) — customer feedback, public roadmap, changelog, in-app widget, live-chat inbox, AI operator, REST API and MCP.  
**Tooling:** REA 6.7.0 is installed globally (`rea --version`), its bundled skill is aligned, and the installed client registrations are present. `rea doctor` still reports missing native analysis engines (Hopper/Ghidra/IDA/JADX) and drift for a few optional clients; browser/website analysis only needs a Chrome-family browser, which is installed. No reinstall was required.

---

## Start here

**This file is the “what.”** It inventories what UserJot has, what Herald has today, and the target architecture. It is not the build order.

**The short version:** UserJot combines a feedback board, public roadmap, changelog, in-app widget, live-chat inbox, AI operator, REST API and MCP. Herald has the internal changelog/feedback half. The inventory is **147 rows, 26 of them P0**.

**The build order is [HERALD_PLAN.md](HERALD_PLAN.md).** That file has the baseline audit, workstreams, milestone gates, improvement backlog and a day-by-day start.

**If you have five minutes:**

- §4.1 — the public feedback loop, the core of the product.
- §5 — the five structural gaps that block every later feature.
- §7 — the eight parity phases and their exit criteria.

---

## 1. Goal

Turn Herald from a database-backed changelog and internal feedback tool into a complete customer-feedback loop:

> A customer submits or votes on feedback → the team triages and plans it → the public roadmap updates from its status → shipping it drafts a changelog entry → everyone who asked is notified → the same customer can ask for help in chat and get an answer from the product's own documentation.

Herald already owns the internal half of that loop (releases, feedback, scheduling, permissions). This plan adds the customer-facing half and the automation that makes the loop self-sustaining, without regressing Herald's rules:

- **No mock data, no demo mode, no seeded fixtures.** Every screen reads PostgreSQL and every mutation is an authorized server action or route handler.
- **Deny by default.** Public endpoints get their own explicit authorization model; hiding a button is never authorization.
- **Tenant isolation is non-negotiable.** Public records are resolved through workspace → product → board, never from a client-supplied product id.
- **Herald keeps its win-back campaigns.** UserJot does not have them; they are a differentiator, not a feature to delete while chasing parity.

Parity is not one release. The plan is split into eight phases with explicit exit criteria. The core public loop (Phases 0–2) is the first credible milestone; the widget, inbox and AI operator follow; API, integrations, billing and hardening close the gap.

---

## 2. Executive summary

| Milestone | Scope | Approx. effort (1 senior full-stack + part-time design/QA) |
| --- | --- | --- |
| **M1 — Public feedback** | Customer identity, boards, public board/request pages, votes, comments, follows, moderation, merge, import/export | 4–5 weeks |
| **M2 — Roadmap + changelog loop** | Internal kanban, public roadmap, public updates, linked requests, subscriber notifications, AI drafting | 2–3 weeks |
| **M3 — Widget v3** | Loader/SDK, launcher, panels, identity/JWT, deep links, inline embed, events, unread/presence | 2–3 weeks |
| **M4 — Conversations** | Live chat, shared inbox, email forwarding, replies/notes, snooze/reminders, operators, presence | 3 weeks |
| **M5 — Juno** | Knowledge base, retrieval answers, handoff, auto-resolve, feedback cards, AI metrics, guardrails | 3 weeks |
| **M6 — Platform** | REST API, tokens, OpenAPI, MCP server, webhooks, Slack/Discord/Linear | 3 weeks |
| **M7 — Monetization + hardening** | Stripe plans/trials, plan gates, analytics, settings completion, security/privacy hardening | 2–3 weeks |

**Total:** roughly **19–22 weeks** for one senior engineer, or **10–12 weeks** with two engineers plus design/QA. The estimate assumes the existing release/feedback code is reused, not rewritten.

The single most important sequencing decision: **do not start with the widget or AI.** Both depend on a stable public identity, board and conversation model. Phase 0 exists to prevent a second, conflicting data model from growing beside the current one.

---

## 3. Where Herald is today

| Area | Current state | What that means for parity |
| --- | --- | --- |
| Auth, onboarding, tenancy | **Done** — Better Auth, workspace membership, product resolution, deny-by-default permissions | Reuse for team members; add a separate customer principal. |
| Overview | **Done** — live metrics, recent releases/feedback, attention queue, pipeline, activity | Extend with board/conversation/inbox metrics later. |
| Releases / changelog | **Done internally** — draft, schedule, publish, archive, cover, channels, linked feedback, linked cancellation reasons, markdown editor, preview | Add tags, multiple authors, YouTube, public updates pages, subscriber email, AI drafts, widget surfacing. |
| Feedback | **Done internally** — inbox, detail, statuses, votes, comments, internal notes, roadmap/release links, duplicate merge | Authors/voters are currently workspace users, not customers; there are no boards, public pages, guest sessions, moderation, follows or notifications. |
| Roadmap | **Not implemented** — feedback can link to existing rows only | Replace with a status-driven kanban + public roadmap. |
| Widget | **Not implemented** | Entirely new public SDK and embed surface. |
| Subscribers | **Table + count only** — no management UI, no sending | Add subscriber/follower management and a real email delivery worker. |
| Win-back | **Implemented** — cancellation import, eligible audience, separate approval, send, suppression, attribution and campaign detail | Keep as a differentiator; UserJot parity does not cover it. |
| Conversations / AI | **Missing** | New domain: chat, email, inbox, operators, Juno, knowledge base. |
| Analytics | **Not implemented** | Add event ingestion and rollups; UserJot parity is lighter than a full product-analytics suite. |
| Integrations | **Not implemented** | Slack, Discord, Linear, webhooks. |
| Settings | **Not implemented** | Branding, domain, localization, privacy, team, billing, API tokens. |
| Public surfaces | **Missing** | No public board, request, roadmap, updates, login or embed pages. |
| API / MCP | **Missing** | REST API, tokens, OpenAPI, remote MCP server. |
| Email delivery | **Rows only** — `notification_deliveries` stays `pending` | Add provider, outbox worker, templates, inbound parsing and suppression. |

### What is already strong and should be preserved

- Transactional publishing with a status-guarded update, per-release transactions and idempotent subscriber delivery rows (`src/features/releases/publisher.ts`).
- Composite foreign keys that make cross-product links impossible (`release_feedback_links`); the roadmap is now a projection of feedback status.
- The cron endpoint's closed-by-default bearer auth and constant-time comparison.
- The release editor's explicit publish-vs-schedule flow, timezone handling and preview.
- The overview's real database-derived metrics and empty states (no fabricated values).

---

## 4. UserJot feature inventory

This is the complete capability list gathered from UserJot's public product pages, documentation (`/docs`, `/docs/api`), help center (`/support`), feature index (`/llms.txt`), full documentation bundle (`/llms-full.txt`), changelog (`feedback.userjot.com/updates`), pricing page (`/pricing`), headless page (`/headless`), MCP page (`/mcp`) and Slack page (`/slack`).

Legend: **Done** = Herald already has it; **Partial** = schema or internal-only version exists; **Missing** = no implementation; **P0** = launch-critical; **P1** = paid parity; **P2** = polish or retention.

**Area checklist.** Mark an area only when all its P0 rows are Done and the matching gate in [HERALD_PLAN.md](HERALD_PLAN.md) passes.

- [ ] **4.1 Feedback boards and requests** — 28 rows, 11 P0, 1 already done
- [ ] **4.2 Roadmap** — 8 rows, 4 P0
- [ ] **4.3 Changelog / updates** — 12 rows, 3 P0, 1 already done
- [ ] **4.4 In-app widget and identity** — 17 rows, 6 P0
- [ ] **4.5 Conversations** — 24 rows, 0 P0
- [ ] **4.6 Juno** — 18 rows, 0 P0
- [ ] **4.7 REST API, MCP and headless automation** — 13 rows, 0 P0
- [ ] **4.8 Integrations** — 6 rows, 0 P0
- [ ] **4.9 Workspace, plans and administration** — 14 rows, 1 P0
- [ ] **4.10 Analytics and notifications** — 7 rows, 1 P0

**Total: 147 capability rows, 26 P0, 2 Done.** The 26 P0 rows are the launch-critical slice. Everything else is P1 (paid parity) or P2 (polish and retention). Two rows carry qualified P1 labels (`P1 (build v3 only)` and a scoping note); they are treated as P1, not as a separate priority. Use the detailed tables below to see each individual row and what Herald has today.

### 4.1 Feedback boards and requests

| Capability | UserJot behavior | Herald today | Priority |
| --- | --- | --- | --- |
| Public feedback portal | One public link per workspace; board, roadmap and changelog are separate routes on the same branded site | Missing | P0 |
| Multiple boards | Several boards per workspace; **2** on Free, **5** on Starter, unlimited on Professional | Missing (feedback is product-wide) | P0 |
| Board visibility | Public or private; change immediately from settings | Missing | P0 |
| Request lifecycle | **Pending → Reviewing → Planned → In Progress → Completed → Closed**; status drives the roadmap | Partial (different enum: `open`, `under_review`, `planned`, `in_progress`, `shipped`, `declined`, `closed`) | P0 |
| Voting | One vote per customer; guests can vote when enabled; merged votes count once per person | Partial (votes only from authenticated workspace users) | P0 |
| Comments and discussion | Public comments, team replies, reactions/hearts, threaded replies | Partial (public/internal comments exist, but only for workspace users) | P0 |
| Follow / subscribe | Follow a post; author, voters and commenters are followed automatically; email on status change | Missing | P0 |
| Similar requests | Suggest matching requests while the customer types; catch duplicates before submission | Missing (merge exists only after the fact) | P1 |
| AI submission assist | AI drafts a title, files each post and suggests matching requests as the customer types | Missing | P2 |
| Merge duplicates | Merge into a canonical request; move comments and distinct reactions; keep the duplicate as a linked record; unmerge restores it; subscriptions are not moved | Partial (basic merge exists; no unmerge/reaction migration) | P0 |
| Auto-tagging | AI tags incoming feedback; tags are searchable and filterable | Missing | P2 |
| Private boards | Only the author and workspace owners/admins see submissions; authors see their own posts; guests see only their own | Missing | P1 |
| Hide one request | "Hidden from board" keeps an individual request between author and team on a public board | Missing | P1 |
| Guest feedback | Post, vote and comment without an account; guest session recognizes the author; paid plans | Missing | P0 |
| Moderation | Approval for submissions and comments; spam/abuse detection; sensitive-information detection in text and JPEG/PNG/WebP images; review queue with Keep/Delete/Publish/Keep hidden/Approve; retry failed checks | Missing | P0 |
| Ban users | Ban a customer from posting feedback | Missing | P1 |
| Internal notes | Team-only notes on public requests | **Done** (internal comments) | Done |
| Search and filters | Search title/body, board, status, tag, author; advanced search on Professional | Partial (internal inbox search/filter) | P1 |
| Sorting | **Top** (votes), **Trending** (recent interest), **Newest** | Missing | P1 |
| Weekly digest | Optional weekly email summary of public feedback activity | Missing | P2 |
| Import | Canny, ProductRoad, Nolt, CSV (up to ~10,000 rows; column mapping for status/board/author/votes/dates) | Missing | P1 |
| Export | Export all data; CSV exports identify merged requests | Missing | P1 |
| Public identity masking | Hide regular users' names/avatars on public pages and notifications; owners/admins remain visible; Professional | Missing | P2 |
| Localization | Public pages auto-detect browser language or lock to one locale; signed-in users can switch; widget locale option | Missing | P2 |
| Custom domain | `yourcompany.userjot.com` on every plan; custom domain on Starter+ | Missing | P1 |
| Branding | Logo, workspace name, primary color, light/dark/auto theme, hide "Powered by" on Professional | Missing | P1 |
| Public request page | Own URL, votes, status, comments, follow, linked updates, SEO metadata | Missing | P0 |
| Independent visibility | Roadmap and changelog can each be made private while feedback stays public | Missing | P1 |

### 4.2 Roadmap

| Capability | UserJot behavior | Herald today | Priority |
| --- | --- | --- | --- |
| Internal roadmap | Dashboard kanban with every status from Pending through Closed; drag a card to change status; always available even when public roadmap is off | Missing | P0 |
| Public roadmap | Three columns: **Planned**, **In Progress**, **Done**; request cards show votes and status | Missing | P0 |
| Status-driven sync | No manual roadmap items; moving a request updates the public roadmap automatically | Missing | P0 |
| Visibility toggle | Public roadmap on/off in Feedback settings | Missing | P1 |
| Status-change notifications | Author, voters, commenters and followers get email; Slack/Discord can be notified | Missing | P0 |
| "For you" marker | In the widget, shipped requests the customer voted for are marked "for you" | Missing | P2 |
| Workflow prompts | Action bar suggests the next decision (accept/merge/close), stale-work reminders for Planned/In Progress, low-traction reminders for Reviewing | Missing | P2 |
| API/MCP status updates | Move a request's status through the API or an agent | Missing | P1 |

### 4.3 Changelog / updates

| Capability | UserJot behavior | Herald today | Priority |
| --- | --- | --- | --- |
| Public updates page | Branded `/updates` page; each post has its own URL | Missing | P0 |
| Draft / published / scheduled | New entries are drafts; a future publish date schedules them; current date publishes immediately | **Done internally** (draft/scheduled/published/archived) | Done |
| Editor | Title, slug, rich content, cover image, authors, changelog tags, images/GIFs, YouTube embeds | Partial (title, slug, markdown, cover, category, version; no tags/authors/YouTube) | P1 |
| Autosave | Saves every few seconds while typing | Missing | P1 |
| Link completed requests | Completed requests can seed a draft; linked requests appear under "Built from your feedback" and are filtered per viewer's visibility | Partial (release↔feedback links exist; no public section and no per-viewer filtering) | P0 |
| AI draft | Juno/AI drafts a post from completed requests | Missing | P1 |
| Subscriber notifications | Notify authors, voters and followers when a request ships; notify changelog subscribers | Partial (delivery rows are created; nothing is sent) | P0 |
| Widget surfacing | New posts appear in the widget's Updates panel with an unread indicator and full content | Missing | P1 |
| Visibility toggle | Changelog can be private independently of feedback | Missing | P1 |
| Multiple authors | Attribute a post to one or more team members | Missing (single `authorId`) | P2 |
| API create/update | Create/update changelog posts, including cover images; posts stay drafts unless explicitly published | Missing | P1 |
| Tags | Changelog tags for filtering/grouping | Missing | P2 |

### 4.4 In-app widget and identity

| Capability | UserJot behavior | Herald today | Priority |
| --- | --- | --- | --- |
| JS install | One snippet (or single script tag with `data-project`); async module; calls queue until ready; CSP-safe variant | Missing | P0 |
| Launcher | Floating button, left/right, auto/light/dark theme, custom trigger, locale | Missing | P0 |
| Panels | Home, Feedback, Roadmap, Updates, Messages (Conversations), Notifications | Missing | P0 |
| In-widget feedback | Browse/search/filter, vote, comment, follow, submit without leaving the app | Missing | P0 |
| Rich submission | Similar requests while typing; screenshot capture + annotation; image attachments | Missing | P1 |
| Deep links | `?openFeedback`; `uj.redirect(...)`; open a specific submission or update; compose a message | Missing | P1 |
| Identify users | `id`, email, first/last name, avatar, traits, companies | Missing | P0 |
| Signed identity | Server-signed JWT (HS256, `sub`/`iss`/`aud`/`iat`/`exp`, max 1 hour); invalid tokens fail closed; optional "require signed tokens" | Missing | P0 |
| Automatic login | Carry identity from the product into public board/roadmap/changelog pages | Missing | P1 |
| SSO | JWT single sign-on for public pages | Missing | P1 |
| Custom launcher | Hide default button; drive from own UI; unread badge and presence dot via events/state | Missing | P2 |
| Inline embed | Iframe the full public experience into a container; URL sync; navigate/destroy | Missing | P2 |
| Unread / whispers | Launcher shows unread changelog/reply counts; small notification toasts | Missing | P2 |
| Presence | Green online dot when any operator is available; never says "offline" | Missing | P2 |
| SDK events/state | `ready`, `open`, `close`, `identify`, `unread`, `presence`, `statechange`, `error`; `getState()` | Missing | P2 |
| iOS SDK | Swift SDK for native apps (install, auth, common flows) | Missing | P2 |
| Versioning | v2 and v3 widget APIs; v3 is the current beta surface | Missing | P1 (build v3 only) |

### 4.5 Conversations (live chat + shared inbox)

| Capability | UserJot behavior | Herald today | Priority |
| --- | --- | --- | --- |
| Live chat in widget | Messages page; identified users skip contact capture; anonymous guests get browser-scoped conversations | Missing | P1 |
| Shared inbox | Dashboard Conversations section with **Queue**, **Open**, **All**; every owner/admin can reply; Queue is oldest-waiting first with online visitors on top | Missing | P1 |
| Inbox filters | Unread, Snoozed, Resolved, Spam, Archived; search (3–200 chars, up to 8 terms) | Missing | P1 |
| Replies and notes | Reply to customer (widget + email if address on file) or leave an internal note; slash commands | Missing | P1 |
| Resolve/reopen | Resolve is a label, not a lock; customer reply reopens | Missing | P1 |
| Snooze and reminders | Shared snooze hides until a deadline; personal reminder surfaces in your Queue | Missing | P1 |
| Archive / spam | Move out of inbox; lock composer; restore | Missing | P1 |
| Assignment | Hand a conversation to a teammate | Missing | P1 |
| Email forwarding | Generate `support@workspace.userjot-mail.com`; forward existing support mailbox; no DNS change; pause/rename label | Missing | P1 |
| Email threading | Outbound replies are normal email; customer replies thread back; widget conversations also email the customer when an address is known | Missing | P1 |
| Junk filtering | Skip/hold auto-replies, out-of-office, bounces and marketing blasts; receipts don't wake the AI | Missing | P1 |
| Email-to-feedback | Separate address turns forwarded email into board submissions (distinct from support forwarding) | Missing | P2 |
| Operators | Owners/admins can be operators; avatars, timezone, weekly schedule, "available while using UserJot", appear offline | Missing | P1 |
| Presence | Workspace-level online/neutral; up to four operator avatars; mask identities option shows workspace logo instead | Missing | P1 |
| Away replies | Automatic acknowledgment when the whole team is away | Missing | P2 |
| Notifications | Push/email for new conversations and replies; per-user preferences | Missing | P1 |
| Block senders | Block a sender and manage the block list | Missing | P2 |
| Visitor context | Page started from, environment, visitor details, linked requests, product activity/contributions, unverified badge | Missing | P1 |
| Live visitor map | See where people are browsing and how many are online (beta) | Missing | P2 |
| Live translation | Translate incoming messages; keep handoff notes in the team's language | Missing | P2 |
| Draft persistence | Reply drafts survive reloads (local storage) | Missing | P2 |
| Chat appearance | Customize what customers see when they start a conversation in the widget | Missing | P2 |
| Attachments | Images/files in conversations (support article scope: chat; verify exact types during build) | Missing | P2 |
| Data controls | Transfer ownership, erase a member's personal data, 30-day deletion grace | Missing | P2 |

### 4.6 Juno (AI operator)

| Capability | UserJot behavior | Herald today | Priority |
| --- | --- | --- | --- |
| Active toggle | Juno picks up new conversations; turning off sends new ones to the team but keeps existing ones | Missing | P1 |
| Knowledge sources | Upload Markdown/plain text/HTML/JSON/YAML up to 10 MB; crawl a URL and public pages beneath its path; 5 sources in beta | Missing | P1 |
| Knowledge lifecycle | Sources process as one versioned package; "Updating Juno…" then "Knowledge is live"; keep serving old version during update; replace/recrawl/pause/remove; view crawled pages | Missing | P1 |
| Behavior controls | Tone (Warm & Helpful, Professional, Direct, Empathetic, Playful), reply length, formality, emoji | Missing | P1 |
| Language | Replies in the customer's language automatically | Missing | P2 |
| Answer scope | Answers greetings and product questions covered by knowledge; silent on spam, empty messages and automated mail | Missing | P1 |
| Handoff | Hands off when asked for a human, knowledge gap, low confidence, or account/billing disputes; customer sees a short note; lands in Queue | Missing | P1 |
| Human takeover | Once a human replies, Juno stays out; "Hand to Juno" resumes | Missing | P1 |
| Auto-resolve | Chat after 30 minutes of silence, email after 72 hours; any reply reopens; team-touched threads never auto-resolve | Missing | P2 |
| Feedback cards | Search public boards, show a matching request or draft a new one, and file/vote/follow only after the customer confirms; widget chat only, not email | Missing | P1 |
| Feedback limits | Max 3 new requests per conversation, 25 per workspace per day, 10 votes/follows per conversation | Missing | P1 |
| Guest behavior | Anonymous visitors can create only when guest posting is enabled; cannot vote/follow | Missing | P1 |
| Moderation integration | Juno-filed requests go through the same review queue | Missing | P1 |
| Activity meter | "Handled by Juno" last 30 days; resolved-without-team share | Missing | P2 |
| AI changelog draft | Drafts posts from completed requests | Missing | P1 |
| AI tagging / duplicate suggestions | Tags incoming feedback; suggests duplicates | Missing | P2 |
| Product description | Scan the website and build an editable product description | Missing | P2 |
| Guardrails | Cannot change product/settings/billing/customer data; never invents answers; never files feedback without confirmation | Missing | P1 |

### 4.7 REST API, MCP and headless automation

| Capability | UserJot behavior | Herald today | Priority |
| --- | --- | --- | --- |
| REST API | Bearer token from workspace settings; manage boards, requests, comments, votes, tags, changelogs (including cover images), members, companies and company relationships; find similar requests across the backlog | Missing | P1 |
| API tokens | One token per agent; name, last used, revoke; token reaches one workspace | Missing | P1 |
| OpenAPI | Machine-readable spec (`/docs/api/openapi.json`) | Missing | P1 |
| Idempotency | `Idempotency-Key` on replies, notes, new requests and changelog posts; 24-hour replay returns the first response | Missing | P1 |
| Polling filters | `updated_since` for conversations; `inbox_state=needs_team`; requests by newest/votes/status changes/author | Missing | P1 |
| Safe defaults | API-created changelog posts stay drafts; private notes never reach the customer | Missing | P1 |
| External identities | Pass the customer's `external_id`; votes/requests count as theirs and they get shipping emails | Missing | P1 |
| Rate limits | Shared across REST and MCP | Missing | P1 |
| Remote MCP | `https://api.userjot.com/v1/mcp`; tools for conversations, requests, changelog, members | Missing | P1 |
| MCP setup guides | Claude Code, Cursor, Codex, ChatGPT, Windsurf | Missing | P2 |
| Headless routines | Six scheduled-agent prompts (inbox triage, bug report, feature capture, changelog draft, weekly demand, ship replies) | Missing | P2 |
| Webhooks | Outbound event delivery (UserJot lists webhooks as an integration) | Missing | P1 |
| Token scoping | UserJot tokens cannot be limited to certain actions; each agent gets its own token (known limitation) | Missing | Note: improve with scopes if feasible |

### 4.8 Integrations

| Capability | UserJot behavior | Herald today | Priority |
| --- | --- | --- | --- |
| Slack | Turn a Slack message into a request; AI drafts title/description and picks a board; status updates return in the same Slack thread | Missing | P1 |
| Slack/Discord notifications | New submissions, comments and status changes to a channel; Discord webhooks | Missing | P1 |
| Linear | Listed integration (create/link issues and reflect status; verify exact behavior against UserJot docs during build) | Missing | P2 |
| Email-to-feedback | Separate inbound address creates board submissions | Missing | P2 |
| Webhooks | Generic outbound HTTP events | Missing | P1 |
| Import / export | Canny, ProductRoad, Nolt, CSV; full export | Missing | P1 |

### 4.9 Workspace, plans and administration

| Capability | UserJot behavior | Herald today | Priority |
| --- | --- | --- | --- |
| Roles | Owner, Admin, Member; owners remove privileged members; admins manage feedback, boards, tags, changelog, integrations, team and billing; members participate publicly | Partial (owner/admin/editor; no member/customer distinction) | P0 |
| Invitations | Invite teammates; invites are admin invites | Missing | P1 |
| Unlimited users/posts | Every plan, including Free | N/A (no plans) | P1 |
| Plan limits | Free: 2 boards; Starter $29/$24 yearly: 5 boards, custom domain/branding, guest posting, private boards, one integration; Professional $59/$49 yearly: unlimited boards/admins/integrations, advanced search, SSO, identity masking; 14-day trial | Missing | P1 |
| Billing | Manage plan, trial, upgrade, cancel | Missing | P1 |
| Custom domain | Starter+ | Missing | P1 |
| Branding | All plans except hide "Powered by" (Professional) | Missing | P1 |
| Localization | Auto-detect or fixed locale | Missing | P2 |
| Identity masking | Professional | Missing | P2 |
| Automatic login / SSO | Automatic login and JWT SSO; require signed tokens | Missing | P1 |
| Notification preferences | Per-user email/push toggles | Missing | P1 |
| API tokens | Settings → API Tokens | Missing | P1 |
| Data controls | Transfer ownership, erase a member's personal data, 30-day deletion grace | Missing | P2 |
| Settings areas | General, Team, Feedback, Conversations, Juno, Branding, Privacy, Data & Import, Billing, API | Missing | P1 |

### 4.10 Analytics and notifications

| Capability | UserJot behavior | Herald today | Priority |
| --- | --- | --- | --- |
| Product activity | "Last 12 weeks" completed-request activity | Missing | P2 |
| Conversation metrics | Queue/Open counts, handled by Juno, resolution share | Missing | P2 |
| Visitor map | Live browsing locations and online count | Missing | P2 |
| In-app unread | Widget launcher badge, notifications panel | Missing | P2 |
| Email notifications | Status changes, replies, weekly digest, reply-by-email, preferences | Partial (delivery rows) | P0 |
| Channel notifications | Slack/Discord for submissions, comments, status | Missing | P1 |
| Webhooks | Outbound integrations | Missing | P1 |

**Inventory total:** 10 areas, **147 capability rows**. The core loop is roughly 45 of them; the rest are retention, scale and monetization.

---

## 5. The five structural gaps

These are not “features”; they are the model changes that determine whether the features can be built cleanly.

### 5.1 There is no customer principal

Herald's `feedback_votes.voter_id` and `feedback_posts.author_id` point at the Better Auth `user` table. That is correct for a workspace member, but a public board visitor is not a workspace member, may be anonymous, and may belong to a company. The current model cannot represent “a customer who voted on this request” without creating fake workspace users.

**Decision:** introduce a separate customer identity, scoped to the workspace:

- `customers` — workspace-scoped end users: id, workspaceId, externalId (nullable, from the customer's app), email, name, avatar, traits JSON, verifiedAt, bannedAt, lastSeenAt.
- `customer_companies` + `customer_company_memberships` — B2B company data and traits.
- `customer_sessions` — signed, httpOnly, short-lived session for public pages and widget; guest sessions have no email until the customer supplies one.
- Feedback authors/voters/comments/followers reference `customerId`; a team-authored post may also carry `authorUserId` for attribution.
- Workspace `user` remains the internal principal; never reuse it for public customers.

This is the largest migration. It touches feedback, votes, comments, notifications and every public route. Do it before boards or widgets.

### 5.2 There are no boards

Herald feedback is product-wide. UserJot's core unit is a **board** with its own visibility, moderation settings, public URL and plan limit.

**Decision:** add `boards` under a product, with:

- name, slug, description, icon/color, visibility (`public` | `private`), position;
- moderation settings (submissions, comments, sensitive info), guest posting;
- public roadmap/changelog visibility can stay workspace/product-level;
- a default board created for every existing product, and every existing feedback post moved to it (backfill migration).

Board URLs become `/p/{workspace}/{product}/{board}` (or the custom-domain equivalent). Public request URLs include the board.

### 5.3 The roadmap is a separate record, not a status view

UserJot has no manual roadmap items: the roadmap is a projection of request statuses. Herald had `roadmap_items` plus join tables and an unimplemented roadmap page. Migration `0012` retired both tables; the internal and public roadmaps now read feedback status directly.

**Decision:** make feedback posts the roadmap source.

- Internal roadmap: a kanban over feedback posts, columns = the six statuses, drag/drop updates status.
- Public roadmap: three columns derived from Planned, In Progress, Completed.
- **Retired.** Migration `0012` drops `roadmap_items` and `roadmap_feedback_links`; linked feedback rows remain as the cards. Private initiatives can become a board type later rather than a second status model.
- `release_feedback_links` remains the bridge from shipped requests to changelog entries.

### 5.4 There is no public read/write surface

Every current query is authorized through `requireProductContext`, which assumes a signed-in workspace member. Public boards need:

- a tenant resolver that goes from host/path to workspace → product → board without a session;
- explicit public projections that exclude internal notes, unapproved content, hidden requests, private boards and other customers' data;
- a separate rate-limit/moderation layer for anonymous writes;
- a signed customer session for votes/follows/comments, with guest sessions for one-step participation.

**Decision:** add a `(public)` route group and a `public/` query module. Never import the dashboard snapshot into a public page; public pages get their own selectors and serializers.

### 5.5 There is no delivery/automation layer

`notification_deliveries` is an outbox table without a worker. UserJot's loop depends on email at every step (status change, reply, changelog, digest, support reply) and on background work (crawling, AI ingestion, webhooks, imports).

**Decision:** build one job/outbox layer:

- `jobs` table with `FOR UPDATE SKIP LOCKED`, retry/backoff, `run_at`, `locked_at`, `attempts`, `last_error`.
- Existing `/api/cron/publish-releases` becomes one job type; add `deliver-notifications`, `send-email`, `crawl-knowledge`, `process-import`, `deliver-webhook`, `recalculate-trending`.
- A single protected cron endpoint runs due jobs in bounded batches; Vercel Cron calls it every minute (the repo already has the schedule).
- Email provider with outbound + inbound parsing (Resend is the README's stated plan; inbound forwarding needs a provider that supports parse/webhook, e.g. Postmark inbound or Cloudflare Email Routing → Worker). Provider choice is an implementation decision, not a blocker for the plan.
- All sends remain idempotent through `notification_deliveries.dedupe_key`.

---

## 6. Target architecture

### 6.1 Principals and authorization

| Principal | Authenticated by | Can do |
| --- | --- | --- |
| Workspace user | Better Auth session | Dashboard, team actions, inbox, moderation, settings |
| Customer | Customer session (signed cookie/JWT), SSO JWT, or guest session | Public board: submit, vote, comment, follow; widget messages |
| API token | Bearer token (hashed at rest) | Scoped workspace API/MCP operations |
| Cron | `CRON_SECRET` bearer | Due jobs only |
| Widget | Project/public key + signed identity | Public read + customer-scoped writes |

Add permissions for the new surfaces:

- `board:read`, `board:manage`
- `moderation:read`, `moderation:manage`
- `conversation:read`, `conversation:write`, `conversation:assign`
- `juno:read`, `juno:manage`
- `api:manage`
- `billing:manage`
- `analytics:read` (already exists)
- `settings:manage` (already exists)

Keep `owner > admin > editor` for internal users. UserJot's “Member” maps to a customer, not to Herald's `editor`; do not grant dashboard access to customers.

### 6.2 Proposed schema additions

Names are proposals; final names should follow the existing snake_case conventions and composite-FK pattern.

**Identity and boards**

- `customers` (workspace_id, external_id, email, email_normalized, name, avatar_url, traits jsonb, verified_at, banned_at, last_seen_at)
- `customer_companies`, `customer_company_memberships`
- `customer_sessions` (customer_id, token_hash, expires_at, guest boolean, created_at)
- `boards` (product_id, name, slug, description, visibility, position, settings jsonb)
- `board_tags`, `feedback_tag_links`
- `feedback_followers` (post_id, customer_id, source, created_at, unique)
- `feedback_reactions` (post_id, comment_id nullable, customer_id, kind)
- `feedback_attachments` (post_id/comment_id, storage_key, mime, width/height, checksum)
- `moderation_reviews` (content_type, content_id, reasons jsonb, status, reviewed_by, reviewed_at)
- `blocked_customers` (workspace_id, customer_id/email, reason, created_by)

**Conversations**

- `conversations` (product_id, customer_id nullable, channel, status, assignee_id, subject, last_message_at, snoozed_until, first_page_url, visitor jsonb, unread_team_count, unread_customer_count)
- `conversation_messages` (conversation_id, author_type `customer|team|juno|system`, author_user_id/customer_id, body, internal boolean, provider_message_id, in_reply_to, created_at)
- `conversation_reminders` (conversation_id, user_id, remind_at, completed_at)
- `conversation_blocks` (workspace_id, email_normalized/customer_id, reason, created_by)
- `operators` (workspace_member_id, availability_mode, timezone, schedule jsonb, appear_offline)
- `email_addresses` (workspace_id, prefix, address, status, created_at)
- `email_threads` (conversation_id, provider_thread_id, subject, participants jsonb)

**AI**

- `ai_settings` (workspace_id, active, tone, reply_length, formality, emoji, feedback_requests_enabled, model, daily_budget)
- `ai_knowledge_sources` (workspace_id, type `file|url`, url, storage_key, status, version, last_crawled_at, checksum, error)
- `ai_knowledge_chunks` (source_id, content, embedding vector, token_count, metadata)
- `ai_runs` (conversation_id, model, input_tokens, output_tokens, cost_cents, latency_ms, outcome `answered|handoff|error`, handoff_reason)
- `ai_usage_counters` (workspace_id, day, conversations_handled, requests_created, votes_created)
- `ai_feedback_cards` (conversation_id, feedback_post_id, action `shown|filed|voted|followed`, confirmed_at)

**Platform**

- `api_tokens` (workspace_id, name, token_hash, prefix, scopes jsonb, last_used_at, revoked_at, created_by)
- `webhooks` (workspace_id, url, secret, events jsonb, active)
- `webhook_deliveries` (webhook_id, event, payload, status, attempts, response_status, last_error)
- `jobs` (type, payload jsonb, status, run_at, locked_at, attempts, last_error)
- `audit_log` (workspace_id, actor_user_id, action, target_type, target_id, metadata jsonb, created_at)
- `analytics_events` (workspace_id, product_id, type, subject_id, customer_id nullable, metadata jsonb, occurred_at) + daily rollups
- `workspace_subscriptions` (workspace_id, plan, status, trial_ends_at, current_period_end, stripe_customer_id, stripe_subscription_id)
- `imports` / `exports` (workspace_id, type, status, file_key, error, counts)

**Changelog extensions**

- `release_tags`, `release_tag_links`
- `release_authors` (release_id, user_id)
- add `youtube_url`, `visibility`, `ai_draft` metadata to `releases`
- keep `release_feedback_links` (already composite-FK protected)

### 6.3 Public route map

```
/                                  → marketing or redirect to board
/p/[workspace]/[product]/          → board home
/p/[workspace]/[product]/[board]   → board
/p/[workspace]/[product]/requests/[id] → request detail
/p/[workspace]/[product]/roadmap   → public roadmap
/p/[workspace]/[product]/updates   → changelog list
/p/[workspace]/[product]/updates/[slug] → changelog detail
/p/[workspace]/[product]/login     → customer login / SSO
/p/[workspace]/[product]/signup    → customer signup
/embed/[workspace]/[product]       → iframe shell for widget embeds
/api/public/*                      → public read/write endpoints
/api/widget/*                      → widget bootstrap, identity, events
/api/v1/*                          → token-authenticated REST API
/api/mcp                           → remote MCP endpoint (POST)
```

Custom domains resolve to the same public tree. Start with a path-based public site; add host resolution and wildcard TLS once the core loop is stable. Do not block the entire plan on custom-domain infrastructure.

### 6.4 Widget architecture

- Serve a versioned module from the app (`/widget/v3.js`) with a long cache and immutable filename.
- Use a small loader that queues calls (`window.uj` proxy) until the module loads; support a single-tag `data-project` install for strict CSP.
- Render the launcher in a Shadow DOM (style isolation) and the panels in a same-origin iframe (avoids CSS/DOM conflicts and keeps the host app stable).
- Public data comes from `/api/public/*`; customer identity is a signed session cookie set by `/api/widget/identify` (JWT verification server-side).
- Budget: ≤ 60 KB gzip for the loader + launcher shell; panels load on first open. No React in the host page; the iframe can reuse the app's public components.
- Events/state documented exactly like UserJot's v3 surface: `open`, `close`, `toggle`, `identify`, `logout`, `on`, `getState`, unread/presence.
- Deep links and `open({ to, submissionId, updateId, compose })` map to public routes.
- Do not build v2 compatibility; Herald has no installed base.

### 6.5 Email and notifications

One outbox, one worker, one preference model.

Events:

- `feedback.created` → moderators (review needed)
- `feedback.status_changed` → author + voters + commenters + followers
- `feedback.comment_created` → thread participants
- `changelog.published` → product subscribers + request followers
- `conversation.created` / `conversation.replied` → assignee/team
- `conversation.reminder_due` → the individual user
- `conversation.assigned` → assignee
- `digest.weekly` → opted-in customers
- `review.needed` → admins/owners
- `import.completed`, `export.ready`, `webhook.failed` → team

Requirements:

- Per-recipient `notification_preferences` (status, comments, changelog, digest, conversations, marketing).
- Signed unsubscribe links scoped to a preference, not a global “unsubscribe from everything.”
- Reply-by-email: inbound webhook verifies the sender, strips quoted text/signature, rejects auto-replies, and appends to the correct thread.
- Bounce/complaint suppression list; never retry a hard bounce.
- Email templates are plain React/HTML with a text alternative and a consistent footer.
- All sends remain idempotent through `notification_deliveries.dedupe_key`; the worker marks `sent` only after the provider accepts.

### 6.6 AI architecture (Juno)

- **Provider abstraction:** one server-side interface (`generate`, `embed`) with a configurable OpenAI-compatible endpoint and model. Keys never reach the browser.
- **Knowledge ingestion:** upload (Markdown/text/HTML/JSON/YAML ≤ 10 MB) and crawl (same-origin/path-bounded, SSRF-safe, size/time-bounded). Parse → chunk (≈ 500–800 tokens with overlap) → embed → store in Postgres with `pgvector`.
- **Retrieval:** hybrid vector + full-text search, top-k with a similarity floor. If the floor is not met, hand off; do not answer from general knowledge.
- **Answering:** system prompt includes only the retrieved chunks, product name, tone/length/formality/emoji, and the customer's language. No tools that mutate settings/billing/customer data; the reviewed transcript email is the only registered action.
- **Feedback cards:** the only write-capable Juno flow; a server-side “proposal” is shown to the customer, and a second confirmed message performs the create/vote/follow with rate limits.
- **Handoff:** explicit reasons (`asked_human`, `no_knowledge`, `low_confidence`, `billing_or_account`, `abuse`); a private note is written for the team; the conversation moves to Queue.
- **Auto-resolve:** only if Juno fully answered and no human touched the thread; 30-minute silence for chat, 72 hours for email; any customer reply reopens.
- **Cost controls:** per-workspace daily budget and per-conversation token cap; degrade to handoff when exceeded.
- **Evaluation:** a per-workspace golden set (questions + expected answer/handoff), run on every prompt/model change; track hallucination rate, handoff precision, resolution rate, p95 latency and cost per resolved conversation.
- **Prompt-injection defense:** retrieved content is untrusted data; never follow instructions found in documents; discard tool-like text; log citations for audit.
- **Privacy:** redact secrets/PII before logging; retention window for AI runs; workspace deletion cascades to sources/chunks/runs.

### 6.7 Plans and entitlements

Implement entitlements as server-side checks, not UI flags:

```ts
type Plan = "free" | "starter" | "professional";
type Entitlement =
  | "boards" | "custom_domain" | "branding" | "guest_posting"
  | "private_boards" | "integrations" | "advanced_search" | "sso"
  | "identity_masking" | "hide_powered_by" | "conversations" | "juno";
```

- `getEntitlements(workspaceId)` reads `workspace_subscriptions` and returns limits.
- Every mutation that creates a limited resource calls `requireEntitlement` and returns a typed `PLAN_LIMIT_REACHED` error the UI can turn into an upgrade prompt.
- Prices and plan names are configuration, not hard-coded in components.
- Stripe Checkout + Customer Portal; webhooks update `workspace_subscriptions`; 14-day trial; no seat metering.

---

## 7. Delivery plan

### Phase 0 — Foundations (2 weeks)

**Goal:** make the public/customer model possible without disturbing the existing dashboard.

Deliverables:

1. Migration: `customers`, `customer_sessions`, `boards`, `board_tags`, `feedback_tag_links`, `feedback_followers`, `feedback_reactions`, `feedback_attachments`, `moderation_reviews`, `blocked_customers`, `jobs`, `api_tokens`, `audit_log`, `workspace_subscriptions`.
2. Backfill: create a default board per product; move existing feedback to it; keep current statuses mapped to the six-state enum; add `author_customer_id` nullable while `author_id` remains for team attribution.
3. Public tenant resolver: host/path → workspace → product → board; no session required; 404 for unknown/private.
4. Public query module + serializers that exclude internal notes, unapproved content, hidden requests and other customers' private data.
5. Customer session: signed httpOnly cookie; guest session; `identify` endpoint; rate limiting; CSRF/origin checks for writes.
6. Jobs/outbox worker: `jobs` table, `FOR UPDATE SKIP LOCKED`, protected cron runner; migrate release publishing to a job type while keeping the existing endpoint contract.
7. Email provider integration (outbound only) + templates + suppression list; a test send.
8. Storage abstraction for uploads (covers, screenshots, attachments) + signed URLs + type/size limits.
9. Entitlements module + plan config; no billing yet.
10. Feature flags for public routes and widget.

**Exit criteria**

- Existing dashboard behavior and tests unchanged.
- A guest can obtain a session and read a public board projection; a foreign workspace id returns 404.
- A test email is delivered and recorded as `sent`.
- A due job runs once under concurrent cron invocations.
- No public page can read an internal note or another customer's private post.

### Phase 1 — Public feedback loop (3 weeks)

**Goal:** a customer can submit, discuss, vote and follow feedback without a Herald account; the team can triage it.

Deliverables:

1. Board CRUD and settings (visibility, guest posting, moderation, position, branding).
2. Public board page: search, Top/Trending/Newest, tag/status filters, pagination; empty states.
3. Request detail: votes, comments, reactions, follow/unfollow, linked updates, “similar requests.”
4. Submit flow: title, body, board picker, attachments, similar-request suggestions, guest or identified identity, moderation receipt.
5. Customer auth: email/password or magic link (choose one), SSO JWT, automatic login, profile menu, logout.
6. Merge/unmerge with comment/reaction migration and activity history; hide request; private boards.
7. Moderation: approval queue, spam/abuse flags, sensitive-info hook (text + supported images), Keep/Delete/Publish/Keep hidden/Approve, retry.
8. Tags + auto-tag hook (AI can be added later; manual tags first).
9. Notifications: status change, reply, weekly digest opt-in; preference center; unsubscribe.
10. Import (CSV first; Canny/Nolt/ProductRoad adapters behind one importer) and export.
11. Branding/localization/custom-domain groundwork (logo, name, color, locale; domain can be Phase 7 if infra is not ready).
12. Plan gates: board count, guest posting, private boards.

**Exit criteria**

- End-to-end: guest submits → moderator publishes → another visitor votes/comments/follows → admin changes status → follower receives email → request appears on the public roadmap.
- Cross-tenant tests: guessed request/board/customer ids cannot read or mutate another workspace's data.
- Merge/unmerge restores comments and reactions; vote counts never double.
- Moderation blocks unapproved content from every public surface, including search and the widget bootstrap.
- Import handles 10,000 rows without blocking the request (job + progress).
- Mobile layout and keyboard navigation pass the project's accessibility checklist.

### Phase 2 — Roadmap and changelog loop (2–3 weeks)

**Goal:** status changes move the public roadmap, and shipping produces a public update that notifies the people who asked.

Deliverables:

1. Internal roadmap kanban over feedback statuses; drag/drop; counts; filters; stale-work and low-traction prompts.
2. Public roadmap: Planned / In Progress / Done columns; vote counts; empty state; visibility toggle.
3. Changelog extensions: tags, multiple authors, YouTube, autosave, public list/detail pages, independent visibility.
4. Link completed requests to a release; render “Built from your feedback” with per-viewer visibility filtering.
5. Subscriber/follower notification on changelog publish and request completion; email + in-app unread.
6. AI draft from completed requests (human review required; no auto-publish).
7. Changelog API create/update (drafts by default) — can land with Phase 6 if the internal action is reusable.
8. Public updates page and RSS (optional; low cost if the data model is ready).
9. Roadmap/changelog settings: visibility, default board, “powered by” attribution.

**Exit criteria**

- Moving a request to Planned/In Progress/Completed changes the public roadmap without a second write.
- Publishing a release emails only the people entitled to see the linked requests; hidden/private/merged requests are excluded.
- A scheduled release publishes exactly once under concurrent cron runs and notifies once per recipient.
- AI draft never publishes automatically; it produces a draft with linked requests and an editable body.

### Phase 3 — Widget v3 (2–3 weeks)

**Goal:** one snippet puts feedback, roadmap, updates and messages inside a customer's product.

Deliverables:

1. Versioned loader + module; queue proxy; `data-project` single-tag install; CSP-safe; no inline requirement.
2. Shadow-DOM launcher: position, theme, locale, custom trigger; unread badge; presence dot.
3. Iframe panels: Home, Feedback, Roadmap, Updates, Messages, Notifications; deep-link routing; compose; specific request/update.
4. Identity: `identify({ user, companies })`, traits, `logout`; server-signed JWT; “require signed tokens” setting; reject invalid tokens.
5. Automatic login/SSO handoff from the host app to public pages.
6. SDK events/state: `ready`, `open`, `close`, `identify`, `unread`, `presence`, `statechange`, `error`, `getState`.
7. Inline embed (`embed`, `navigate`, `destroy`, URL sync) and custom launcher recipe.
8. Screenshot capture + annotation + upload; image attachments; similar requests while typing.
9. Widget settings page in the dashboard: install snippet, project/public key, allowed origins, appearance, identity secret rotation, verification.
10. Bundle-size and performance budget; cross-browser smoke tests (Chromium, Firefox, WebKit).

**Exit criteria**

- The snippet works on a plain HTML page and a React/Next.js page with no console errors.
- Signed identity with a wrong/expired token fails closed; unsigned mode works only when allowed.
- Deep links open the right panel/request/update; the unread badge updates after a changelog publish or reply.
- The launcher survives host CSS resets and does not leak styles.
- Public API calls from the widget are origin-checked and rate-limited.

### Phase 4 — Conversations (3 weeks)

**Goal:** chat and support email share one inbox, with the context needed to answer.

Deliverables:

1. Conversation/message schema + statuses; customer and team authors; internal notes; attachments.
2. Dashboard inbox: Queue/Open/All; Unread/Snoozed/Resolved/Spam/Archived; search; counts; assignment; bulk actions if needed.
3. Thread view: replies, notes, slash commands, resolve/reopen, snooze, personal reminders, archive/spam, block sender.
4. Widget Messages: start conversation, send/receive, unread, presence, contact capture for guests, email fallback when an address is known.
5. Email forwarding: generated address, inbound parse, threading, outbound replies, reply-by-email, junk filtering (auto-reply/OOO/bounce/marketing), pause/rename.
6. Operators: eligible owner/admin, schedule/timezone, available-while-using, appear offline, avatars; workspace-level presence.
7. Away replies, conversation notifications, per-user preferences, draft persistence.
8. Visitor context: page started from, environment, linked requests, activity/contributions, unverified badge.
9. Live translation (provider-backed) and visitor map (privacy review first).
10. Realtime: start with 3–5s polling for MVP; add SSE/WebSocket only if the UX requires it and the hosting path supports long-lived connections.

**Exit criteria**

- A customer starts a chat, closes the tab, receives an email reply, replies by email, and the thread stays in sync.
- An owner/admin sees the conversation in Queue; a non-operator editor does not get inbox access unless granted.
- Snooze hides from Queue/Open until due; a personal reminder surfaces only for that user.
- Spam/archived conversations are out of the main inbox and search; restore works.
- Cross-tenant tests cover conversations, messages, attachments and email addresses.

### Phase 5 — Juno (3 weeks)

**Goal:** an AI operator that answers from the workspace's own knowledge, hands off cleanly, and turns chat into board signal.

Deliverables:

1. Knowledge sources: upload, crawl, versioned publish, replace/recrawl/pause/remove, 5-source limit, status UI.
2. Ingestion pipeline: parse, chunk, embed, index; safe crawling (same origin/path, SSRF guards, size/time limits); retries.
3. Retrieval + answer generation: citations, confidence floor, language, tone/length/formality/emoji, model config.
4. Conversation integration: active toggle, pickup, silence rules, handoff reasons, private handoff note, human takeover, “Hand to Juno”, auto-resolve timers.
5. Feedback cards: search, show, create/vote/follow after confirmation, limits, moderation, guest rules.
6. AI changelog draft (reuse the release action), auto-tagging, duplicate suggestions (can be separate prompts/jobs).
7. Activity meter: handled by Juno, resolved without team, handoff reasons, cost.
8. Guardrails: no settings/billing/customer-data mutations; prompt-injection defenses; PII redaction; per-workspace budget; kill switch.
9. Evaluation harness and a small golden set per workspace; prompt/model versioning.

**Exit criteria**

- Juno answers a question covered by a source with a citation; unknown questions hand off instead of guessing.
- A billing/account question always hands off.
- A feedback card is never acted on before confirmation; limits are enforced server-side.
- Turning Juno off stops new pickups but does not drop existing threads.
- Cost per resolved conversation and handoff rate are visible and within the configured budget.

### Phase 6 — API, MCP and integrations (3 weeks)

**Goal:** let agents and other tools operate the same loop.

Deliverables:

1. REST API v1: boards, requests, comments, votes, tags, changelogs, members, companies, conversations, messages/notes. Bearer tokens, hashed at rest, scoped per workspace.
2. OpenAPI 3.1 document served at `/api/v1/openapi.json`; generated client optional.
3. Pagination (cursor), filters (`status`, `board`, `tag`, `author`, `updated_since`, `inbox_state`), sorting, idempotency keys, request ids.
4. Safe defaults: API-created changelog posts are drafts; internal notes never reach customers; external ids act as the customer.
5. Rate limits shared across REST/MCP; 429 with `Retry-After`; audit token usage.
6. Remote MCP server at `/api/mcp`: tool set mirrors API; token auth; setup docs for Claude Code, Cursor, Codex, ChatGPT, Windsurf.
7. Webhooks: signed payloads, retries/backoff, delivery log, replay.
8. Slack app: message → request (AI title/description/board suggestion), thread status updates, notification channel.
9. Discord webhooks; Linear integration (verify exact behavior before building); email-to-feedback.
10. Headless routines documentation with six safe prompts (triage, bug report, feature capture, changelog draft, weekly demand, ship replies).

**Exit criteria**

- A token can list only its workspace's data; a token from workspace A cannot read workspace B.
- An idempotent retry returns the first response and does not create a second row.
- MCP end-to-end: list needs-team conversations → read timeline → create a private note → update status; no duplicate replies.
- Webhook signatures verify and failed deliveries retry with backoff.
- Slack message → request appears on the suggested board; status change posts back to the thread.

### Phase 7 — Plans, analytics and hardening (2–3 weeks)

**Goal:** make it a sellable, operable SaaS.

Deliverables:

1. Stripe products/prices, Checkout, Customer Portal, trial, webhooks; plan/entitlement enforcement on every limited mutation.
2. Plan limits: 2/5/unlimited boards; one/all integrations; advanced search, SSO, identity masking, hide attribution.
3. Analytics: public board views, votes, submission conversion, widget open/install, status funnel/time-to-ship, conversation volume/response time, Juno resolution, email delivery; daily rollups.
4. Settings completion: General, Team/invitations, Feedback, Conversations, Juno, Branding, Privacy, Data & Import, Billing, API tokens.
5. Data controls: export, delete customer data, transfer ownership, 30-day workspace deletion grace.
6. Custom domain + wildcard TLS + verification; domain health check.
7. Security review: tenant isolation, IDOR, XSS/markdown sanitization, SSRF (crawler), file upload scanning, rate limits, CSRF/origin, webhook signatures, secret handling.
8. Performance: indexes for public board/roadmap/search/inbox; query plans; p95 targets; load test with realistic rows.
9. Accessibility and responsive pass; empty/loading/error states for every public surface.
10. Operational readiness: backups/PITR, migration runbook, job dashboard, alerting, audit log retention.

**Exit criteria**

- Free plan hits the board limit with a typed upgrade path; upgrading unlocks immediately.
- Trial → paid → cancel flows update entitlements from Stripe webhooks, not from client state.
- Analytics numbers reconcile with SQL counts for a seeded test workspace (test fixtures only; never production demo data).
- Security checklist has no open high/critical findings.
- Public pages meet the agreed p95 budget under load.

---

## 8. Milestones and sequencing

| Milestone | Phases | Depends on | Demo |
| --- | --- | --- | --- |
| **M1 — Public feedback** | 0, 1 | — | Guest submits, votes, comments; admin moderates and triages |
| **M2 — Loop closed** | 2 | M1 | Status change → roadmap → ship → changelog → email |
| **M3 — In-product** | 3 | M1, M2 | Widget installed on an external page; signed identity; feedback + updates |
| **M4 — Support** | 4 | M1, M3 | Chat + forwarded email in one inbox; reply by email |
| **M5 — AI operator** | 5 | M4 | Juno answers from docs, hands off billing, files a confirmed request |
| **M6 — Agent-ready** | 6 | M1–M5 | API token + MCP routine triages the inbox; Slack creates a request |
| **M7 — Sellable** | 7 | M1–M6 | Free → Pro upgrade unlocks SSO/identity masking; analytics and billing |

**Critical path:** customer identity → boards → public feedback → roadmap/changelog → widget → conversations → AI. API/MCP can start once the domain services exist (after Phase 2), in parallel with Phase 4/5 if there are two engineers. Billing should not block the core loop; it can run in parallel after Phase 1 because entitlements are already modeled.

---

## 9. End-to-end acceptance scenarios

These are the scenarios to exercise manually and, where practical, in Playwright against a real Postgres test database.

### A. Anonymous customer, full loop

1. Open the public board with no session.
2. Submit “Export votes to CSV” with an image; see “Pending review.”
3. Admin publishes it; the request appears on the board.
4. Another visitor votes and comments; the author gets a reply notification.
5. Admin plans it; it appears in the public roadmap's Planned column.
6. Admin moves it to In Progress, then Completed.
7. Admin drafts a changelog from the completed request, edits, publishes.
8. Author, voters and commenters receive exactly one email; the public updates page shows “Built from your feedback” with the request.

### B. Duplicate and merge

1. Two customers submit similar requests.
2. The second submission sees the first as a suggestion.
3. Admin merges the second into the first.
4. Comments and distinct reactions move; duplicate votes do not double-count; the duplicate remains visible as merged.
5. Unmerge restores the duplicate's comments/reactions and counts.

### C. Private board and moderation

1. A private board is enabled on a paid plan.
2. Customer A submits; Customer B cannot see it, even with the direct URL.
3. A guest submits to a public board with sensitive text; the sensitive-info check holds it out of public view.
4. Moderator publishes or keeps hidden; the author sees the receipt; the public board/search/roadmap/widget never expose it.
5. A banned customer cannot post, vote or comment.

### D. Widget identity

1. Install the snippet on a plain HTML page.
2. `identify` with a valid signed JWT; the viewer is recognized.
3. Open a specific request and a specific update via deep links.
4. Submit feedback with a screenshot annotation.
5. Rotate the signing secret; old tokens fail closed; unsigned mode is rejected if required.
6. Host CSS changes do not affect the launcher.

### E. Conversations and Juno

1. Customer starts a chat; Juno answers a documented question with a citation.
2. Customer asks for a refund; Juno hands off with a private note; thread lands in Queue.
3. Agent replies; the customer receives an email copy; the customer replies by email; the thread continues.
4. Customer asks for a feature; Juno shows a card; only after confirmation does it file/vote/follow.
5. Agent resolves; a customer reply reopens; a snooze hides until due; a personal reminder surfaces in that user's Queue.

### F. API/MCP

1. Create a token, list requests, create a request as a customer via `external_id`, update status.
2. Retry with the same `Idempotency-Key`; no duplicate row.
3. Connect an MCP client; list `inbox_state=needs_team`; create a private note; update assignee; verify audit.
4. Attempt cross-workspace access with the token; 404/403, no data leak.

### G. Plans

1. Free workspace creates two boards; the third returns `PLAN_LIMIT_REACHED`.
2. Upgrade to Starter; custom domain, guest posting and private boards unlock; integration limit is one.
3. Upgrade to Professional; unlimited boards/integrations, SSO, advanced search, identity masking.
4. Cancel; entitlements revert at period end; data remains readable.

---

## 10. Testing strategy

### Unit (pure, no DB)

- Status transitions and allowed moves; merge/unmerge invariants.
- Plan entitlements and limits.
- Identity JWT validation (`iss`, `aud`, `exp`, clock skew, algorithm).
- Notification preference resolution and unsubscribe tokens.
- Trending score and vote dedupe.
- Email normalization, suppression, idempotency keys.
- Markdown/HTML sanitization and URL allowlists.
- Crawler URL policy (same origin/path, private-IP blocking).

### Integration (real Postgres, transaction per test)

- Tenant isolation for every public query: guessed ids, cross-workspace joins, private boards, hidden requests, internal notes.
- Customer session and guest session lifecycle.
- Merge transaction: comments/reactions/votes/followers.
- Publish transaction: release, feedback status, roadmap projection, notification rows.
- Job claiming under concurrency (`FOR UPDATE SKIP LOCKED`).
- REST/MCP auth, scopes, idempotency, rate limits.
- Billing webhook → entitlements.

### End-to-end (Playwright)

- Scenario A (full loop), B (merge), C (private/moderation), D (widget), E (conversations/Juno), F (API), G (plans).
- Run against a real Next.js server and Postgres; no mocked network for the critical path; AI provider can be a deterministic stub in CI, with a separate live smoke test.

### Non-functional

- Public board/roadmap p95 < 300 ms at 1,000 requests per board and 10,000 total; inbox p95 < 500 ms.
- Widget shell ≤ 60 KB gzip; first open interactive < 1.5 s on a mid-tier phone.
- Email delivery > 98% (provider-reported), hard-bounce suppression works.
- AI p95 answer < 8 s; handoff on timeout; no answer without retrieval.
- Accessibility: keyboard-only flow for submit/vote/comment; screen-reader labels; contrast.
- Security: OWASP top 10 review; SSRF; XSS; IDOR; CSRF; rate-limit abuse; upload scanning.

---

## 11. Security, privacy and abuse

- **Public authorization is explicit.** Every public query starts from `boardId`/`requestId` resolved inside a product, then filters by visibility, moderation and customer ownership. Never trust a customer id, workspace id or board id from the body.
- **Signed identity.** JWT HS256, `sub`/`iss`/`aud`/`iat`/`exp`, max 1 hour, 60-second skew; secret stored server-side; rotation supported. Invalid tokens fail closed.
- **Customer sessions.** httpOnly, Secure, SameSite=Lax; origin checks on writes; rotate on privilege change.
- **Rate limits.** Per IP, per session, per customer and per workspace for submissions, votes, comments, identify, conversation messages and API tokens. Use a Postgres-backed bucket initially; move to a shared store if multi-instance.
- **Moderation.** Automatic spam/abuse and sensitive-info checks are advisory; a human decision is recorded. False positives must be appealable.
- **Uploads.** Type sniffing, size limits, image re-encoding, signed URLs, no executable content, virus scan hook.
- **Crawler SSRF.** Allow only http/https, resolve DNS and block private/link-local/metadata ranges, cap redirects and response size, never fetch authenticated URLs.
- **Markdown/XSS.** Sanitize with an allowlist; disallow raw HTML by default; proxy external images if needed.
- **API tokens.** Store only a hash; show once; scopes; last-used; revoke; audit. Never log the token.
- **Webhooks.** HMAC signature, timestamp, replay window, retries with backoff, delivery log.
- **Email.** SPF/DKIM/DMARC for the sending domain; unsubscribe; suppression; no open-tracking pixels by default.
- **Privacy.** Data export/erasure, retention windows for AI runs and conversation attachments, 30-day deletion grace, DPA/subprocessor list, regional data residency if required.
- **Audit.** Record admin actions that change visibility, moderation, billing, roles, API tokens and data deletion.

---

## 12. Metrics

### Activation

- Workspace creates a board and publishes a changelog within the first session.
- First public submission within 24 hours of board creation.
- Widget installed within 7 days of first board.

### Loop health

- % of requests that move from Pending to a decision within 7 days.
- % of status changes that notify at least one follower.
- Median time from Completed to changelog publish.
- Email delivery rate and unsubscribe rate.

### Support

- First response time; median resolution time.
- Juno pick-up rate, resolution-without-team rate, handoff rate and handoff reasons.
- Conversations per 100 active customers; reopened rate.

### Retention/revenue

- Weekly active admins; boards with a new post in 30 days.
- Free → paid conversion; trial → paid; churn; expansion from Starter to Professional.
- API/MCP weekly active tokens.

### Reliability

- p95 public board/roadmap, inbox, widget first open.
- 5xx rate; job failure rate; webhook failure rate; AI timeout rate.
- Security incidents and moderation false-positive reports.

---

## 13. Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Scope is a full product suite, not a feature | Missed dates, half-built surfaces | Ship M1/M2 first; gate M3–M7 behind a working public loop; cut P2 features before cutting correctness |
| Customer identity migration breaks existing feedback | Data loss / broken votes | Add nullable customer columns, backfill in a transaction, keep team-authored rows, dual-read during rollout, drop old columns only after verification |
| Two roadmap models coexist | Conflicting status/roadmap | **Resolved:** migration `0012` retired `roadmap_items`; feedback status is the single source |
| Email deliverability and inbound parsing | Loop silently fails | Provider with inbound webhook; SPF/DKIM/DMARC; suppression; delivery dashboard; end-to-end tests with real mailboxes |
| AI hallucination or prompt injection | Trust/support damage | Retrieval floor, citations, handoff on low confidence, no mutating tools, eval harness, kill switch |
| AI cost runaway | Margin loss | Per-workspace daily budget, token caps, cheaper model for classification, cache embeddings, handoff when over budget |
| Realtime on serverless hosting | Flaky chat | Polling MVP; SSE/WebSocket only after measuring; keep message writes idempotent |
| Moderation false positives | Customers silenced | Human review, appeal path, clear receipts, conservative sensitive-info policy |
| Public endpoint abuse | Spam, scraping, cost | Rate limits, guest challenges (Turnstile optional), moderation, WAF, pagination caps |
| Custom-domain TLS/DNS complexity | Delayed launch | Path-based public site first; custom domains as a Phase 7 deliverable |
| Billing edge cases | Wrong entitlements | Stripe webhooks as source of truth, idempotent handlers, reconciliation job, typed errors |
| Design/QA bandwidth | Inconsistent UX | Reuse existing components; one design pass per milestone; accessibility checklist |

---

## 14. Deliberate differences and non-goals

Herald should not blindly clone UserJot. These differences are intentional:

- **Keep win-back campaigns.** UserJot does not connect cancellations to shipped releases. Herald's release↔cancellation-reason model is a differentiator; finish it after the core loop.
- **Keep the release editor's explicit scheduling and timezone handling.** It is stronger than a simple publish-date field.
- **Build widget v3 only.** No v2 compatibility; Herald has no installed base.
- **No native mobile apps.** Provide the web widget and, if customers ask, the Swift SDK; do not build iOS/Android apps for Herald itself.
- **No custom statuses.** Six fixed statuses keep the roadmap projection and notifications predictable.
- **No per-seat billing.** Flat workspace plans, matching the market expectation UserJot set.
- **No general-purpose help desk.** Conversations is scoped to product support and feedback; no SLA engine, macros marketplace, or multi-channel social inbox.
- **No full analytics suite.** Board/conversation/Juno metrics only; no session replay, funnels or heatmaps.
- **No copying UserJot's brand, copy, pricing page or assets.** Implement capabilities, not a visual clone.
- **No mock data.** Public previews use real workspace data; tests use factories and a test database. A “demo workspace” may be created through the normal onboarding flow, but it is real data and clearly labeled.
- **No silent AI.** Juno is off until a workspace enables it and provides knowledge; unknown questions hand off.

---

## 15. Open decisions

These need a product decision before or during Phase 0:

1. **Board vs product hierarchy.** Should a Herald product have multiple boards (UserJot parity), or is one board per product enough for launch? Recommendation: multiple boards, default board backfill.
2. **Customer auth.** Email/password, magic link, or SSO-only for public customers? Recommendation: magic link + SSO; passwords add support burden.
3. **Roadmap items.** **Resolved:** `roadmap_items` is retired. A private initiative can become a board type later if needed.
4. **Public URL strategy.** Path-based `/p/...` at launch, or invest in subdomains/custom domains immediately? Recommendation: path-based first; custom domain in Phase 7.
5. **Realtime.** Polling vs SSE vs managed realtime. Recommendation: polling for MVP; measure before adding infrastructure.
6. **AI provider and budget.** Which model/embedding provider, and what is the per-workspace daily budget? Recommendation: provider abstraction + a conservative default budget; no model names in client code.
7. **Email provider.** Outbound + inbound parse in one vendor, or split (Resend outbound, Postmark/Cloudflare inbound)? Recommendation: choose one vendor that supports both; split only if deliverability demands it.
8. **Billing.** Stripe Checkout + Portal vs a merchant-of-record. Recommendation: Stripe; Herald already plans it.
9. **Mobile.** Is the Swift SDK in scope for the first parity release? Recommendation: defer until a customer asks; the web widget covers most.
10. **Identity masking default.** Off by default (transparent) or on for public boards? Recommendation: off; let workspaces opt in.
11. **Conversations pricing.** Free while in beta like UserJot, or included in Pro? Recommendation: include in Professional at launch; no per-seat fee.
12. **Win-back priority.** Does it stay a first-class pillar, or pause until parity is shipped? Recommendation: keep the schema and finish it after M2; do not let it delay the public loop.

---

## 16. Sources

UserJot product and docs (accessed 2026-10-24):

- [UserJot home](https://userjot.com)
- [Feature index / llms.txt](https://userjot.com/llms.txt)
- [Full documentation bundle / llms-full.txt](https://userjot.com/llms-full.txt)
- [Pricing](https://userjot.com/pricing)
- [Help center](https://userjot.com/support)
- [Feedback boards](https://userjot.com/feature-request-software)
- [Public roadmap](https://userjot.com/product-roadmap)
- [Changelog](https://userjot.com/product-changelog)
- [In-app widget](https://userjot.com/in-app-feedback-widget)
- [Live chat / Conversations](https://userjot.com/live-chat-software)
- [MCP server](https://userjot.com/mcp)
- [Headless support and feedback](https://userjot.com/headless)
- [Slack integration](https://userjot.com/slack)
- [API reference](https://userjot.com/docs/api)
- [OpenAPI spec](https://userjot.com/docs/api/openapi.json)
- [Widget docs](https://userjot.com/docs/widget-overview), [widget v3 docs](https://userjot.com/docs/widget-v3-overview), [signed identity](https://userjot.com/docs/widget-v3-signed-identity)
- [UserJot changelog / updates](https://feedback.userjot.com/updates)
- [Member roles](https://userjot.com/support/member-roles), [moderation](https://userjot.com/support/moderate-content), [triage](https://userjot.com/support/manage-requests), [plan work](https://userjot.com/support/plan-work), [publish updates](https://userjot.com/support/publish-updates), [notify subscribers](https://userjot.com/support/notify-subscribers)
- [Conversations overview](https://userjot.com/support/conversations-overview), [inbox](https://userjot.com/support/conversations-inbox), [replies](https://userjot.com/support/reply-to-conversations), [email forwarding](https://userjot.com/support/conversations-email-forwarding), [operators](https://userjot.com/support/operators-and-availability)
- [Meet Juno](https://userjot.com/support/meet-juno), [teach Juno](https://userjot.com/support/teach-juno), [Juno and feedback requests](https://userjot.com/support/juno-feedback-requests)
- [Private boards](https://userjot.com/support/private-boards), [guest feedback](https://userjot.com/support/guest-feedback), [merge duplicates](https://userjot.com/support/merge-duplicates), [trending](https://userjot.com/support/how-trending-works), [sharing](https://userjot.com/support/share-your-board)
- [Branding](https://userjot.com/support/customize-branding), [localization](https://userjot.com/support/fixed-language), [mask identities](https://userjot.com/support/mask-public-identities), [CSV import](https://userjot.com/support/import-from-csv)

Herald implementation references:

- [README.md](README.md) — current product status, schema, permissions, scheduled publishing.
- `src/db/schema/` — existing tables and invariants.
- `src/features/releases/publisher.ts` — transactional, idempotent publishing.
- `src/app/api/cron/publish-releases/route.ts` — protected cron pattern.
- `src/lib/permissions.ts` — role matrix to extend.
- `src/features/live/snapshot.ts` — current dashboard snapshot; public surfaces must not reuse it directly.

---

**Next action:** review the open decisions in §15, then start Phase 0 using the concrete day-by-day sequence in [HERALD_PLAN.md](HERALD_PLAN.md) §7. The first PR should be the customer/board schema plus the public tenant resolver and integration-test harness, because every later phase depends on that boundary being correct.
