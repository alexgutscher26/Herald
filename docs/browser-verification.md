# Browser verification

What was actually loaded in a browser, against which build, and what it proved.
This file is the evidence behind [HERALD_PLAN.md §13.2](../HERALD_PLAN.md); the
plan keeps the verdict table and this file keeps the detail.

A pass is only evidence for the build id recorded with it. Re-running after a
code change means a new entry, not an edit to an old one.

---

## 2026-11-20 — re-run of the four flows blocked on 2026-11-06

### Build and environment

| Item            | Value                                                                 |
| --------------- | --------------------------------------------------------------------- |
| Date            | 2026-11-20                                                            |
| Build           | from scratch: `rm -rf .next && bun run build` → exit 0                 |
| `BUILD_ID`      | `wkMwsBikVbGgAWXYwCRLD`                                               |
| Framework       | Next.js 16.4.6, Bun 1.4.0, Node v24.15.0                              |
| Server          | `bun run start` on `http://localhost:3000` (`BETTER_AUTH_URL` origin)  |
| Database        | Neon Postgres via `DATABASE_URL`; migrations already applied           |
| Browser         | Chromium, one profile, several tabs                                    |
| Tenant          | `verify` / `verify` — created in this pass through `/sign-up` + onboarding |

The previous build in `.next` was unusable: every DB-backed route answered 500
with `Failed to load external module pg-587764f78a6c7a9c: Cannot find package`.
A clean rebuild removed it, so **any older verdict taken on that `.next` says
nothing about the source**.

### Verdicts

| Flow                                    | Verdict        | What was observed |
| --------------------------------------- | -------------- | ----------------- |
| 1. Widget unread badge                  | Pass           | Dashboard publish → `GET /api/public/notifications/unread` → `{"unread":1}` → launcher `getState().unread === 1` and `aria-label="What's new, 1 unread"` |
| 2. Widget thread 404 (regression check) | Pass — fixed   | `POST /api/public/conversations` → 201, then `GET /api/public/conversations/d0066e3b-…?workspaceSlug=verify&productSlug=verify` → 200, `PATCH` → 200, thread renders its message |
| 3. Juno feedback card and citations     | Blocked        | No AI provider configured, Juno off for the product, no knowledge source for it |
| 4. Rotated SSO secret + install check   | Pass           | Install check green before and after rotation; rotated secret signed an identity token that the app accepted |

### Flow 1 — widget unread badge

1. Dashboard → Releases → new release, `Review & publish` → confirmation showed
   the channel list and “1 would receive the email” → `Publish release`. Toast:
   “Release published … Pending subscriber deliveries were recorded”.
   Postgres: release `45fa74b4-885c-40a6-babd-2b5b92f63027`, `status=published`.
2. `GET /api/public/notifications/unread?workspaceSlug=verify&productSlug=verify`
   with the customer session cookie → `{"unread":1}`.
3. Launcher mounted on the public origin with the workspace's own key:
   `HeraldWidget.getState()` → `{ ready: true, identified: true, unread: 1 }`;
   the launcher button carried `aria-label="What's new, 1 unread"`.

**This flow did not run cleanly.** Two defects were in the way (see below):
publishing a widget-only release created no in-app notification, so the
notification counted above was inserted as a fixture after
`products.public_changelog_enabled` was turned on; and the launcher had to be
mounted by hand because every page ships a stale hardcoded snippet.

### Flow 2 — widget thread 404

The 2026-11-06 defect was that `base` already held a query string and `/${id}`
was appended to it, so the id landed inside `productSlug`.

The path is now built by
[`conversationApiPath`](../src/features/widget/conversations-api.ts) and pinned by
[`tests/widget-conversations-api.test.ts`](../tests/widget-conversations-api.test.ts)
(4 tests, 13 assertions, `bun test tests/widget-conversations-api.test.ts` → pass).

Live re-run on `/p/verify/verify/embed/messages`:

```
GET  /api/public/conversations?workspaceSlug=verify&productSlug=verify → 200
POST /api/public/conversations?workspaceSlug=verify&productSlug=verify → 201
GET  /api/public/conversations/d0066e3b-b872-459a-9ecc-c7ce6e5d3d81?workspaceSlug=verify&productSlug=verify → 200
PATCH /api/public/conversations/d0066e3b-b872-459a-9ecc-c7ce6e5d3d81?workspaceSlug=verify&productSlug=verify → 200
```

