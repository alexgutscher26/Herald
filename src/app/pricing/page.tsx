import { ArrowRight, Check, Minus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import {
  PLANS,
  PLAN_FEATURE_ROWS,
  PLAN_ORDER,
  PLAN_PRICING,
  formatUsd,
} from "@/features/entitlements/plans";
import {
  MarketingButton,
  MarketingFooter,
  MarketingHeader,
} from "@/features/marketing/marketing-chrome";
import { PricingCards } from "@/features/marketing/pricing-cards";
import {
  findLifetimeEligibleWorkspace,
  getLifetimeAvailability,
} from "@/features/billing/lifetime";
import { LifetimeOffer } from "@/features/marketing/lifetime-offer";
import { getSessionUser } from "@/lib/authz";
import { formatNumber } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Herald pricing, generated from the same plan catalogue that enforces the limits: free, Indie at $19 and Professional at $39 per workspace.",
  alternates: { canonical: "/pricing" },
};

const CONTAINER = "mx-auto w-full max-w-[1280px] px-5 sm:px-8 lg:px-20";
const DISPLAY = "[font-family:var(--font-archivo)] tracking-[-0.035em]";

function allowance(value: number | null, singular: string, plural = `${singular}s`): string {
  return value === null ? "Unlimited" : `${value} ${value === 1 ? singular : plural}`;
}

