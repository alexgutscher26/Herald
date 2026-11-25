# Founding Lifetime — deal design

Status: **implemented, pending operator setup.** The plan, seat ledger, one-time Checkout,
webhook lifecycle, pricing band, billing panel and `/legal/lifetime` terms are in the code. No
Stripe price has been created in this repository: set `STRIPE_PRICE_LIFETIME` to the $499
one-time price before the offer opens. See “Implementation map” below.

Read "LTD" as **lifetime deal**: one payment, no renewal.

## Implementation map

- Schema and 100-seat ledger: `src/db/schema/lifetime.ts`, migration
  `drizzle/0064_*.sql` (seats seeded 1–100).
- Plan and caps: `src/features/entitlements/plans.ts` (`PLANS.lifetime`,
  `monthlyJunoReplies: 150`), `PLAN_ORDER` intentionally unchanged.
- Checkout and seat reservation: `src/features/billing/lifetime.ts`,
  `src/features/billing/stripe.ts`, `src/features/billing/actions.ts`.
- Webhook grant, expiry, refund and subscription guard:
  `src/features/billing/lifetime.ts`, called before the subscription branch in
  `src/features/billing/service.ts`.
- Billing panel: `src/features/workspace-settings/workspace-settings-view.tsx`.
- Offer band and signed-out handoff: `src/features/marketing/lifetime-offer.tsx`,
  `/pricing`, `/sign-up?offer=lifetime`, onboarding → Billing.
- Terms: `/legal/lifetime`.
- Mira cap: `src/features/juno/answer.ts` counts answered conversations per UTC
  calendar month and hands off with reason `quota`.
- Unit coverage: `tests/entitlements.test.ts`. Integration cases (they need a
  loopback Postgres; writing them does not make them pass):
  `tests/integration/billing.test.ts` (grant, replay, expiry, full/partial
  refund, subscription guard, no switching, one seat per purchaser, sold out).

Still operator-owned: create the $499 one-time Stripe price, set
`STRIPE_PRICE_LIFETIME`, register the webhook events, and run the Stripe
test-mode pass in §6.6.

## 1. The decision

Sell **one** offer, not a tier ladder:

> **Founding Lifetime — $499 once, 100 workspaces.**
>
> Unlimited products, boards and integrations. 15 paid teammates. 5,000 emails and 150 Mira
> replies a month. API, MCP, request briefs, advanced search, guest posting, private boards,
> custom domain and branding. No SSO. No renewal, no seats to count, 30-day refund.

One price is the point. A two-tier lifetime ladder ("Indie lifetime / Pro lifetime") makes the
buyer compare three ways, doubles the Stripe and entitlement surface, and produces the worst
outcome: the cheap tier cannibalises the subscription and the expensive tier does not sell.

The seat count is a ceiling, not a forecast. Twenty-five sales is a good launch; one hundred is
the maximum exposure we are willing to carry.

## 2. Why this shape

Herald's subscription anchor is Professional at $39/month ($31/month billed yearly). A lifetime
deal has to be obviously cheaper than a few years of that, and still not be a permanent loss.

| Against Professional list price | Cost | Lifetime saves |
| --- | --- | --- |
| 1 year, monthly | $468 | — |
| 1 year, yearly | $372 | — |
| 3 years, monthly | $1,404 | $905 (64%) |
| 3 years, yearly | $1,116 | $617 (55%) |

$499 is **12.8 months of Professional monthly** and **1.34× one year of Professional yearly**.
That is aggressive for a lifetime, which is why the caps below are lower than Professional's:
5,000 emails instead of 20,000, 150 Mira replies instead of no metered cap, 15 members instead
of 25, and no SSO. The buyer gets the expensive-to-build parts — unlimited products, the API,
request briefs, advanced search — without us underwriting unlimited email and model usage
forever.

What it is **not**:

- not a fourth pricing card. The pricing switcher is monthly/yearly; lifetime is neither, and a
  fourth column breaks the three-plan comparison. It gets its own band below the cards.
- not an AppSumo listing. A 70% revenue share plus a deeper discount turns a capped deal into a
  loss and fills support with non-ICP buyers.
- not available to active subscribers. They already have a fair price, and mixing a one-time
  payment with a running subscription creates proration and refund edge cases with no upside.

### The one-line positioning

> **Pay once. Keep the loop.** For the agency or small team that runs several products and does
> not want another subscription to justify every month.