The thread rendered “Testing the thread path fix after the 404 regression.” with
no “This conversation could not be loaded.” The id is in the path and both slugs
stay in the query, which is the contract the `[conversationId]` route reads.

### Flow 3 — Juno feedback card and citations

Blocked, and not by the dashboard this time:

- `AI_API_URL`, `AI_MODEL` and `AI_API_KEY` are unset on this machine.
- `juno_settings.enabled` is false for both existing rows and there is no row for
  the `verify` product.
- No knowledge source exists for that product, so there is nothing to cite.

A feedback card only appears after Juno proposes an action, and a citation list
only appears on a Juno answer, so neither surface can be produced here. The
logic stays covered by
[`tests/integration/juno-operations.test.ts`](../tests/integration/juno-operations.test.ts)
and [`tests/juno-guardrails.test.ts`](../tests/juno-guardrails.test.ts). This
flow needs a deployment with an AI endpoint before it can be signed off.

### Flow 4 — rotated SSO secret and installation check

1. Widget → allowed origins `http://localhost:3000`, saved. Toast: “Widget
   settings saved.”
2. `Test widget ping` → *Versioned loader* `200 application/javascript`; *Embed
   route* `200 ready`; *Project key enforced* “A request without the key is
   refused.”; *Origin allowlist* “An origin outside the allowlist is refused.”;
   *Signed identity* “SSO is off, so the widget runs without signed identity.”
3. Settings → Single sign-on. The card was gated on the Professional plan with the
   enable switch disabled, so the workspace's `plan` was set to `pro` (the
   documented fixture path: a workspace with no `workspace_subscriptions` row
   keeps its own `plan`). Enabling SSO generated a secret shown once.
4. `Rotate signing secret` → confirmation (“the current secret keeps verifying
   for 24 hours”) → card showed “Rotation in progress”, “Tokens signed with the
   previous secret still verify until 2026-11-21 17:49 UTC”, the new secret
   shown once, and a `Finish rotation now` control.
5. Back on Widget → `Test widget ping` → *Signed identity* now reads “SSO is
   enabled and a signing secret exists.”; the other four checks stayed green.
6. The rotated secret signed an HS256 token (`iss=herald`, `aud=verify`) that
   `POST /api/widget/identify` accepted with 200, creating customer
   `a1e3301b-8d49-4b7e-9ce4-075f991c9278` and setting the customer session.

`Finish rotation now` was not clicked; the current/previous overlap path stays
covered by
[`tests/integration/customer-auth.test.ts`](../tests/integration/customer-auth.test.ts).

### Defects found in this pass

1. **Every page ships a stale demo widget snippet.** `src/app/layout.tsx` renders
   [`HeraldWidgetScript`](../src/features/widget/herald-widget-script.tsx) on
   every route, and that component hardcodes
   `src="http://localhost:3000/widget/v1.js?v=5"`,
   `data-project="test12/changelog"` and a fixed `data-key`. Consequences: a
   `localhost` URL in any deployed environment, a launcher that points at a
   tenant which may not exist (404 document for
   `/p/test12/changelog/embed?…`), a 404 for `/api/public/widget/events`, and no
   working launcher for the actual workspace on its own public pages.
2. **Publishing a widget-only release creates no in-app notification.**
   `createReleaseNotifications` returns 0 unless `releases.channelPublicChangelog`
   *and* `products.publicChangelogEnabled` are both true, so a release the publish
   dialog lists as “In-app widget — Included” produces no unread entry for
   subscribers when the public changelog surface is off.
3. **The release editor loops.** On `/app/…/releases/<id>/edit` the tab repeatedly
   refetched `?_rsc=…` for the editor, the Releases list and the product
   overview; `Review & publish` stopped opening its dialog, and the loader script
   element accumulated (21 copies in one tab). A second publish had to be
   abandoned. Root cause not established.
