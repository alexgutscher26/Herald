# Herald — positioning and packaging

**Status:** decision doc; steps 1–3 shipped 2026-11-20
**Date:** 2026-11-20
**Supersedes:** the price-led framing on the landing page ("for less than Featurebase")
**Read with:** [HERALD_PLAN.md](../HERALD_PLAN.md) §12 (decisions), [plan.md](../plan.md) §4 (UserJot inventory)

---

## 1. The problem with the current story

The landing page sells on price: *"The whole customer loop, for less than Featurebase"*, *"Cheaper than Featurebase"*, `$19` in the H2. That is a thin claim for three reasons.

1. **The free tiers are close enough that price is not the switch trigger.** UserJot's free plan already includes unlimited posts, unlimited users, 3 admins, 2 boards, a roadmap and a changelog. Herald's free plan is the same shape: no post cap in `PLAN_LIMITS`, 3 paid members (viewers free), 2 boards per product, public feedback, roadmap, changelog, widget and win-back. Someone on UserJot free has little reason to move for a slightly cheaper paid tier.
2. **What people actually pay for is narrow.** The pay triggers are custom domain, private boards and guest posting. UserJot charges $29 for those; FeedBear charges $15 per project. A $10 delta on a $29 product does not repay a migration.
3. **"Cheaper than Featurebase" is aimed at the wrong competitor.** The comparison table on the landing page is entirely Featurebase. The product the research actually measures against is UserJot, and the FAQ never mentions it.

Price can be *proof* of a structural claim. It cannot be the claim.

## 2. What Herald already has (verified in code)

| Claim | Reality | Evidence |
| --- | --- | --- |
| Free plan is a real loop | Public feedback, status-driven roadmap, changelog, widget, help, surveys, tours and win-back are all on `free`; the only free caps are 1 product, 2 boards per product, 3 paid members and 500 emails/month | `src/features/entitlements/plans.ts` |
| The paid triggers are already below UserJot | `starter` includes custom domains, private boards, guest posting, custom branding and hiding attribution | `PLANS.starter.features` |
| Custom domain is built, not a promise | Hostname validation, DNS TXT ownership check, entitlement gate and a readiness check over HTTPS | `src/features/workspace-settings/domains.ts`, `domain-settings-view.tsx` |
| Prices are per workspace, flat | No per-seat lever; viewers are free and uncounted | `plans.ts`, `HERALD_PLAN.md` §12 D8 |
| An agent surface exists | Stateless remote MCP at `/api/mcp` with 20+ tools (requests, comments, votes, changelogs, conversations, internal notes) plus six documented agent routines | `src/features/mcp/catalog.ts`, `docs/headless-routines.md` |

So the "$19 includes what UserJot charges $29 for" claim is true today. It is also not enough on its own — which is the point of the four angles.

## 3. The four angles, assessed

| # | Angle | Verdict | Why |
| --- | --- | --- | --- |
| 1 | Put the paid features on a lower tier | **Already true; price level is the only open question** | Custom domain, private boards and guest posting sit on Starter at $19 ($15 yearly). The gap to UserJot's $29 is real but small. Lowering the number is a Stripe price plus one constant, not a product change — and it does not create a reason to switch. |
| 2 | Go narrower (solo indie, one tool, nothing else) | **Use as audience language, not as scope** | The product already ships a help center, surveys, tours, API docs, chat and AI. Cutting those to look narrow throws away the "one tool instead of five" story and the comparison table. Say "for people who run small products", keep the surface. |
| 3 | One account, many products | **Strongest structural wedge — shipped 2026-11-20** | The catalogue sold 1 / 3 / 10 products and the switcher rendered multiple, but the only `insert(products)` was in onboarding; there was no create-product path and `checkWorkspaceLimit(workspaceId, "products")` had no callers. Step 1 below closes that: a create-product action, the allowance enforced in the shared service, a settings form and list, a switcher entry, and the default `feedback` board in the same transaction. Competitors price per project; this is the one axis where a flat account fee means something concrete. |
| 4 | Agent-friendly (feedback → todo or PRD) | **Strongest artifact wedge — shipped 2026-11-20** | UserJot also ships an MCP server and API, so MCP parity is table stakes. The artifact was missing: one request plus its voters, insights, public comments, tags and linked releases turned into deterministic Markdown an agent can paste into a todo or PRD. `src/features/feedback/brief.ts` builds it once; the request detail, `GET /api/v1/requests/{id}/brief` and the MCP `get_request_brief` tool all render the same text. |

## 4. Recommendation

**Lead with angles 3 and 4. Keep angle 1 as proof. Use angle 2 as the audience, not the feature list.**

> Herald is the feedback tool for people who run several products: every product's board, roadmap and changelog under one account, and a request brief your coding agent can turn straight into a ticket.

That sentence makes "cheaper" specific: *five products for what other tools charge for one project*, plus an agent workflow that per-project tools cannot offer without the same consolidation.

### Packaging proposal

