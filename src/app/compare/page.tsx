import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import {
  COMPARISON_CHECKED_LABEL,
  COMPARISON_VENDORS,
  heraldPlanSummary,
} from "@/features/marketing/comparisons";
import { MarketingPage } from "@/features/marketing/marketing-chrome";

export const metadata: Metadata = {
  title: "Compare Herald",
  description:
    "Herald compared with Canny, Featurebase and UserJot on published prices, billing units and the features each page names. Every page is dated and links to the vendor's own pricing.",
  alternates: { canonical: "/compare" },
};

const CONTAINER = "mx-auto w-full max-w-[1280px] px-5 sm:px-8 lg:px-20";
const DISPLAY = "[font-family:var(--font-archivo)] tracking-[-0.035em]";

export default function ComparePage() {
  return (
    <MarketingPage
      eyebrow="Compare"
      title="Three honest comparisons, not a feature grid with everything ticked."
      intro={`Canny, Featurebase and UserJot price different things: tracked users, full seats and a flat workspace. We compared the published packaging on ${COMPARISON_CHECKED_LABEL}, linked every vendor page we used, and marked where Herald is the wrong fit.`}
    >
      <section className={`${CONTAINER} py-10 lg:py-14`}>
        <div className="grid gap-4 lg:grid-cols-3">
          {COMPARISON_VENDORS.map((vendor) => (
            <Link
              key={vendor.slug}
              href={`/compare/${vendor.slug}`}
              className="group flex flex-col rounded-lg border border-[#d8d5ce] bg-white p-6 transition-colors hover:border-[#1f6b45]"
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6b6862]">
                Herald vs {vendor.name}
              </p>
              <h2 className={`${DISPLAY} mt-3 text-[1.55rem] font-semibold`}>{vendor.name}</h2>
              <p className="mt-1 text-[12px] text-[#6b6862]">Bills by {vendor.model.toLowerCase()}</p>
              <p className="mt-4 text-[14px] leading-[1.6] text-[#3f3d39]">{vendor.priceSummary}</p>
              <span className="mt-6 inline-flex items-center gap-1.5 text-[13px] font-medium text-[#1f6b45]">
                Read the comparison
                <ArrowRight className="size-4" aria-hidden="true" />
              </span>
            </Link>
          ))}
        </div>

        <div className="mt-8 grid gap-4 rounded-lg border border-[#d8d5ce] bg-[#faf9f5] p-6 lg:grid-cols-[1fr_320px] lg:p-8">
          <div>
            <h2 className={`${DISPLAY} text-[1.4rem] font-semibold`}>Herald, for reference</h2>
            <p className="mt-2 max-w-[680px] text-[14px] leading-[1.6] text-[#4e4a44]">
              Herald is flat per workspace: {heraldPlanSummary()}. A free plan includes one product
              and two boards, and every plan includes public feedback, roadmap, changelog, help,
              surveys, tours and win-back. API and MCP access are on Professional.
            </p>
          </div>
          <div className="rounded-md border border-[#e6e3da] bg-white p-4 text-[12px] leading-relaxed text-[#6b6862]">
            <p className="font-medium text-[#1c1b19]">How these pages age</p>
            <p className="mt-2">
              Prices were checked on {COMPARISON_CHECKED_LABEL}. We do not import competitor
              pricing at request time or update a number without re-reading the source. If a vendor
              page has changed since then, its page is the current truth and this snapshot is
              history.
            </p>
          </div>
        </div>

        <p className="mt-6 text-[12px] text-[#6b6862]">
          New to the category? Start with the{" "}
          <Link href="/pricing" className="text-[#1f6b45] underline">
            Herald pricing page
          </Link>{" "}
          or the{" "}
          <Link href="/roadmap" className="text-[#1f6b45] underline">
            public roadmap
          </Link>
          .
        </p>
      </section>
    </MarketingPage>
  );
}