This is the same wedge as the rest of the site — products, not board slots — with a payment
shape that fits a customer who intends to stay.

## 3. What is included

| | Free | Indie | Professional | **Founding Lifetime** |
| --- | --- | --- | --- | --- |
| Price | $0 | $19/mo | $39/mo | **$499 once** |
| Products | 1 | 5 | unlimited | **unlimited** |
| Boards per product | 2 | 5 | unlimited | **unlimited** |
| Paid members | 3 | 10 | 25 | **15** |
| Emails / month | 500 | 5,000 | 20,000 | **5,000** |
| Mira replies / month | — | — | no metered cap | **150** |
| Integrations | 1 | 1 | unlimited | **unlimited** |
| API + MCP + request brief | — | — | yes | **yes** |
| Advanced search | — | — | yes | **yes** |
| Guest posting, private boards | — | yes | yes | **yes** |
| Custom domain + branding | — | yes | yes | **yes** |
| Hide attribution | — | yes | yes | **yes** |
| SSO, SCIM, identity masking | — | — | yes | **no** |
| Renewal | — | monthly/yearly | monthly/yearly | **none** |

Viewers stay free and uncounted, as on every other plan. The lifetime plan uses the same
`PLAN_LIMITS` and `PLAN_FEATURES` machinery as the others; it is a plan, not a coupon.

**Why SSO is excluded.** SSO is not expensive because of storage; it is expensive because every
connection is an integration and a support relationship. A one-time payment cannot fund an
indefinite identity-provider commitment. Say so plainly at checkout rather than hiding it in a
fair-use clause.

**Why Mira is capped.** It is the only per-use model cost in the product. 150 replies is enough
to use the feature, not enough to resell it. The cap is cost-based: at an assumed $0.02 per
reply it is $3/month. If the measured cost is higher, lower the cap or raise the price before
launch — do not ship an uncapped lifetime AI allowance.

**Future features.** Included when they ship to Professional and have no direct per-use cost.
A future metered feature gets its own lifetime allowance or is excluded. This is stated on the
offer page; "all future features forever" is not promised.

## 4. Terms, in the language the buyer sees

1. **$499 once, plus tax.** No renewal, no seat count, no per-product fee.
2. **One workspace.** Applies to the workspace you buy it for. One lifetime purchase per
   account; additional workspaces use normal plans. Not transferable or resellable.
3. **100 workspaces.** Seat numbers are assigned at payment. When they are gone the offer
   closes; it is not extended and there is no waitlist.
4. **The caps are the deal.** 15 paid members, 5,000 emails and 150 Mira replies per month.
   Unused allowance does not roll over. Hitting a cap pauses that feature until the next month;
   there is no automatic overage charge.
5. **30-day refund, no questions.** After 30 days, no refund, except the shutdown promise below.
6. **Lifetime means the life of Herald, not yours.** If the service is discontinued, you get at
   least 12 months' notice, a full export, and — if that happens within 36 months of purchase —
   a refund of the unused share on a straight-line 36-month basis.
7. **Same support queue, best effort.** No SLA and no priority promise. The plan includes the
   product, not a named contact.
8. **No switching.** A lifetime workspace cannot move to a subscription for a refund, and an
   active subscriber cannot trade a subscription for lifetime. Buy it for a Free workspace.

These terms go on `/legal/lifetime` (linked from checkout and the receipt), not only in this
document.

## 5. Economics

Gross at 100 seats: **$49,900**. Stripe at 2.9% + $0.30: **$1,477**. Net: **$48,423** before
tax (Stripe Tax collects and remits tax separately).

Per-account monthly cost assumptions, deliberately blunt:

| Scenario | Infra | Email | Mira | Support | Total / month |
| --- | --- | --- | --- | --- | --- |
| Lean (p50) | $0.50 | $0.25 | $0.75 | $1.00 | **$2.50** |
| Base (p75) | $1.00 | $0.50 | $1.50 | $2.00 | **$5.00** |
| Heavy (p95, at caps) | $1.50 | $2.00 | $3.00 | $2.50 | **$9.00** |

Email assumes $0.40 per 1,000 sends; Mira assumes $0.02 per reply. Both must be measured before
launch.

| Cohort outcome | 36-month COGS | Contribution | Break-even |
| --- | --- | --- | --- |
| Lean | $9,000 | $39,423 | 194 months |
| Base | $18,000 | $30,423 | 97 months |
| Heavy | $32,400 | $16,023 | 54 months |

