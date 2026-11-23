import { Activity, ArrowRight, BookOpen, Bot, Code2, MessageSquare, Newspaper, ShieldCheck, Webhook, Zap } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { MarketingPage } from "@/features/marketing/marketing-chrome";

export const metadata: Metadata = {
  title: "Docs",
  description:
    "Herald's help center, API reference, changelog, status and trust pages — the product documentation in one place.",
  alternates: { canonical: "/docs" },
};

const CONTAINER = "mx-auto w-full max-w-[1280px] px-5 sm:px-8 lg:px-20";
const DISPLAY = "[font-family:var(--font-archivo)] tracking-[-0.035em]";

const CARDS = [
  {
    icon: BookOpen,
    eyebrow: "Help center",
    title: "Learn the loop",
    body: "Getting started, installing the widget, importing feedback and answering customers from the public portal.",
    href: "/p/herald/herald/help",
    action: "Browse help articles",
  },
  {
    icon: Code2,
    eyebrow: "API",
    title: "Build against Herald",
    body: "The generated reference, worked workflows, client behaviour, the v1 promise and product events.",
    href: "/docs/api",
    action: "Open the API docs",
  },
  {
    icon: Webhook,
    eyebrow: "Integrations",
    title: "Twilio Segment",
    body: "Stream board activity into Twilio Segment with a source function: setup, event mapping, retries that recover, and how to verify each delivery.",
    href: "/docs/integrations/segment",
    action: "Read the Segment guide",
  },
  {
    icon: Zap,
    eyebrow: "Integrations",
    title: "Zapier",
    body: "Start a Zap from any Herald event: Catch Hook setup, the delivery envelope, signature verification and what happens when a Zap fails.",
    href: "/docs/integrations/zapier",
    action: "Read the Zapier guide",
  },
  {
    icon: MessageSquare,
    eyebrow: "Integrations",
    title: "Slack",
    body: "One channel per product: messages become requests, status changes stay in the thread, !support opens a conversation.",
    href: "/docs/integrations/slack",
    action: "Read the Slack guide",
  },
  {
    icon: Bot,
    eyebrow: "Developer guide",
    title: "MCP clients",
    body: "Connect Cursor, Claude, ChatGPT or VS Code to Herald's remote MCP server using a scoped workspace token.",
    href: "/docs/mcp",
    action: "Connect a client",
  },
  {
    icon: Newspaper,
    eyebrow: "Changelog",
    title: "See what shipped",
    body: "Product updates with the requests they answer, published on the same public workspace the docs use.",
    href: "/p/herald/herald/updates",
    action: "Read the changelog",
  },
  {
    icon: ShieldCheck,
    eyebrow: "Trust",
    title: "Security and privacy",
    body: "Data handling, sub-processors, residency, the DPA and the controls behind the service.",
    href: "/trust",
    action: "Review trust",
  },
  {
    icon: Activity,
    eyebrow: "Status",
    title: "Check the service",
    body: "Live database, storage, queue, email and backup checks, with the incident history beside them.",
    href: "/status",
    action: "Open status",
  },
] as const;

export default function DocsPage() {
  return (
    <MarketingPage
      eyebrow="Documentation"
      title="The product, the API and the record, in one place."
      intro="Herald publishes its help center, API reference and changelog on the same public workspace. Start with the job you need to do, then follow the link into the live documentation."
    >
      <section className="border-b border-[#dedad2]">
        <div className={`${CONTAINER} grid gap-4 py-12 sm:grid-cols-2 lg:grid-cols-3 lg:py-16`}>
          {CARDS.map((card) => (
            <Link
              key={card.title}
              href={card.href}
              className="group flex flex-col rounded-lg border border-[#d8d5ce] bg-white p-6 transition-colors hover:border-[#1f6b45]"
            >
              <card.icon className="size-4 text-[#1f6b45]" aria-hidden="true" />
              <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6b6862]">
                {card.eyebrow}
              </p>
              <h2 className={`${DISPLAY} mt-1.5 text-[1.3rem] font-semibold leading-snug`}>
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

      <section className={`${CONTAINER} py-12 lg:py-16`}>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)] lg:gap-16">
          <div>
            <h2 className={`${DISPLAY} text-[1.8rem] font-semibold leading-tight`}>
              How the documentation is organised.
            </h2>
            <div className="mt-5 space-y-4 text-[15px] leading-[1.65] text-[#4e4a44]">
              <p>
                <strong className="font-medium text-[#1c1b19]">Help articles</strong> are written
                for the people running a workspace. They cover setup, migration, the widget and the
                everyday customer loop.
              </p>
              <p>
                <strong className="font-medium text-[#1c1b19]">API docs</strong> are generated from
                an imported OpenAPI 3.1 document. The page shows the live version and keeps the
                version history, so an integration can point at the contract it was built against.
              </p>
              <p>
                <strong className="font-medium text-[#1c1b19]">Status and trust</strong> are
                operational records, not marketing copy. The status page is derived from live
                checks; the trust page records the controls and legal commitments behind the
                service.
              </p>
            </div>
          </div>

          <aside className="rounded-lg border border-[#1f6b45]/30 bg-[#eef4ef] p-6">
            <h2 className={`${DISPLAY} text-[1.25rem] font-semibold`}>Looking for something else?</h2>
            <p className="mt-2 text-[13px] leading-[1.6] text-[#3f3d39]">
              The public demo is the fastest way to see the product without creating a workspace.
              The changelog records what shipped, with the requests each release answers.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href="/demo"
                className="inline-flex h-9 items-center rounded-md border border-[#175236] bg-[#1f6b45] px-3 text-[13px] font-medium text-white hover:bg-[#175236]"
              >
                Open the demo
              </Link>
              <Link
                href="/p/herald/herald/updates"
                className="inline-flex h-9 items-center rounded-md border border-[#d8d5ce] bg-white px-3 text-[13px] font-medium text-[#1c1b19] hover:border-[#1f6b45]"
              >
                Read the changelog
              </Link>
            </div>
          </aside>
        </div>
      </section>
    </MarketingPage>
  );
}