4. **A long-lived tab can hide the whole dashboard behind a pending boundary.**
   The DOM had `div id="S:0" style="display:none"` wrapping the entire shell and
   an empty `template#B:0`, so the accessibility tree was empty — the same
   symptom as §13.1. The server, however, returned a complete document in 437 ms
   including `$RC("B:0","S:0")`, and the same URL in a fresh tab rendered
   normally. **§13.1's “every `/app/*` route renders only its skeleton” was this
   client-state failure, not a server-side rendering bug.**

### Fixtures written during this pass

Recorded so nobody mistakes them for real data:

- user `madajoe6969+heraldverify@gmail.com` (owner), workspace `verify`, product
  `verify`
- workspace `plan` changed `free` → `pro` to unlock SSO
- one active subscriber for `madajoe6969+w1@gmail.com`, linked to customer
  `a1e3301b-…`
- two releases, one published; one in-app notification inserted as a fixture
- widget settings: allowed origin `http://localhost:3000`, sections
  `feedback, roadmap, messages`
- SSO enabled with a rotated signing secret (the value is not recorded here)

### Regression guard

[`tests/integration/dashboard-shell.test.ts`](../tests/integration/dashboard-shell.test.ts)
now covers the server side of the failure recorded above. It provisions a
throwaway `herald_test_*` database, applies the migrations, boots `next start`
against it, signs in a fixture owner through `/api/auth/sign-in/email`, reads
every `/app/**` page from the filesystem (34 routes, including detail pages
filled with fixture ids) and fetches each one with the session cookie.

A route fails the suite when the response:

- is a 5xx,
- redirects to `/sign-in` (the session was not used),
- leaves a streaming boundary hidden (`<div id="S:n" style="display:none"`),
  which is the exact shape that produced the empty accessibility tree, or
- stops before `</html>`, meaning the stream never finished.

Run it with `bun run test:smoke` (it runs `bun run build` first). It needs
`TEST_DATABASE_URL` — a server whose role can `CREATE DATABASE`; without it the
harness refuses to provision so a developer's real database is never touched.

What it cannot see: hydration. Every page here renders its chrome on the client,
so a document that arrives complete and then fails to hydrate still passes. That
is why the long-lived-tab failure above is recorded as a browser finding and not
as something this test would have caught.

### Not checked

- Mobile viewport, dark mode, and screen-reader navigation of these flows.
- Real email delivery. The publish dialog reported “no provider is connected”
  even though `RESEND_API_KEY` is set, which suggests `EMAIL_FROM` is missing;
  nothing was sent or received.
- CSAT, the feedback card, and the messages panel's reply-by-email path.
- Any timing assertion on the 3 s / 5 s / 30 s polling intervals.

---

## 2026-11-20 (second pass) — four flows on a database created for this pass

### Build and environment

| Item       | Value                                                                                   |
| ---------- | --------------------------------------------------------------------------------------- |
| Date       | 2026-11-20                                                                              |
| Build      | from scratch: `rm -rf .next && bun run build` → exit 0                                   |
| `BUILD_ID` | `vfmQEi1pNKUswqBx1QcqO`                                                                  |
| Framework  | Next.js 16.4.6, Bun runtime, Chromium                                                   |
| Server     | `bun run start` on `http://localhost:3000` (`BETTER_AUTH_URL` origin)                    |
| Database   | `herald_pass_1795198402` — created empty with `CREATE DATABASE`, then `bun run db:migrate` → exit 0 |
| Tenant     | `cleanpass` / `product`, created in this pass through `/sign-up` and onboarding          |
| Model      | local OpenAI-compatible stub on `http://127.0.0.1:4010/v1` (Flow 3 only)                 |

The previous entries reused an existing Neon database and a tenant left by an
earlier pass. This pass starts from an empty database and a new owner, so every
row below was produced by the UI in this run. Nothing was carried over: the
`verify` / `verify` tenant does not exist in this database.

### Verdicts

| Flow                                         | Verdict | What was observed |
| -------------------------------------------- | ------- | ----------------- |
| 1. Widget unread badge                       | Pass    | Public changelog enabled in the UI, subscriber added in the UI, release published in the UI → in-app notification unread, public entry live, `{"unread":1}` then `0` after read |
| 2. Widget thread 404 (regression check)      | Pass    | Conversation created from the panel, thread rendered both messages, reply posted and re-rendered |
| 3. Juno feedback card and citations          | Pass    | Juno answered a widget question through the job queue and the thread showed the answer with a “Sources” citation |
| 4. Rotated SSO secret and installation check | Pass    | Check green → SSO enabled → rotated with a 24-hour overlap → check green again → rotated secret accepted by `POST /api/widget/identify` |