At five years the heavy cohort costs about **$54,000**, slightly more than net revenue. That is
the tail the 100-seat cap and the monthly caps exist to bound; it is not a reason to believe the
deal loses money, because not every account sits at p95. It is a reason not to sell 1,000 seats
or to remove the Mira cap.

**Accounting discipline.** Book the $499 as deferred revenue and recognise it over 36 months in
management accounts. Put a **$20,000 reserve** aside from the proceeds — roughly 24 months of
base-case COGS plus a refund allowance — and do not use lifetime cash to fund run-rate hiring.
If that sounds overly cautious, the deal is priced too low.

**Refund exposure.** A 5% refund rate costs about $2,500 plus fees. The 30-day window is short
enough that it should stay below that; measure it.

## 6. How it ships

The current billing model is subscription-only: `getWorkspacePlan` reads
`workspace_subscriptions.plan` and treats only `active`/`trialing` as paid. A lifetime purchase
must therefore be a real plan with a real status, not a `pro` subscription without a renewal
date.

### 6.1 Schema

- `src/db/schema/workspaces.ts`: add `"lifetime"` to `workspacePlanEnum`. Postgres enum values
  are forward-only; put `ALTER TYPE "workspace_plan" ADD VALUE 'lifetime'` in its own migration
  and do not use the value in that same transaction.
- New `src/db/schema/lifetime.ts`:
  - `lifetime_deals`: `workspace_id` (PK, FK cascade), `purchaser_user_id`, `seat_number`
    (unique, check 1–100), `stripe_checkout_session_id` (unique), `stripe_payment_intent_id`,
    `amount_cents`, `status` (`reserved` | `active` | `refunded` | `revoked`), `reserved_until`,
    `granted_at`, `refunded_at`, `terms_version`.
  - `lifetime_seats`: 100 pre-seeded rows (`seat_number`, `status`, `reserved_until`,
    `workspace_id`). This is the oversell guard. Reserve with `SELECT … FOR UPDATE SKIP LOCKED
    LIMIT 1` inside the checkout transaction; release expired rows lazily at the start of the
    next reservation. `checkout.session.expired` releases too.
- Partial unique index on `purchaser_user_id` where `status in ('reserved','active')` enforces
  one per account at the database, not just in the action.

### 6.2 Catalogue

- `src/features/entitlements/plans.ts`: add `"lifetime"` to `PLAN_IDS` and `PLANS.lifetime`;
  keep `PLAN_ORDER` as `free/starter/pro` so the pricing cards and benchmark do not grow a
  fourth column. Add a unit test for the caps and the SSO exclusion.
- `src/features/entitlements/entitlements.ts`: treat `"lifetime"` as a paid status in
  `isPaidStatus`. The existing precedence then works: a lifetime subscription row returns the
  lifetime plan even though its status is not a Stripe status.
- TypeScript will force the display maps to acknowledge the new id: `PLAN_NAMES` in
  `billing/service.ts`, `BillingView.plan`, `PLAN_PRICING` in `entitlements/plans.ts`
  (excluded from rendering, but typed), and the plan enum in `api-v1/openapi.ts`.

### 6.3 Checkout

- New one-time Stripe Price, $499, created in the dashboard; env var
  `STRIPE_PRICE_LIFETIME`. Extend `billing/config.ts` validation so a half-configured
  deployment fails closed, not open.
- `startLifetimeCheckout` in `billing/service.ts`:
  - require a Free workspace with no `active`/`trialing` subscription and no active deal;
  - reserve a seat (above) and create a **`mode: "payment"`** Checkout Session with
    `metadata.offer = "lifetime"`, `metadata.workspace_id`, `client_reference_id`,
    `expires_at` equal to the reservation expiry (60 minutes), `invoice_creation.enabled`,
    automatic tax if configured;
  - never attach a trial or a subscription.
- Reject active subscribers with a clear message; `startCheckout` must also reject a lifetime
  workspace so it cannot be subscribed over.

### 6.4 Webhook

Extend `applyStripeEvent` before the subscription branch:

- `checkout.session.completed` with `mode === "payment"`, `metadata.offer === "lifetime"` and
  `payment_status === "paid"`: claim the Stripe event, insert the deal idempotently by session
  id, mark the seat `active`, set `workspaces.plan = 'lifetime'`, and upsert
  `workspace_subscriptions` to `plan = 'lifetime'`, `status = 'lifetime'`, keeping the Stripe
  customer id but **no** subscription id.
