import { ArrowRight, Check, ExternalLink, Play } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import {
  MarketingButton,
  MarketingFooter,
  MarketingHeader,
} from "@/features/marketing/marketing-chrome";

export const metadata: Metadata = {
  title: "Interactive demo",
  description:
    "Browse Herald's live feedback board, roadmap and changelog, or watch a short walkthrough. This is the real product, not a mocked sandbox.",
  alternates: { canonical: "/demo" },
};

const CONTAINER = "mx-auto w-full max-w-[1280px] px-5 sm:px-8 lg:px-20";
const DISPLAY = "[font-family:var(--font-archivo)] tracking-[-0.035em]";

const SURFACES = [
  {
    title: "Feedback board",
    body: "Open requests, votes, statuses and public replies. This is where a customer request starts.",
    href: "/p/herald/herald/feedback?demo=1",
    label: "Open the board",
  },
  {
    title: "Public roadmap",
    body: "The roadmap is the request's own status, not a second list. Planned, in progress and shipped stay in sync.",
    href: "/p/herald/herald/roadmap?demo=1",
    label: "Open the roadmap",
  },
  {
    title: "Changelog",
    body: "Published releases with linked feedback. This is the other end of the loop, on the same public portal.",
    href: "/p/herald/herald/updates?demo=1",
    label: "Open the changelog",
  },
] as const;

export default function DemoPage() {
  return (
    <div className="min-h-screen bg-[#f4f3ee] text-[#1c1b19] antialiased [font-family:var(--font-inter)]">
      <MarketingHeader />
      <main>
        <section className="border-b border-[#dedad2]">
          <div className={`${CONTAINER} grid gap-10 py-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)] lg:items-center lg:py-20`}>
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#1f6b45]">
                Interactive demo
              </p>
              <h1
                className={`${DISPLAY} mt-4 max-w-[720px] text-balance text-[2.5rem] font-semibold leading-[1.02] sm:text-[3.4rem]`}
              >
                Look around the live product.
              </h1>
              <p className="mt-5 max-w-[620px] text-[16px] leading-[1.6] text-[#4e4a44] sm:text-[18px]">
                This is Herald&apos;s own workspace, running on Herald. Browse the feedback
                board, roadmap and changelog without creating an account. Nothing here is a
                mocked sandbox or a product tour with fake data.
              </p>
              <div className="mt-7 flex flex-wrap gap-2.5">
                <MarketingButton href="/p/herald/herald/feedback?demo=1">
                  Open the live board <ArrowRight className="size-4" aria-hidden="true" />
                </MarketingButton>
                <MarketingButton href="/sign-up" variant="secondary">
                  Start your own
                </MarketingButton>
              </div>
              <p className="mt-4 max-w-[540px] text-[12px] leading-relaxed text-[#6b6862]">
                Browsing is open. Voting or submitting may ask you to sign in, because those
                actions need an identity the team can reply to.
              </p>
            </div>

            <div className="overflow-hidden rounded-lg border border-[#d8d5ce] bg-white shadow-[0_16px_60px_-30px_rgba(22,21,19,0.45)]">
              <video
                className="aspect-video w-full bg-[#1c1b19]"
                controls
                preload="metadata"
                poster="/screenshots/herald-portal.png"
              >
                <source src="/demo/herald-demo.webm" type="video/webm" />
                Your browser cannot play this walkthrough. The live board is one click away.
              </video>
              <div className="flex items-center gap-2 border-t border-[#e6e3da] px-4 py-3 text-[12px] text-[#6b6862]">
                <Play className="size-3.5 text-[#1f6b45]" aria-hidden="true" />
                Short walkthrough: board to roadmap to changelog.
              </div>
            </div>
          </div>
        </section>

        <section className={`${CONTAINER} py-14 lg:py-20`}>
          <div className="max-w-[700px]">
            <h2 className={`${DISPLAY} text-[1.8rem] font-semibold sm:text-[2.2rem]`}>
              Three surfaces, one loop.
            </h2>
            <p className="mt-3 text-[15px] leading-[1.6] text-[#4e4a44]">
              Follow a request from the board, to the roadmap, to the release that answers
              it. The links below open the actual public pages.
            </p>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {SURFACES.map((surface) => (
              <Link
                key={surface.href}
                href={surface.href}
                className="group flex flex-col rounded-lg border border-[#d8d5ce] bg-white p-6 transition-colors hover:border-[#1f6b45]"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className={`${DISPLAY} text-[1.25rem] font-semibold`}>
                    {surface.title}
                  </h3>
                  <ExternalLink
                    className="mt-1 size-4 shrink-0 text-[#6b6862] group-hover:text-[#1f6b45]"
                    aria-hidden="true"
                  />
                </div>
                <p className="mt-2 flex-1 text-[13px] leading-[1.6] text-[#6b6862]">
                  {surface.body}
                </p>
                <span className="mt-5 inline-flex items-center gap-1.5 text-[13px] font-medium text-[#1f6b45]">
                  {surface.label}
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section className="border-y border-[#dedad2] bg-white">
          <div className={`${CONTAINER} grid gap-8 py-12 lg:grid-cols-2 lg:py-16`}>
            <div>
              <h2 className={`${DISPLAY} text-[1.7rem] font-semibold`}>
                What to try while you are there.
              </h2>
              <p className="mt-2 text-[14px] leading-[1.6] text-[#6b6862]">
                The public pages are read-only without an account. They still show the
                complete loop the dashboard manages.
              </p>
            </div>
            <ul className="space-y-3">
              {[
                "Open a request and read its public status and replies.",
                "Switch to the roadmap and find the same request by status.",
                "Open an update and follow it back to the feedback it answers.",
                "Check the status and trust pages linked in the footer.",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-[14px] leading-[1.55] text-[#3f3d39]">
                  <Check className="mt-0.5 size-4 shrink-0 text-[#1f6b45]" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}
