import { ArrowRight, Check, Minus } from "lucide-react";
import type { Metadata } from "next";

import {
  MarketingButton,
  MarketingFooter,
  MarketingHeader,
} from "@/features/marketing/marketing-chrome";

export const metadata: Metadata = {
  title: "Open-source discount",
  description:
    "Herald gives maintainers of active public open-source projects 50% off Indie or Professional for twelve months. Manual review, one discount per maintainer.",
  alternates: { canonical: "/open-source" },
};

const CONTAINER = "mx-auto w-full max-w-[1280px] px-5 sm:px-8 lg:px-20";
const DISPLAY = "[font-family:var(--font-archivo)] tracking-[-0.035em]";
const APPLY = "mailto:support@herald.app?subject=Open-source%20discount";

export default function OpenSourcePage() {
  return (
    <div className="min-h-screen bg-[#f4f3ee] text-[#1c1b19] antialiased [font-family:var(--font-inter)]">
      <MarketingHeader />
      <main>
        <section className="border-b border-[#dedad2]">
          <div className={`${CONTAINER} py-14 lg:py-20`}>
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#1f6b45]">
              Open-source program
            </p>
            <h1
              className={`${DISPLAY} mt-4 max-w-[840px] text-balance text-[2.5rem] font-semibold leading-[1.02] sm:text-[3.4rem]`}
            >
              Half off for the people who maintain the commons.
            </h1>
            <p className="mt-5 max-w-[680px] text-[16px] leading-[1.6] text-[#4e4a44] sm:text-[18px]">
              Active maintainers of public open-source projects get 50% off Indie or
              Professional for twelve months. One discount per maintainer, applied to one
              workspace. We review each application by hand; there is no automated code to
              game.
            </p>
            <div className="mt-7 flex flex-wrap gap-2.5">
              <MarketingButton href={APPLY}>
                Apply for the discount <ArrowRight className="size-4" aria-hidden="true" />
              </MarketingButton>
              <MarketingButton href="/pricing" variant="secondary">
                See the plans
              </MarketingButton>
            </div>
          </div>
        </section>

        <section className={`${CONTAINER} grid gap-8 py-14 lg:grid-cols-2 lg:py-20`}>
          <div className="rounded-lg border border-[#d8d5ce] bg-white p-6 lg:p-8">
            <h2 className={`${DISPLAY} text-[1.5rem] font-semibold`}>Who qualifies</h2>
            <ul className="mt-4 space-y-3">
              {[
                "A public repository under an OSI-approved licence.",
                "You can show commit access or another maintainer role.",
                "The project has shipped or merged changes in the last 90 days.",
                "Roughly 100 GitHub stars or an equivalent public audience — tell us the context if the number is not the whole story.",
                "You apply from the address on the repository's public profile or commit history.",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-[14px] leading-[1.6] text-[#3f3d39]">
                  <Check className="mt-0.5 size-4 shrink-0 text-[#1f6b45]" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-lg border border-[#d8d5ce] bg-white p-6 lg:p-8">
            <h2 className={`${DISPLAY} text-[1.5rem] font-semibold`}>What you get</h2>
            <p className="mt-3 text-[14px] leading-[1.6] text-[#4e4a44]">
              50% off the listed monthly or yearly price on Indie or Professional for twelve
              months from the first paid invoice. The discount applies to one workspace and
              cannot be combined with another offer.
            </p>
            <ul className="mt-4 space-y-3">
              {[
                "The plan's full allowances and features, unchanged.",
                "Monthly or yearly billing — your choice.",
                "After twelve months the workspace renews at the listed price.",
                "Cancel any time; the discount does not convert to cash.",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-[14px] leading-[1.6] text-[#3f3d39]">
                  <Check className="mt-0.5 size-4 shrink-0 text-[#1f6b45]" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="border-y border-[#dedad2] bg-white">
          <div className={`${CONTAINER} grid gap-8 py-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:py-16`}>
            <div>
              <h2 className={`${DISPLAY} text-[1.7rem] font-semibold`}>
                How to apply.
              </h2>
              <ol className="mt-4 space-y-3 text-[14px] leading-[1.6] text-[#3f3d39]">
                <li>1. Email us the repository URL and the workspace you want the discount on.</li>
                <li>2. We check the repository, your maintainer role and the activity window.</li>
                <li>3. If it qualifies, we send a single-use promotion code for checkout.</li>
              </ol>
              <p className="mt-4 max-w-[620px] text-[13px] leading-relaxed text-[#6b6862]">
                Review usually takes a few business days. We may ask a follow-up question if
                the repository is new or the maintainer role is not obvious. Applying does not
                create an obligation to buy.
              </p>
            </div>
            <div className="rounded-lg border border-[#d8d5ce] bg-[#faf9f5] p-5">
              <h3 className="text-sm font-semibold">What is not included</h3>
              <ul className="mt-3 space-y-2.5">
                {[
                  "No referral or affiliate payments.",
                  "No retroactive discount on past invoices.",
                  "No stacking with another promotion.",
                  "No transfer to a different workspace after checkout.",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2 text-[13px] leading-[1.55] text-[#6b6862]">
                    <Minus className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className={`${CONTAINER} py-14 lg:py-20`}>
          <div className="rounded-lg border border-[#1f6b45]/30 bg-[#eef4ef] p-6 sm:flex sm:items-center sm:justify-between sm:gap-8 lg:p-8">
            <div>
              <h2 className={`${DISPLAY} text-[1.5rem] font-semibold`}>
                Ready to apply?
              </h2>
              <p className="mt-1 text-[13px] leading-relaxed text-[#4e4a44]">
                Send the repository URL from the address on your public maintainer profile.
              </p>
            </div>
            <MarketingButton href={APPLY}>Email support@herald.app</MarketingButton>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}