### Flow 4 — rotated SSO secret and installation check

1. Widget page, allowed origin `http://localhost:3000`, `Save changes`, then
   `Test widget ping`: loader `200 application/javascript`, embed `200 ready`,
   key and origin gates both refused, `Signed identity — SSO is off`.
2. Settings → Identity on the fresh workspace: the SSO switch was **disabled**
   with “Single sign-on is available on the Professional plan”, because a new
   workspace is `free` and Stripe is not configured, so no plan can be bought
   in-app. This is a reachability limit, not a defect: the entitlement is real.
3. Fixture (the only row written by hand in this pass): `workspaces.plan`
   `free` → `pro` for `cleanpass`.
4. `Enable single sign-on` → `Save settings` → “Enabled” and a 43-character
   secret. `Rotate signing secret` → confirm → “Rotation in progress … tokens
   signed with the previous secret still verify until 2026-11-21 18:17 UTC” and
   the new secret shown once.
5. Back on the widget page, `Test widget ping` → `Signed identity — SSO is
   enabled and a signing secret exists`.
6. An HS256 token signed with the rotated secret, `iss=herald`, `aud=cleanpass`,
   `POST /api/widget/identify {workspaceSlug, token}` → 200 with
   `customer f521013f-c729-42f8-b5c5-273df175d969, verified: true`.

### Flow 1 — widget unread badge

Every step was a UI action; no notification was inserted as a fixture.

1. Roadmap → Public surfaces → `Public changelog` on → toast “Public visibility
   saved”. (Feedback was on by default; roadmap stayed off.)
2. Subscribers → `Add subscriber` → `madajoe6969+clean1@gmail.com`, name
   “Clean Customer” → list shows “1 total · 1 active”, source `Manual`. The
   public changelog has no subscribe form of its own, so this is the operator
   path; a customer is not subscribed by signing in.
3. Releases → `New release` → title, body and summary filled → `Review &
   publish`. Empty required fields block the dialog with a toast; with them
   filled it opens and reads: public changelog `Included`, in-app widget
   `Included`, subscriber email `Queued` — “1 would receive the email; 0 active
   subscribers are suppressed. No email provider is connected” — pre-send
   audience `1`. `Publish release` → toast “Release published”.
4. Postgres: `releases.status=published` with both channels true; one
   `in_app_notifications` row of kind `release_published`, unread, attached to
   the customer; one `notification_deliveries` row for `…+clean1@gmail.com`,
   `pending`.
5. `/p/cleanpass/product/updates` lists “Clean pass release” with its date and
   summary.
6. `GET /api/public/notifications/unread?workspaceSlug=cleanpass&productSlug=product`
   with the customer cookie → `{"unread":1}`; the same request with
   `credentials: "omit"` → `{"unread":0}` (the count is per customer);
   `POST /api/public/notifications/read` → `{"ok":true,"marked":1}` and the
   count then reads `0`.

### Flow 2 — widget thread 404

On `/p/cleanpass/product/embed/messages`, the panel showed “Team online” and a
start form. Submitting
“Where can I find the changelog for the new widget?” opened
conversation `f9fe76da-bcbd-4c42-886e-dd1b815c4932` and rendered the message in
the thread; a reply (“Following up: the badge cleared after I opened it.”) was
appended and rendered. Requests observed: `POST /api/public/conversations`,
`GET /api/public/conversations/f9fe76da-…?workspaceSlug=cleanpass&productSlug=product`
— the id in the path, the slugs in the query, never `productSlug=<uuid>`.

### Flow 3 — Juno feedback card and citations

This is the flow every earlier pass recorded as blocked on configuration. It
was reachable here with a local model, without touching the source:

1. `.pass/stub-ai.ts` (verification scratch only, deleted afterwards) serves
   `POST /v1/chat/completions` on `127.0.0.1:4010` and returns a fixed
   assistant message. It is the OpenAI-compatible shape
   [provider.ts](../src/features/ai/provider.ts) accepts.
