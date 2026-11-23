# Discount program — decision

**Status:** decided 2026-11-21; manual fulfilment at launch
**Decision:** an **open-source maintainer discount**. No referral or affiliate
program at launch.
**Public terms:** `/open-source`
**Billing impact:** none. This is a coupon applied at checkout, not a new plan
or a change to the displayed list price.

## The decision

Give maintainers of active public open-source projects **50% off Indie or
Professional for twelve months**, on one workspace, reviewed by hand.

This is deliberately a discount, not a referral scheme:

- A referral program pays existing customers for introductions. It needs
  attribution, a payout ledger, fraud handling, tax treatment and a definition
  of a qualified referral. None of that exists, and building it would compete
  with the launch work that actually produces the first customers.
- An open-source discount is a fixed, checkable eligibility rule. The audience
  is public, the proof is a repository and a maintainer role, and the cost is
  bounded by a coupon duration.
- It fits the product's audience: people who run small products and already
  publish their work in public.

The decision is recorded here so the next conversation does not reopen
"referral vs discount" by accident. If a referral program is wanted later, it
needs a new decision with its own economics.

## Terms

| Item | Term |
| --- | --- |
| Discount | 50% off the listed price |
| Plans | Indie or Professional |
| Duration | 12 months from the first discounted invoice |
| Billing | Monthly or yearly, customer's choice |
| Workspaces | One per maintainer |
| Eligibility | Public repository, OSI-approved licence, maintainer can prove commit access, merged activity in the last 90 days, roughly 100 GitHub stars or equivalent public reach |
| Evidence | Repository URL plus the address on the public maintainer profile or commit history |
| Stacking | Not allowed with another promotion |
| Retroactive | Not applied to past invoices |
| After 12 months | Renews at the listed price unless the customer cancels |
| Transfer | Not transferable to another workspace after checkout |
| Cash value | None |

The public page states these terms. It does not claim that every applicant
qualifies.

## Fulfilment at launch

1. The applicant emails `support@herald.app` from the address on the public
   maintainer profile, with the repository URL and target workspace.
2. Check the repository, licence, maintainer role and the 90-day activity
   window. If the role is not obvious, ask for a commit or organisation link;
   do not infer it from a display name.
3. Create a single-use Stripe promotion code: 50% off, duration `once` for a
   yearly purchase or `repeating` for 12 months on monthly billing. Record the
   code, repository, workspace and reviewer in the support thread.
4. Send the code and the `/open-source` terms link. Do not promise a renewal
   discount.
5. Review the program after 90 days: applications, approvals, conversion,
   downgrade/refund rate and support minutes. Stop or tighten it if the
   discounted cohort costs more to support than it contributes.

This is manual on purpose. A self-serve eligibility checker would need GitHub
OAuth, organisation scopes and an abuse model; none of that is justified before
the first cohort proves demand.

## What is not happening

- No cash referral payouts.
- No affiliate tracking links.
- No automatic coupon on sign-up.
- No change to `PLAN_PRICING`, Stripe list prices or entitlements. A price move
  still needs a new Stripe price, a subscriber migration and the display
  constant in one change.
- No public claim that the discount is "for life" or applies to future plans.

## Metrics

| Signal | Target after 90 days |
| --- | --- |
| Applications | 20 |
| Approved | 10 |
| Approved workspaces that become paid | 5 |
| Refund or immediate downgrade rate | Under 10% |
| Support minutes per application | Under 15 |

If approvals are high but paid conversion is near zero, the audience is using
the discount as a free extended trial; raise the evidence bar or shorten the
duration before expanding the program.

## Review

Revisit on **2027-02-19** with the metrics above. The launch checklist still
requires the support inbox to be staffed before `/open-source` is published to
production.
