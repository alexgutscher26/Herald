"use client";

import { ArrowRight, Check, Minus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import {
  PLANS,
  PLAN_BASE_INCLUDES,
  PLAN_FEATURE_ROWS,
  PLAN_ORDER,
  PLAN_PRICING,
  formatUsd,
  type PlanPricing,
} from "@/features/entitlements/plans";
import { formatNumber } from "@/lib/format";

const DISPLAY = "[font-family:var(--font-archivo)] tracking-[-0.035em]";

type BillingPeriod = "monthly" | "yearly";

function yearlySaving(price: PlanPricing) {
  if (price.yearlyMonthly === null || price.monthly === 0) return null;
  const saving = (price.monthly - price.yearlyMonthly) * 12;
  const percent = Math.round((saving / (price.monthly * 12)) * 100);
  return { saving, percent };
}

const MAX_YEARLY_SAVING = Math.max(
  ...PLAN_ORDER.map((planId) => yearlySaving(PLAN_PRICING[planId])?.percent ?? 0),
);

export function PricingCards() {
  const [billing, setBilling] = useState<BillingPeriod>("monthly");

  return (
    <div className="pt-2">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13px] leading-relaxed text-[#6b6862]">
          Pay monthly, or save {MAX_YEARLY_SAVING}% on a yearly plan.
        </p>
        <div
          role="group"
          aria-label="Billing period"
          className="inline-flex w-fit items-center rounded-full border border-[#d8d5ce] bg-white p-1"
        >
          <button
            type="button"
            aria-pressed={billing === "monthly"}
            onClick={() => setBilling("monthly")}
            className={`rounded-full px-4 py-1.5 text-[12px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ${
              billing === "monthly"
                ? "bg-[#1c1b19] text-white"
                : "text-[#6b6862] hover:text-[#1c1b19]"
            }`}
          >
            Monthly
          </button>
          <button
            type="button"
            aria-pressed={billing === "yearly"}
            onClick={() => setBilling("yearly")}
            className={`rounded-full px-4 py-1.5 text-[12px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ${
              billing === "yearly"
                ? "bg-[#1c1b19] text-white"
                : "text-[#6b6862] hover:text-[#1c1b19]"
            }`}
          >
            Yearly
            <span
              className={`ml-1.5 text-[11px] ${
                billing === "yearly" ? "text-[#bfe3c9]" : "text-[#1f6b45]"
              }`}
            >
              −{MAX_YEARLY_SAVING}%
            </span>
          </button>
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        Showing {billing} prices.
      </p>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {PLAN_ORDER.map((planId) => {
          const plan = PLANS[planId];
          const price = PLAN_PRICING[planId];
          const featured = planId === "starter";
          const limits = plan.limits;
          const yearly = billing === "yearly" && price.yearlyMonthly !== null;
          const amount =
            billing === "yearly" ? (price.yearlyMonthly ?? price.monthly) : price.monthly;
          const saving = yearlySaving(price);
          const sub =
            planId === "free"
              ? "No card and no trial timer."
              : yearly
                ? `Billed ${formatUsd(amount * 12)} once a year · ${price.trialDays}-day trial`
                : `Billed monthly · ${price.trialDays}-day trial`;
          const allowances = [
            limits.products === null
              ? "Unlimited products"
              : `${limits.products} product${limits.products === 1 ? "" : "s"}`,
            limits.boardsPerProduct === null
              ? "Unlimited boards per product"
              : `${limits.boardsPerProduct} boards per product`,
            `${limits.members} team members`,
            `${formatNumber(limits.monthlyEmails ?? 0)} emails a month`,
            limits.integrations === null
              ? "Unlimited integrations"
              : `${limits.integrations} integration${limits.integrations === 1 ? "" : "s"}`,
          ];

          return (
            <div
              key={planId}
              className={`flex flex-col rounded-lg border bg-white p-7 ${
                featured
                  ? "border-[#1f6b45] shadow-[0_10px_32px_-20px_rgba(31,107,69,0.55)]"
                  : "border-[#d8d5ce]"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <p className={`${DISPLAY} text-[1.35rem] font-semibold`}>{plan.name}</p>
                {price.badge ? (
                  <span className="shrink-0 rounded-full bg-[#e4efe6] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#1f6b45]">
                    {price.badge}
                  </span>
                ) : null}
              </div>

              <p className="mt-2 min-h-[40px] text-[13px] leading-[1.55] text-[#6b6862]">
                {plan.description}
              </p>

              <p className="mt-6 flex flex-wrap items-baseline gap-x-2 gap-y-1.5">
                <span className={`${DISPLAY} text-[2.6rem] font-semibold leading-none`}>
                  {formatUsd(amount)}
                </span>
                <span className="text-[13px] text-[#6b6862]">
                  {planId === "free" ? "forever" : "/ month"}
                </span>
                {yearly && saving ? (
                  <span className="rounded-full bg-[#e4efe6] px-2 py-0.5 text-[11px] font-semibold text-[#1f6b45]">
                    Save {formatUsd(saving.saving)}/yr
                  </span>
                ) : null}
              </p>
              <p className="mt-2 min-h-[36px] text-[12px] leading-snug text-[#6b6862]">{sub}</p>
              <p className="mt-1 text-[12px] text-[#6b6862]">per workspace, not per seat</p>

              <div className="my-6 h-px bg-[#e0ddd5]" />

              <ul className="flex flex-1 flex-col gap-2.5 text-[13px] text-[#3f3d39]">
                <li className="flex items-start gap-2.5">
                  <Check className="mt-0.5 size-4 shrink-0 text-[#1f6b45]" aria-hidden="true" />
                  <span>{PLAN_BASE_INCLUDES}</span>
                </li>
                {allowances.map((allowance) => (
                  <li key={allowance} className="flex items-start gap-2.5">
                    <Check className="mt-0.5 size-4 shrink-0 text-[#1f6b45]" aria-hidden="true" />
                    <span>{allowance}</span>
                  </li>
                ))}
                {PLAN_FEATURE_ROWS.map(({ label, feature }) => {
                  const included = plan.features[feature];
                  return (
                    <li
                      key={label}
                      className={`flex items-start gap-2.5 ${included ? "" : "text-[#6b6862]"}`}
                    >
                      {included ? (
                        <Check
                          className="mt-0.5 size-4 shrink-0 text-[#1f6b45]"
                          aria-hidden="true"
                        />
                      ) : (
                        <Minus className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                      )}
                      <span>{label}</span>
                    </li>
                  );
                })}
              </ul>

              <Link
                href="/sign-up"
                className={`mt-7 inline-flex h-[47px] w-full items-center justify-center gap-2 rounded-md px-5 text-[15px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ${
                  featured
                    ? "border border-[#175236] bg-[#1f6b45] text-white shadow-[0_1px_0_rgba(20,19,18,0.12)] hover:bg-[#175236]"
                    : "border border-[#d8d5ce] bg-white text-[#1c1b19] shadow-[0_1px_0_rgba(20,19,18,0.08)] hover:bg-[#fbfaf6]"
                }`}
              >
                {price.cta}
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}