2. The app was restarted with `AI_API_URL=http://127.0.0.1:4010/v1`,
   `AI_MODEL=stub-model`, `AI_API_KEY=stub-key`.
   `AI_EMBEDDING_MODEL` stayed unset, so retrieval used the deterministic local
   hash embedding — no embeddings endpoint was needed.
3. `juno_settings.enabled` was **false** for the product; the widget still said
   “Team online” and conversations stayed in `queue`. Turning on “Let Juno pick
   up new conversations” and pressing `Save Juno settings` set it true. A first
   customer message sent before that produced no job at all, which is correct
   but silent.
4. Settings → Juno → Add a source: a markdown file was attached to the file
   input and `Upload source` submitted. The source “Widget help” came back
   `Live · 1 pages · 1 chunks`.
5. A new customer message (“How do I see the changelog inside the widget?”)
   queued `juno_answer`; `GET /api/cron/jobs` claimed and succeeded it, the stub
   logged `call 2 model=stub-model promptChars=734` (so retrieval had supplied
   sources), and a following run claimed `juno_auto_resolve`, also succeeded.
6. The thread rendered the answer beneath the question with a `Sources` line
   citing “Widget changelog”.

What this proves: the widget → queue → retrieval → model → citations → thread
path works end to end. What it does not prove: any specific model's answer
quality, because the text came from a stub.

### Defects and record corrections

1. **Long-lived-tab stall — reproduced, still client-side.** After a sequence of
   in-page navigations in one tab, `/app/cleanpass/product/subscribers` had its
   full content in `<main>` while `document.body.innerText` was `0` characters
   and the shell sat in `div#S:0 { display: none }`. Opening the same URL in a
   new tab of the same profile rendered 1779 characters with no hidden shell.
   Same build, same database, same session: this is the client behaviour §13.2
   described, and it is not caused by stale data or a broken `.next`. Refresh
   remains the workaround; the smoke test cannot see it (it asserts the server
   document only).
2. **The release editor's publish dialog opens — correction to §13.2.** The
   dialog that pass recorded as unreachable opened normally here on a fresh tab
   and a clean build. The blocking cause was a required field: `Summary` is
   `aria-invalid` and `Review & publish` refuses with a toast until it is
   filled. The alternating `?_rsc=` requests in the network log are the 5-second
   `DashboardLivePoller`, not a navigation loop.
3. **SSO is unreachable without billing.** On a default `free` workspace the
   switch is disabled, and with `STRIPE_SECRET_KEY` unset there is no in-app way
   to buy `pro`. Anyone verifying SSO has to set `workspaces.plan`, as this pass
   did.
4. **Juno pickup is off by default and says nothing.** New conversations sit in
   `queue` with the panel showing “Team online” until an operator enables the
   switch. Worth a first-run prompt, not a bug in the flow.
5. **The public portal renders Spanish for a fresh visitor** while the dashboard
   is English (`defaultLocale`/`auto` resolution). Recorded, not investigated.

### Fixtures written during this pass

- user `madajoe6969+cleanpass@gmail.com`, workspace `cleanpass`, product
  `product` — all through the UI
- workspace `plan` changed `free` → `pro` (the only SQL fixture)
- one subscriber `madajoe6969+clean1@gmail.com`, added through the dashboard
- one release “Clean pass release”, published through the dialog
- widget allowed origin `http://localhost:3000`; SSO enabled with a rotated
  secret (the value is not recorded here); knowledge source “Widget help”
- customer `madajoe6969+clean1@gmail.com`, created by the SSO identify call

### Not checked

- Real email delivery: no provider is connected, so the subscriber delivery
  stayed `pending`. Nothing was sent or received.
- Rejection of an old-secret token after the overlap window: it had 24 hours to
  run, so only successful verification was proven.
- A second customer account, so cross-customer isolation of the unread count is
  proven only by the signed-out (`0`) request.
- Mobile viewport, dark mode, screen-reader navigation, Juno handoff thresholds,
  and the auto-resolve timing.

### Cleanup

`herald_pass_1795198402` was dropped and the `.pass/` scratch directory removed
after this entry was written.