- `checkout.session.expired`: release the reservation.
- `charge.refunded` (full refund only): mark the deal `refunded`, release the seat, set the
  workspace back to `free`. Partial refunds do not revoke.
- Guard `customer.subscription.*` events: if the workspace has an active lifetime deal, ignore
  them. A stray cancellation must not downgrade a paid-in-full workspace.
- If payment lands after a reservation expired and the seat is gone, refund automatically and
  email the buyer rather than granting a 101st seat.

Idempotency stays where it is: the `stripe_events` insert and the grant commit in one
transaction, and the unique checkout-session id is a second guard.

### 6.5 UI

- **Landing:** a full-width band after `<PricingCards />` and before `#compare`, not a card.
  Server-render the remaining count from `lifetime_seats`; never fake a timer. Copy:
  > **Founding lifetime.** Pay once. Keep the loop. 100 workspaces, $499 once. Unlimited
  > products and boards, the API and request briefs, advanced search, 15 teammates, 5,000
  > emails and 150 Mira replies a month. No renewal. SSO not included. 30-day refund.
  >
  > **Claim a founding seat — 37 of 100 left.**
- **Signed-out CTA:** `/sign-up?offer=lifetime`; after onboarding, land on Billing with the
  offer highlighted. A signed-in owner with a Free workspace goes straight to checkout.
- **Billing settings:** a lifetime panel with seat number, purchase date, receipt link and the
  caps; no "Manage billing", no plan switcher, no upgrade prompt. Workspace settings show
  "Founding Lifetime" in the plan list and the lifetime limits.
- **Receipt:** Stripe's invoice plus a welcome email with seat number, caps, terms link and
  refund window.

### 6.6 Tests

Unit: lifetime caps and feature flags; `isPlanId("lifetime")`; pricing cards exclude it.

Integration (needs a loopback Postgres, as the existing suites do):

1. reserve → webhook `paid` → plan lifetime, one deal, one seat;
2. replay the same event → no second deal;
3. 101st reservation refused before Stripe is called;
4. expired session releases the seat;
5. full refund revokes the plan and frees the seat; partial does not;
6. `customer.subscription.deleted` for a lifetime workspace does not downgrade it;
7. lifetime workspace cannot start a subscription checkout;
8. one seat per purchaser account.

Then a Stripe test-mode pass: Checkout, webhook, receipt, refund, and the sold-out state.

## 7. Launch

- **Window:** 30 days or 100 seats, whichever comes first. When it closes, it closes. No
  "extended by popular demand".
- **Sequence:** 48 hours for existing Free users by email, then public.
- **Channels:** the free-user list, build-in-public posts, Indie Hackers, r/SaaS, and agency
  communities where "several client products under one login" is the actual pain. No paid
  acquisition and no AppSumo for the first run.
- **Success:** 25 sales ($12,475) is the base case; 100 is the ceiling. Activation matters more
  than sales: first product and board created within 7 days.
- **Measure:** landing-band view → checkout start → paid; refund rate; p95 emails and Mira
  replies; support minutes per lifetime account; share of buyers who say they would otherwise
  have bought Professional monthly.
- **Stop rules:** refunds above 8%, support above 30 minutes per account per month for two
  weeks, or fewer than 10 sales in 14 days. Pause or close rather than discount or extend.
- **Cannibalisation check:** ask at checkout "Without this offer, what would you have done?"
  If more than 60% answer "bought Professional monthly", the price is too close to a
  subscription and the next run needs a higher price or a smaller cap.

## 8. What would make this a bad deal

- **Unlimited Mira.** One heavy account can erase several lifetime payments.
- **More than 100 seats.** The tail cost scales linearly while the cash does not.
- **A fake countdown.** It converts once and destroys the next launch.
- **Including SSO.** It turns a product sale into an identity-integration support contract.
- **Spending the cash as ARR.** It is prepaid service, not recurring revenue.

## 9. Approval needed

Before implementation:

1. **$499 / 100 seats** — or a different price with the caps re-costed.
2. **150 Mira replies and 5,000 emails** — confirm against measured model and email costs.
3. **SSO excluded** — confirm no enterprise buyer needs it in this cohort.
4. **One workspace per account, active subscribers ineligible** — confirm the policy.

Once those are fixed, create the $499 one-time Stripe price and set `STRIPE_PRICE_LIFETIME`.
The build is roughly two to three days: migration and seat table, plan catalogue, checkout,
webhook, billing UI, landing band, tests.
