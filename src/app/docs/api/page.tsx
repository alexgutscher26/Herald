import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { MarketingPage } from "@/features/marketing/marketing-chrome";

export const metadata: Metadata = {
  title: "API",
  description:
    "Herald's API in one place: the live OpenAPI reference, worked workflows, client behaviour, the v1 compatibility promise and product events.",
  alternates: { canonical: "/docs/api" },
};

const CARDS = [
  {
    title: "Live reference",
    body: "The published OpenAPI 3.1 document for /api/v1, with the version history beside it.",
    href: "/p/herald/herald/docs/api",
    action: "Open the reference",
  },
  {
    title: "Workflows",
    body: "Six worked sequences: file a request for a customer, triage it, reply, draft a changelog entry, answer support.",
    href: "/docs/api/workflows",
    action: "Read the workflows",
  },
  {
    title: "Client behaviour",
    body: "Pagination, idempotency, error recovery, rate limits and reconciliation — how a client stays correct.",
    href: "/docs/api/cookbook",
    action: "Read the cookbook",
  },
  {
    title: "Versioning",
    body: "What counts as an additive change inside v1, and how a deprecation reaches you first.",
    href: "/docs/api/versioning",
    action: "Read the promise",
  },
  {
    title: "Product events",
    body: "POST /api/v1/events: fields, limits, the SDK helper and the outbound webhook it emits.",
    href: "/docs/api/events",
    action: "Read about events",
  },
] as const;

export default function ApiDocsIndexPage() {
  return (
    <MarketingPage
      eyebrow="API"
      title="Build against Herald"
      intro="The reference is generated from the route manifest, so it cannot drift from the service. The guides around it cover the parts a spec cannot: order of calls, retries, deprecations and events."
    >
      <section className="border-b border-[#dedad2]">
        <div className="mx-auto grid w-full max-w-[1280px] gap-4 px-5 py-12 sm:grid-cols-2 sm:px-8 lg:grid-cols-3 lg:px-20 lg:py-16">
          {CARDS.map((card) => (
            <Link
              key={card.title}
              href={card.href}
              className="group flex flex-col rounded-lg border border-[#d8d5ce] bg-white p-6 transition-colors hover:border-[#1f6b45]"
            >
              <h2 className="text-[1.3rem] font-semibold leading-snug [font-family:var(--font-archivo)] tracking-[-0.035em]">
                {card.title}
              </h2>
              <p className="mt-2 flex-1 text-[14px] leading-[1.6] text-[#4e4a44]">{card.body}</p>
              <span className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-[#1f6b45]">
                {card.action}
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </span>
            </Link>
          ))}
        </div>
      </section>
    </MarketingPage>
  );
}