| | Free | Indie | Pro |
| --- | --- | --- | --- |
| Price | $0 | **$15/mo, $12/mo yearly** | $39/mo, $31/mo yearly |
| Products | 1 | **5** (was 3) | **Unlimited** (was 10) |
| Boards per product | 2 | 5 | Unlimited |
| Paid members | 3 | 10 | 25 |
| Emails / month | 500 | 5,000 | 20,000 |
| Custom domain, private boards, guest posting, branding | — | Included | Included |
| API + MCP, Mira, SSO, advanced search | — | — | Included |

The specific claim this buys: **FeedBear POWER is $15 for one project; Herald Indie is $15 for five, on one login.** That is a cheaper that means something.

> **Shipped note (2026-11-20):** Step 3 shipped the Indie name and the 5 / unlimited product allowances at the **current** $19 / $39 prices. It did not change what customers are charged: a price move needs a new Stripe price, a migration for existing subscribers and the display constant in one change, and that billing work is still open. The $15 row above is the target for that change, not the current charge.

Two cautions:

- `STRIPE_PRICE_STARTER` / `STRIPE_PRICE_PRO` are the source of truth for what is charged; `PLAN_PRICING` in `plans.ts` supplies the displayed price to the plan cards and the pricing table. A price change needs a **new** Stripe price, a migration for existing subscribers, and the display value updated in the same change. Do not edit the display value alone.
- Unlimited products on Pro is a packaging claim, not a cost claim. Boards, emails and AI are the real cost meters and they already have caps. Do not make products unlimited on Indie — that cannibalises Pro for no additional revenue.

## 5. Build order

Do not change the pricing page before the capabilities exist; the current page already promises products nobody can create.

### Step 1 — Make multi-product real (shipped 2026-11-20)

- `createProductAction` beside the existing onboarding insert, gated by `settings:manage`, enforcing `checkWorkspaceLimit(workspaceId, "products")` with the typed upgrade message.
- A "New product" entry in workspace settings where the empty-state copy already lives (`workspace-settings-view.tsx` around line 1463), and an entry in `WorkspaceProductSwitcher` so the switcher is not a dead end.
- Revalidate the workspace shell and redirect into the new product; give it the default `feedback` board, exactly like onboarding does.
- Tests: `tests/integration/product-create.test.ts` covers the default board, the Free cap, another product on Professional, the duplicate-slug field error and per-workspace slug scoping. Permission enforcement is the existing `product:create` gate in `createProductAction`, covered by the permissions suite.

### Step 2 — Ship the request brief (shipped 2026-11-20)

- One pure builder (`src/features/feedback/brief.ts`) that takes a request, its voters, insights, public comments, tags and linked releases and returns stable Markdown: problem, evidence quotes with source and date, demand (votes, segments), current status, open questions.
- Expose it three ways from that single builder: a "Copy brief" action in the request detail, `GET /api/v1/requests/{id}/brief`, and an MCP read tool `get_request_brief`.
- Add routine 7 to `docs/headless-routines.md` ("Turn a request into a PRD draft; do not create the ticket without a human").
- Tests: snapshot of the Markdown for a fixture request; internal notes and author email never appear; tenant scoping.

### Step 3 — Repackage and rewrite the story (shipped 2026-11-20)

- `plans.ts`: rename `starter` display name to Indie, products 3 → 5, Pro products 10 → unlimited. Update `FEATUREBASE_BENCHMARK` alongside it so the comparison cannot go stale.
- Landing page: replace the price-led hero and the "Cheaper than Featurebase" H2 with the multi-product + brief story; move Featurebase to a secondary comparison and add a factual UserJot row with a dated source.
- FAQ: answer "How is this different from UserJot?" honestly — same loop, five products on one account at $19, a brief built for agents; UserJot is the better choice if you run one product and never use an agent.
- Keep the free plan as it is. A crippled free tier raises switching cost at exactly the moment someone is evaluating.

## 6. What not to do

- **Do not lead with a competitor's price.** It invites the comparison on their terms and ages badly; competitors change prices and the page becomes false.
- **Do not claim agent superiority over UserJot.** They ship an MCP server and API. Claim the artifact (the brief), which is checkable.
- **Do not add per-seat pricing or metered "lite" seats.** `HERALD_PLAN.md` §12 D8 stands; per-seat is what makes the incumbents expensive and it would erase the flat-price story.
- **Do not publish competitor numbers without a dated source.** The research in this conversation is a snapshot (UserJot free plan, $29/$59; FeedBear $15 per project). Re-verify before it goes on a public page, as the landing page already does for Featurebase.
- **The product allowance now matches the product.** Step 1 made the advertised 1 / 3 / 10 reachable and enforced, so the pricing page may keep showing it — do not raise the numbers in copy without the gate changing with them.

## 7. How we will know it worked

| Signal | Why it matters | Target (90 days) |
| --- | --- | --- |
| Paid accounts with 2+ products | The wedge is real, not just copy | 25% |
| Briefs copied or fetched over API/MCP per week | The agent workflow is used, not decorative | 20% of active paid workspaces |
| Requests created via MCP/API | Agents are doing real capture | Tracked weekly |
| Free → Indie conversion | The $15 packaging beats the old $19 | Above the pre-change baseline |
| Indie → Pro upgrades | Unlimited products did not flatten the top tier | No decline |
