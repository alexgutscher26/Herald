import { ArrowRight, ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  COMPARISON_CHECKED_AT,
  COMPARISON_CHECKED_LABEL,
  COMPARISON_VENDORS,
  getComparisonVendor,
} from "@/features/marketing/comparisons";
import {
  MarketingButton,
  MarketingPage,
} from "@/features/marketing/marketing-chrome";

const CONTAINER = "mx-auto w-full max-w-[1280px] px-5 sm:px-8 lg:px-20";
const DISPLAY = "[font-family:var(--font-archivo)] tracking-[-0.035em]";

type PageProps = { params: Promise<{ vendor: string }> };

export function generateStaticParams() {
  return COMPARISON_VENDORS.map((vendor) => ({ vendor: vendor.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { vendor: slug } = await params;
  const vendor = getComparisonVendor(slug);
  if (!vendor) return {};
  return {
    title: `Herald vs ${vendor.name}`,
    description: vendor.description,
    alternates: { canonical: `/compare/${vendor.slug}` },
    openGraph: {
      title: `Herald vs ${vendor.name}`,
      description: vendor.description,
      type: "article",
      url: `/compare/${vendor.slug}`,
    },
  };
}

export default async function ComparisonPage({ params }: PageProps) {
  const { vendor: slug } = await params;
  const vendor = getComparisonVendor(slug);
  if (!vendor) notFound();

  return (
    <MarketingPage
      eyebrow={vendor.eyebrow}
      title={vendor.title}
      intro={vendor.description}
      actions={
        <>
          <MarketingButton href="/sign-up">
            Start free <ArrowRight className="size-4" aria-hidden="true" />
          </MarketingButton>
          <MarketingButton href="/pricing" variant="secondary">
            See Herald pricing
          </MarketingButton>
        </>
      }
    >
      <section className={`${CONTAINER} py-10 lg:py-14`}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-[#d8d5ce] bg-white p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6b6862]">
              {vendor.name} model
            </p>
            <p className={`${DISPLAY} mt-2 text-[1.3rem] font-semibold`}>{vendor.model}</p>
            <p className="mt-2 text-[13px] leading-relaxed text-[#6b6862]">
              {vendor.priceSummary}
            </p>
          </div>
          <div className="rounded-lg border border-[#b9d3c1] bg-[#eef5ef] p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#1f6b45]">
              Herald model
            </p>
            <p className={`${DISPLAY} mt-2 text-[1.3rem] font-semibold`}>Flat per workspace</p>
            <p className="mt-2 text-[13px] leading-relaxed text-[#3f5c4a]">
              $0 Free · $19 Indie · $39 Professional a month, not per seat. One, five or unlimited
              products depending on plan.
            </p>
          </div>
        </div>

        <div className="mt-8 overflow-hidden rounded-lg border border-[#d8d5ce] bg-white">
          <div className="border-b border-[#e6e3da] px-5 py-5 sm:px-7">
            <h2 className={`${DISPLAY} text-[1.6rem] font-semibold`}>
              The packaging, side by side
            </h2>
            <p className="mt-1 text-[12px] text-[#6b6862]">
              {vendor.name} figures checked {COMPARISON_CHECKED_LABEL}. Herald figures come from
              the plan catalogue that enforces them.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left text-[13px]">
              <thead>
                <tr className="border-b border-[#e6e3da] bg-[#faf9f5]">
                  <th scope="col" className="w-[22%] px-5 py-3 font-medium text-[#6b6862] sm:px-7">
                    What we compared
                  </th>
                  <th scope="col" className="w-[39%] px-5 py-3 font-semibold">
                    {vendor.name}
                  </th>
                  <th scope="col" className="w-[39%] px-5 py-3 font-semibold text-[#1f6b45]">
                    Herald
                  </th>
                </tr>
              </thead>
              <tbody>
                {vendor.rows.map((row) => (
                  <tr key={row.label} className="border-b border-[#efece6] last:border-0">
                    <th scope="row" className="px-5 py-4 align-top font-medium sm:px-7">
                      {row.label}
                    </th>
                    <td className="px-5 py-4 align-top leading-relaxed text-[#4e4a44]">
                      {row.them}
                    </td>
                    <td className="px-5 py-4 align-top leading-relaxed text-[#1c1b19]">
                      {row.herald}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-8 grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-[#d8d5ce] bg-white p-6">
            <h2 className={`${DISPLAY} text-[1.25rem] font-semibold`}>
              Choose {vendor.name} if…
            </h2>
            <p className="mt-2 text-[14px] leading-[1.65] text-[#4e4a44]">{vendor.chooseThem}</p>
          </div>
          <div className="rounded-lg border border-[#b9d3c1] bg-[#eef5ef] p-6">
            <h2 className={`${DISPLAY} text-[1.25rem] font-semibold`}>Choose Herald if…</h2>
            <p className="mt-3 text-[14px] leading-[1.65] text-[#3f5c4a]">{vendor.chooseHerald}</p>
          </div>
        </div>

        <div className="mt-8 grid gap-6 rounded-lg border border-[#d8d5ce] bg-[#faf9f5] p-6 lg:grid-cols-[1fr_320px] lg:p-8">
          <div>
            <h2 className={`${DISPLAY} text-[1.25rem] font-semibold`}>Sources</h2>
            <p className="mt-1 text-[13px] text-[#6b6862]">
              Checked {COMPARISON_CHECKED_LABEL}. These are the vendor pages we read; re-read them
              before relying on a number for a purchase decision.
            </p>
            <ul className="mt-3 grid gap-2">
              {vendor.sources.map((source) => (
                <li key={source.url}>
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#1f6b45] underline underline-offset-2"
                  >
                    {source.label}
                    <ExternalLink className="size-3.5" aria-hidden="true" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-md border border-[#e6e3da] bg-white p-4 text-[12px] leading-relaxed text-[#6b6862]">
            <p className="font-medium text-[#1c1b19]">Scope</p>
            <p className="mt-2">
              This page compares published packaging and the features named in the table. It is not
              a complete audit of every feature in either product.
            </p>
            <p className="mt-3">
              Snapshot date:{" "}
              <time dateTime={COMPARISON_CHECKED_AT}>{COMPARISON_CHECKED_LABEL}</time>.
            </p>
          </div>
        </div>

        <p className="mt-6 text-[12px] text-[#6b6862]">
          See all{" "}
          <Link href="/compare" className="text-[#1f6b45] underline">
            comparisons
          </Link>
          , the{" "}
          <Link href="/pricing" className="text-[#1f6b45] underline">
            full pricing table
          </Link>
          , or{" "}
          <Link href="/roadmap" className="text-[#1f6b45] underline">
            Herald&apos;s public roadmap
          </Link>
          .
        </p>
      </section>
    </MarketingPage>
  );
}