export default async function PricingPage() {
  const [availability, user] = await Promise.all([
    getLifetimeAvailability(),
    getSessionUser(),
  ]);
  const eligibleWorkspace = user
    ? await findLifetimeEligibleWorkspace(user.id)
    : null;

  const limitRows = [
    {
      label: "Products",
      value: (plan: (typeof PLAN_ORDER)[number]) =>
        allowance(PLANS[plan].limits.products, "product"),
    },
    {
      label: "Boards per product",
      value: (plan: (typeof PLAN_ORDER)[number]) =>
        allowance(PLANS[plan].limits.boardsPerProduct, "board"),
    },
    {
      label: "Paid members",
      value: (plan: (typeof PLAN_ORDER)[number]) =>
        allowance(PLANS[plan].limits.members, "member"),
    },
    {
      label: "Emails a month",
      value: (plan: (typeof PLAN_ORDER)[number]) =>
        formatNumber(PLANS[plan].limits.monthlyEmails ?? 0),
    },
    {
      label: "Integrations",
      value: (plan: (typeof PLAN_ORDER)[number]) =>
        allowance(PLANS[plan].limits.integrations, "integration"),
    },
  ] as const;

  return (
    <div className="min-h-screen bg-[#f4f3ee] text-[#1c1b19] antialiased [font-family:var(--font-inter)]">
      <MarketingHeader />
      <main>
        <section className="border-b border-[#dedad2]">
          <div className={`${CONTAINER} py-14 lg:py-20`}>
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#1f6b45]">
              Pricing
            </p>
            <h1
              className={`${DISPLAY} mt-4 max-w-[820px] text-balance text-[2.5rem] font-semibold leading-[1.02] sm:text-[3.4rem]`}
            >
              One flat price for the whole customer loop.
            </h1>
            <p className="mt-5 max-w-[680px] text-[16px] leading-[1.6] text-[#4e4a44] sm:text-[18px]">
              Every card below is rendered from the same plan catalogue the product uses to
              enforce limits. One product free, five on Indie, unlimited on Professional. No
              per-seat pricing.
            </p>
            <div className="mt-7 flex flex-wrap gap-2.5">
              <MarketingButton href="/sign-up">
                Start free <ArrowRight className="size-4" aria-hidden="true" />
              </MarketingButton>
              <MarketingButton href="/compare" variant="secondary">
                Compare with Canny, Featurebase and UserJot
              </MarketingButton>
            </div>
          </div>
        </section>

        <section className={`${CONTAINER} py-10 lg:py-14`}>
          <PricingCards />
          <p className="mt-4 text-[12px] leading-relaxed text-[#6b6862]">
            Prices are per workspace, not per seat, and must match the Stripe prices behind
            Checkout. Subscription plans include a 14-day trial. The plan catalogue is the source
            for the allowances above; the checkout page shows the exact amount charged.
          </p>
          <div id="lifetime" className="scroll-mt-24">
            <LifetimeOffer
              remaining={availability.remaining}
              workspaceSlug={eligibleWorkspace?.slug ?? null}
              signedIn={Boolean(user)}
            />
          </div>
        </section>

        <section className={`${CONTAINER} pb-16 lg:pb-24`}>
          <div className="overflow-hidden rounded-lg border border-[#d8d5ce] bg-white">
            <div className="border-b border-[#e6e3da] px-5 py-5 sm:px-7">
              <h2 className={`${DISPLAY} text-[1.6rem] font-semibold`}>Every allowance in one table</h2>

            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
                <thead>
                  <tr className="border-b border-[#e6e3da] bg-[#faf9f5]">
                    <th scope="col" className="px-5 py-3 font-medium text-[#6b6862] sm:px-7">
                      Feature
                    </th>
                    {PLAN_ORDER.map((plan) => (
                      <th key={plan} scope="col" className="px-5 py-3 font-semibold">
                        {PLANS[plan].name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-[#efece6]">
                    <th scope="row" className="px-5 py-3 font-medium sm:px-7">
                      Monthly price
                    </th>
                    {PLAN_ORDER.map((plan) => (
                      <td key={plan} className="px-5 py-3 tabular-nums">
                        {formatUsd(PLAN_PRICING[plan].monthly)}
                        {plan === "free" ? " forever" : "/mo"}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b border-[#efece6]">
                    <th scope="row" className="px-5 py-3 font-medium sm:px-7">
                      Yearly price
                    </th>
                    {PLAN_ORDER.map((plan) => (
                      <td key={plan} className="px-5 py-3 tabular-nums">
                        {PLAN_PRICING[plan].yearlyMonthly === null
                          ? "—"
                          : `${formatUsd(PLAN_PRICING[plan].yearlyMonthly ?? 0)}/mo`}
                      </td>
                    ))}
                  </tr>
                  {limitRows.map((row) => (
                    <tr key={row.label} className="border-b border-[#efece6]">
                      <th scope="row" className="px-5 py-3 font-medium sm:px-7">
                        {row.label}
                      </th>
                      {PLAN_ORDER.map((plan) => (
                        <td key={plan} className="px-5 py-3">
                          {row.value(plan)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {PLAN_FEATURE_ROWS.map(({ label, feature }) => (
                    <tr key={label} className="border-b border-[#efece6] last:border-0">
                      <th scope="row" className="px-5 py-3 font-medium sm:px-7">
                        {label}
                      </th>
                      {PLAN_ORDER.map((plan) => (
                        <td key={plan} className="px-5 py-3">
                          {PLANS[plan].features[feature] ? (
                            <span className="inline-flex items-center gap-1.5 text-[#1f6b45]">
                              <Check className="size-4" aria-hidden="true" /> Included
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-[#6b6862]">
                              <Minus className="size-4" aria-hidden="true" /> Not included
                            </span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-8 grid gap-4 rounded-lg border border-[#d8d5ce] bg-white p-5 sm:grid-cols-2 sm:p-6">
            <div>
              <h2 className={`${DISPLAY} text-[1.35rem] font-semibold`}>
                Check the service, not just the page.
              </h2>
              <p className="mt-2 text-[13px] leading-relaxed text-[#6b6862]">
                The status page reads live dependency and worker checks on every request.
                The trust page states the controls, sub-processors and compliance claims
                honestly — including what Herald does not hold.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <Link
                href="/status"
                className="inline-flex h-[38px] items-center rounded-md border border-[#d8d5ce] bg-[#faf9f5] px-3 text-[13px] font-medium text-[#1c1b19] hover:border-[#1f6b45] hover:text-[#1f6b45]"
              >
                Live service status
              </Link>
              <Link
                href="/trust"
                className="inline-flex h-[38px] items-center rounded-md border border-[#d8d5ce] bg-[#faf9f5] px-3 text-[13px] font-medium text-[#1c1b19] hover:border-[#1f6b45] hover:text-[#1f6b45]"
              >
                Security and trust
              </Link>
            </div>
          </div>

          <p className="mt-5 text-[13px] text-[#6b6862]">
            Running several products? Read the{" "}
            <Link href="/compare/userjot" className="font-medium text-[#1f6b45] underline">
              UserJot comparison
            </Link>{" "}
            or see{" "}
            <Link href="/roadmap" className="font-medium text-[#1f6b45] underline">
              what we are building next
            </Link>
            .
          </p>
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}
