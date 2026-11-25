import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Check,
  ChevronDown,
  ClipboardList,
  Code2,
  Inbox,
  Map,
  Menu,
  MessageSquare,
  Minus,
  Newspaper,
  PenLine,
  Puzzle,
  Rocket,
  Undo2,
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";

import { ConsentBanner } from "@/features/consent/consent-banner";
import { ConsentSettingsButton } from "@/features/consent/consent-settings-button";
import { JsonLd } from "@/features/public/json-ld";
import { softwareApplicationSchema } from "@/features/public/structured-data";
import { LifetimeOffer } from "@/features/marketing/lifetime-offer";
import { PricingCards } from "@/features/marketing/pricing-cards";
import { currentYear } from "@/lib/dates";

/**
 * Marketing landing page.
 *
 * Tokens are taken from the reference site's computed styles rather than
 * approximated: cream #f4f3ee page, ink #1c1b19 text, Archivo 600 display at
 * 80px / 1.0 / -0.035em, Inter 16px body, 14px nav links, 47px buttons with a
 * 6px radius, a 1280px container with 80px gutters, and the same section
 * rhythm — cream hero, ink band, ink statement, cream steps, ink features,
 * green migration, cream plans/compare/FAQ, ink closer.
 *
 * Claims stay limited to what the product enforces. There are no invented
 * customer logos or testimonials: the bands describe capabilities, not
 * customers. Competitor numbers are a dated snapshot read from the vendor's
 * own pricing page (UserJot 2026-11-22, Featurebase 2026-11-07) and every
 * comparison says so.
 */

const GREEN = "#1f6b45";

const DISPLAY = "[font-family:var(--font-archivo)] tracking-[-0.035em]";
const CONTAINER = "mx-auto w-full max-w-[1280px] px-5 sm:px-8 lg:px-20";
const H1 = `${DISPLAY} text-balance text-[2.75rem] font-semibold leading-[1] sm:text-[4rem] lg:text-[5rem]`;
const H2 = `${DISPLAY} text-balance text-[2.15rem] font-semibold leading-[1.04] sm:text-[2.9rem] lg:text-[3.5rem]`;

const NAV_LINKS = [
  { href: "#loop", label: "The loop" },
  { href: "#platform", label: "Platform" },
  { href: "#features", label: "Features" },
  { href: "#plans", label: "Plans" },
  { href: "/roadmap", label: "Roadmap" },
  { href: "#compare", label: "Compare" },
  { href: "#faq", label: "FAQ" },
] as const;

const FOOTER_COLUMNS = [
  {
    title: "Product",
    links: [
      { label: "The loop", href: "#loop" },
      { label: "Platform", href: "#platform" },
      { label: "Features", href: "#features" },
      { label: "Plans", href: "#plans" },
      { label: "Pricing", href: "/pricing" },
      { label: "Roadmap", href: "/roadmap" },
      { label: "Compare", href: "#compare" },
      { label: "Comparison pages", href: "/compare" },
      { label: "Live demo", href: "/demo" },
      { label: "Open-source discount", href: "/open-source" },
      { label: "FAQ", href: "#faq" },
    ],
  },
  {
    title: "Get started",
    links: [
      { label: "Start free", href: "/sign-up" },
      { label: "Sign in", href: "/sign-in" },
      { label: "Dashboard", href: "/app" },
      { label: "Onboarding", href: "/app/onboarding" },
    ],
  },
  {
    title: "Site",
    links: [
      { label: "Docs", href: "/docs" },
      { label: "Status", href: "/status" },
      { label: "Security", href: "/trust" },
      { label: "Privacy", href: "/legal/privacy" },
      { label: "Terms", href: "/legal/terms" },
      { label: "DPA", href: "/legal/dpa" },
      { label: "Sub-processors", href: "/legal/subprocessors" },
      { label: "Data residency", href: "/legal/data-residency" },
      { label: "Accessibility", href: "/accessibility" },
      { label: "Sitemap", href: "/sitemap.xml" },
    ],
  },
] as const;

const FAMILIAR = [
  "a request got 40 votes.",
  "you shipped it.",
  "the changelog went quiet.",
  "the customer cancelled.",
  "nobody wrote down why.",
] as const;

const STEPS = [
  {
    icon: Inbox,
    title: "They ask, in public",
    body: "Feedback lands on a board or through the widget. Votes, comments and duplicate merges keep one request from becoming nine.",
  },
  {
    icon: Map,
    title: "You decide where it goes",
    body: "Under review, planned, in progress. The public roadmap is the request's own status, so there is no second list to sync.",
  },
  {
    icon: Rocket,
    title: "You ship, then tell them",
    body: "Write the entry, link the requests it answers, publish or schedule it. Matching win-back campaigns draft themselves from the reasons you recorded.",
  },
] as const;

const FEATURE_CARDS = [
  {
    title: "Public feedback boards",
    body: "Votes, six statuses, internal notes kept apart from public replies and duplicate merges with an undo.",
  },
  {
    title: "Changelog with RSS",
    body: "Markdown, categories, cover art, multiple authors, timezone-aware scheduling and Open Graph images.",
  },
  {
    title: "Win-back, approved first",
    body: "A cancellation reason points at the release that answers it. Draft, approve, canary, send.",
  },
] as const;

const MIGRATION_POINTS = [
  "Every request keeps its votes and comments.",
  "Each cancellation keeps the reason it arrived with.",
  "Replaying the same file creates no duplicates.",
] as const;

const COMPARISON = [
  { job: "Public feedback boards with votes", featurebase: true, herald: true },
  { job: "Markdown changelog with scheduling and RSS", featurebase: true, herald: true },
  { job: "Public roadmap driven by request status", featurebase: true, herald: true },
  { job: "Embeddable in-app widget", featurebase: true, herald: true },
  { job: "Win-back campaigns from cancellation reasons", featurebase: false, herald: true },
  { job: "Approval and sending as separate steps", featurebase: false, herald: true },
  { job: "Canary batch before the full audience", featurebase: false, herald: true },
  { job: "Flat price per workspace, not per seat", featurebase: false, herald: true },
  { job: "Full workspace export", featurebase: true, herald: true },
] as const;

/**
 * UserJot comparison. Read from https://userjot.com/pricing on 2026-11-22:
 * free with 2 boards and 3 admin roles, Starter $29 with 5 boards, Professional
 * $59 with unlimited boards, flat per workspace with unlimited viewers and requests.
 * The page says API and MCP are on every plan. Verify before publishing again.
 */
const USERJOT_COMPARISON = [
  {
    question: "Published price",
    userjot: "$0 free · $29 Starter · $59 Professional a month",
    herald: "$0 free · $19 Indie · $39 Professional a month, per workspace",
  },
  {
    question: "Boards included",
    userjot: "2 on Free, 5 on Starter, unlimited on Professional",
    herald: "2 on Free, 5 on Indie, unlimited on Professional",
  },
  {
    question: "Products under one account",
    userjot: "One workspace; boards are the paid unit",
    herald: "1 free · 5 Indie · unlimited Professional",
  },
  {
    question: "Public feedback, roadmap and changelog",
    userjot: "Included on every plan",
    herald: "Included on every plan",
  },
  {
    question: "API and MCP",
    userjot: "REST API and MCP server on every plan",
    herald: "REST API and MCP server on Professional",
  },
  {
    question: "A brief an agent can start from",
    userjot: "Read the request over the API or MCP, then assemble the context",
    herald:
      "Copy a Markdown brief — problem, dated evidence, demand, status, open questions — or fetch the same text over the API",
  },
] as const;

const FAQ = [
  {
    question: "How is this different from UserJot?",
    answer:
      "The loop is similar: both publish feedback boards, a roadmap and a changelog, and both expose a REST API and MCP server (UserJot on every plan; Herald on Professional). Two differences matter if you run more than one product. UserJot sells around boards — $29 a month for five, $59 for unlimited — while Herald sells products: five on Indie at $19 and unlimited on Professional at $39, each with its own boards, roadmap and changelog. And Herald builds the request brief for you: problem, dated customer evidence, demand, status and open questions as Markdown an agent can turn into a ticket. If you run a single product and never use an agent, UserJot is a good choice, and its free tier is generous. Prices read from userjot.com/pricing on 22 November 2026; check their page for today's numbers.",
  },
  {
    question: "Does publishing a release email customers who churned?",
    answer:
      "No. Publishing affects the public changelog, the widget and subscribers who opted into product updates. Win-back is a separate campaign: pick a release and the reasons it addresses, review matched accounts and exclusions, save a draft, approve it, and only then send.",
  },
  {
    question: "What happens to feedback when I ship the thing?",
    answer:
      "Link the request to the release. Publishing marks linked requests as shipped, which updates the inbox, the roadmap and the public pages from one record. Requests people voted on stay public and point at the release.",
  },
  {
    question: "Can I bring my existing feedback and cancellations over?",
    answer:
      "Yes. Feedback imports from CSV with per-row results, and cancellations import with email, name, cancelled time, reason and free-text feedback. Replaying the same file does not duplicate rows. You can export the whole workspace at any time.",
  },
  {
    question: "Do I need a credit card or a sales call?",
    answer:
      "No. Start on the free plan and upgrade from Billing when you need more boards, seats or email volume. Paid plans go through Stripe Checkout, and the price is on that page — there is no demo gate in front of it.",
  },
  {
    question: "Where does the data live?",
    answer:
      "In your own Postgres database (Neon works well). Analytics events store no email, IP address or user agent, customer sessions are separate from team accounts, and every dashboard read is scoped to a workspace you belong to.",
  },
  {
    question: "Is there a help center, or do I need a separate knowledge base?",
    answer:
      "Herald publishes help collections and articles on the same public portal as updates, feedback and the roadmap, with one search across all of them. Publishing an article updates the version Mira can cite; unpublishing removes it from future answers. Help is on every plan, and Mira AI replies are part of Professional.",
  },
  {
    question: "Do surveys and in-app tours need another tool?",
    answer:
      "No. NPS, CSAT and custom surveys publish on the portal and embed on any public page, and tours and banners render through the widget loader with per-step targeting, dismissal memory and translated copy. Reports count a survey response or tour completion once per recipient, so a reload or a resume does not inflate the number.",
  },
  {
    question: "Can I publish API documentation here?",
    answer:
      "Yes. Import OpenAPI 3.1 from a file, URL or CI job. Every import lands as a draft with a reviewable diff, one version is live at a time, and the public docs page keeps the history. The playground uses scoped API tokens, and a read-only token cannot send a write request. API access is part of Professional.",
  },
] as const;

function Eyebrow({ children, tone = "green" }: { children: ReactNode; tone?: "green" | "light" }) {
  return (
    <p
      className="text-[12px] font-semibold uppercase tracking-[0.14em]"
      style={{ color: tone === "light" ? "#a6e3a1" : GREEN }}
    >
      {children}
    </p>
  );
}

function Button({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "bone" | "onGreen";
}) {
  const base =
    "inline-flex h-[47px] items-center justify-center gap-2 rounded-md px-5 text-[15px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2";
  const styles: Record<string, string> = {
    primary:
      "border border-[#175236] bg-[#1f6b45] text-white shadow-[0_1px_0_rgba(20,19,18,0.12)] hover:bg-[#175236]",
    secondary:
      "border border-[#d8d5ce] bg-white text-[#1c1b19] shadow-[0_1px_0_rgba(20,19,18,0.08)] hover:bg-[#fbfaf6]",
    bone: "bg-[#f4f3ee] text-[#1c1b19] hover:bg-white",
    onGreen: "border border-[#f4f3ee]/35 text-[#f4f3ee] hover:bg-[#175236]",
  };
  return (
    <Link href={href} className={`${base} ${styles[variant]}`}>
      {children}
    </Link>
  );
}

/** A real product capture, not a redrawn interface. */
function ProductScreenshot({
  src,
  alt,
  width,
  height,
  priority = false,
  className = "",
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  priority?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-lg border border-[#d8d5ce] bg-white shadow-[0_16px_60px_-30px_rgba(22,21,19,0.45)] ${className}`}
    >
      <Image
        src={src}
        alt={alt}
        width={width}
        height={height}
        priority={priority}
        sizes="(max-width: 1280px) 100vw, 1280px"
        className="h-auto w-full"
      />
    </div>
  );
}

const CAPABILITIES = [
  {
    icon: ClipboardList,
    title: "A brief your agent can start from",
    body: "One request plus its dated evidence, voters, comments and linked releases as stable Markdown — copied from the detail or fetched over the API and MCP.",
  },
  {
    icon: PenLine,
    title: "Markdown with preview",
    body: "Write, check the rendered entry, publish. Feature, Improvement or Fix, with cover art and multiple authors.",
  },
  {
    icon: Rocket,
    title: "Scheduling that holds",
    body: "Pick a date and a timezone. The entry goes live on its own; nothing waits in a drafts folder.",
  },
  {
    icon: MessageSquare,
    title: "Threaded replies",
    body: "Public replies, internal notes and comments on one request, with the internal ones never published.",
  },
  {
    icon: Map,
    title: "Roadmap from status",
    body: "Planned, in progress and shipped are the request's own state. Moving a card updates the public page.",
  },
  {
    icon: Puzzle,
    title: "Origin-locked widget",
    body: "One async script, shadow DOM, and an allowlist per product so the launcher only runs where you say.",
  },
  {
    icon: Undo2,
    title: "Win-back with approval",
    body: "Draft from a reason, review who is contactable, approve, canary, send. Publishing is never sending.",
  },
  {
    icon: BookOpen,
    title: "Help that feeds Mira",
    body: "Publish collections and articles to the portal. Mira answers from the published version and links the article it used.",
  },
  {
    icon: Code2,
    title: "Versioned API docs",
    body: "Import OpenAPI 3.1, review the diff, publish one live version, and try requests with scoped tokens.",
  },
  {
    icon: BarChart3,
    title: "Reports that count people once",
    body: "Sixteen product metrics, saved reports and daily series, with each survey response or tour completion deduplicated per recipient.",
  },
] as const;

const ASK_CARDS = [
  {
    icon: MessageSquare,
    title: "Surveys with a reason to answer",
    body: "NPS, CSAT and custom surveys with conditional questions. Active surveys sit on the portal and embed on any public page.",
  },
  {
    icon: Map,
    title: "Tours that explain the change",
    body: "Multi-step tours and pinned banners ship through the widget loader, with per-step targeting, dismissal memory and translated copy.",
  },
  {
    icon: BarChart3,
    title: "Analytics that stay honest",
    body: "Sixteen product-activity metrics, saved reports and daily series, including portal views, CSAT and Mira resolutions.",
  },
] as const;

/** Below desktop, a three-column comparison table is unreadable; stack each row. */
function UserJotComparison() {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:hidden">
        {USERJOT_COMPARISON.map((row) => (
          <div key={row.question} className="rounded-lg border border-[#d8d5ce] bg-white p-4">
            <h3 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[#6b6862]">
              {row.question}
            </h3>
            <dl className="mt-3 grid gap-3 text-[13px] leading-[1.55]">
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#6b6862]">
                  UserJot
                </dt>
                <dd className="mt-0.5 text-[#3f3d39]">{row.userjot}</dd>
              </div>
              <div className="border-t border-[#eae7df] pt-3">
                <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#1f6b45]">
                  Herald
                </dt>
                <dd className="mt-0.5 font-medium text-[#1c1b19]">{row.herald}</dd>
              </div>
            </dl>
          </div>
        ))}
      </div>

      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full min-w-[760px] border-collapse text-left">
          <caption className="sr-only">
            UserJot and Herald compared by price, products and agent workflow
          </caption>
          <thead>
            <tr className="border-b border-[#d8d5ce]">
              <th scope="col" className="py-3 text-[10px] font-medium uppercase tracking-[0.14em] text-[#6b6862]">
                Question
              </th>
              <th scope="col" className="w-[34%] py-3 text-[10px] font-medium uppercase tracking-[0.14em] text-[#6b6862]">
                UserJot
              </th>
              <th scope="col" className="w-[34%] py-3 text-[10px] font-medium uppercase tracking-[0.14em] text-[#1f6b45]">
                Herald
              </th>
            </tr>
          </thead>
          <tbody>
            {USERJOT_COMPARISON.map((row) => (
              <tr key={row.question} className="border-b border-[#eae7df]">
                <th scope="row" className="py-3.5 pr-4 text-left text-[14px] font-normal text-[#1c1b19]">
                  {row.question}
                </th>
                <td className="py-3.5 pr-4 text-[13px] leading-[1.55] text-[#3f3d39]">
                  {row.userjot}
                </td>
                <td className="py-3.5 text-[13px] font-medium leading-[1.55] text-[#1c1b19]">
                  {row.herald}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Featurebase's capability table follows the same mobile pattern. */
function FeaturebaseComparison() {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 md:hidden">
        {COMPARISON.map((row) => (
          <div key={row.job} className="rounded-lg border border-[#d8d5ce] bg-white p-4">
            <h3 className="text-[13px] font-medium leading-snug text-[#1c1b19]">{row.job}</h3>
            <dl className="mt-3 grid gap-2 text-[12px] leading-relaxed">
              <div className="flex items-start justify-between gap-3 border-t border-[#eae7df] pt-2">
                <dt className="text-[#6b6862]">Featurebase</dt>
                <dd className="text-right text-[#3f3d39]">
                  {row.featurebase ? "Yes" : "Not offered"}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="text-[#1f6b45]">Herald</dt>
                <dd className="text-right font-medium text-[#1c1b19]">Included</dd>
              </div>
            </dl>
          </div>
        ))}
      </div>

      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[640px] border-collapse text-left">
          <caption className="sr-only">
            Capabilities included by Featurebase and by Herald
          </caption>
          <thead>
            <tr className="border-b border-[#d8d5ce]">
              <th scope="col" className="py-3 text-[10px] font-medium uppercase tracking-[0.14em] text-[#6b6862]">
                Job to be done
              </th>
              <th scope="col" className="w-[20%] py-3 text-[10px] font-medium uppercase tracking-[0.14em] text-[#6b6862]">
                Featurebase
              </th>
              <th scope="col" className="w-[20%] py-3 text-[10px] font-medium uppercase tracking-[0.14em] text-[#1f6b45]">
                Herald
              </th>
            </tr>
          </thead>
          <tbody>
            {COMPARISON.map((row) => (
              <tr key={row.job} className="border-b border-[#eae7df] last:border-0">
                <th scope="row" className="py-3.5 pr-4 text-left text-[14px] font-normal text-[#1c1b19]">
                  {row.job}
                </th>
                <td className="py-3.5">
                  {row.featurebase ? (
                    <span className="inline-flex items-center gap-2 text-[13px] text-[#3f3d39]">
                      <Check className="size-4 text-[#1f6b45]" aria-hidden="true" />
                      Yes
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2 text-[13px] text-[#6b6862]">
                      <Minus className="size-4" aria-hidden="true" />
                      Not offered
                    </span>
                  )}
                </td>
                <td className="py-3.5">
                  <span className="inline-flex items-center gap-2 text-[13px] font-medium text-[#1c1b19]">
                    <Check className="size-4 text-[#1f6b45]" aria-hidden="true" />
                    Included
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function LandingPage() {
  return (
    <div className="min-h-screen bg-[#f4f3ee] text-[#1c1b19] antialiased [font-family:var(--font-inter)]">
      <JsonLd data={softwareApplicationSchema()} />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-[#1f6b45] focus:px-3 focus:py-2 focus:text-sm focus:text-white"
      >
        Skip to content
      </a>

      <div className="bg-[#1c1b19] text-[#f4f3ee]">
        <div className={`${CONTAINER} flex items-center justify-center gap-2.5 py-2.5 text-center`}>
          <span className="hidden shrink-0 text-[12px] font-semibold uppercase tracking-[0.1em] text-[#a6e3a1] sm:inline-block">
            New
          </span>
          <p className="min-w-0 text-[13px] leading-snug text-[#dedad2] sm:text-[14px]">
            Move your boards and votes over from Canny, Productboard or Nolt.
          </p>
          <Link
            href="/sign-up"
            className="hidden shrink-0 items-center gap-1 text-[13px] font-medium text-[#f4f3ee] underline-offset-4 hover:underline md:inline-flex"
          >
            Start free
            <ArrowRight className="size-3" aria-hidden="true" />
          </Link>
        </div>
      </div>

      <header className="sticky top-0 z-40 border-b border-[#dedad2] bg-[#f4f3ee]/95 backdrop-blur">
        <div
          className={`${CONTAINER} grid h-16 grid-cols-[1fr_auto] items-center gap-3 lg:grid-cols-[1fr_auto_1fr]`}
        >
          <Link href="/" className="flex shrink-0 items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-md bg-[#1f6b45] text-[#f4f3ee]">
              <Newspaper className="size-4" aria-hidden="true" />
            </span>
            <span className={`${DISPLAY} text-[18px] font-semibold tracking-[-0.02em]`}>Herald</span>
          </Link>

          <nav aria-label="Main" className="hidden items-center gap-1 text-[14px] text-[#4e4a44] lg:flex">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-md px-3 py-1.5 transition-colors hover:bg-[#eae7df] hover:text-[#1c1b19]"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto hidden items-center gap-2 sm:flex">
            <Link
              href="/sign-in"
              className="rounded-md px-3 py-1.5 text-[14px] text-[#4e4a44] transition-colors hover:text-[#1c1b19]"
            >
              Sign in
            </Link>
            <Link
              href="/sign-up"
              className="inline-flex h-[33px] items-center rounded-md border border-[#175236] bg-[#1f6b45] px-3 text-[13px] font-medium text-white hover:bg-[#175236]"
            >
              Start free
            </Link>
          </div>

          <details className="group relative ml-auto sm:hidden">
            <summary
              aria-label="Open menu"
              className="flex size-10 cursor-pointer list-none items-center justify-center rounded-md border border-[#d8d5ce] bg-white text-[#1c1b19] [&::-webkit-details-marker]:hidden"
            >
              <Menu className="size-5" aria-hidden="true" />
            </summary>
            <div className="absolute right-0 top-12 z-50 w-60 rounded-lg border border-[#d8d5ce] bg-white p-2 shadow-xl">
              <nav aria-label="Mobile" className="grid">
                {NAV_LINKS.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="rounded px-3 py-2 text-sm text-[#3f3d39] hover:bg-[#f4f3ee]"
                  >
                    {link.label}
                  </Link>
                ))}
              </nav>
              <div className="mt-2 grid gap-1.5 border-t border-[#e6e3da] p-2">
                <Link
                  href="/sign-in"
                  className="rounded border border-[#d8d5ce] px-3 py-2 text-center text-sm font-medium"
                >
                  Sign in
                </Link>
                <Link
                  href="/sign-up"
                  className="rounded bg-[#1f6b45] px-3 py-2 text-center text-sm font-medium text-white"
                >
                  Start free
                </Link>
              </div>
            </div>
          </details>
        </div>
      </header>

      <main id="main" tabIndex={-1}>
        <section className="bg-[#f4f3ee]">
          <div className={`${CONTAINER} flex flex-col items-center gap-4 pt-16 text-center lg:pt-24`}>
            <h1 className={`${H1} max-w-[900px]`}>
              One customer loop for every product you run.
            </h1>
            <p className="max-w-[720px] text-pretty text-[17px] leading-[1.45] text-[#4e4a44] sm:text-[19px] lg:text-[20px]">
              A feedback board, roadmap and changelog for each product — one account, one login.
              Every request becomes a Markdown brief with quotes, dates and demand, ready to paste
              into your coding agent.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2.5 pt-2">
              <Button href="/sign-up">
                Start free
                <ArrowRight className="size-4" aria-hidden="true" />
              </Button>
              <Button href="#plans" variant="secondary">
                See what&apos;s included
              </Button>
            </div>
            <Link
              href="/demo"
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#1f6b45] underline-offset-4 hover:underline"
            >
              Or look around the live product first
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
            <p className="text-[13px] text-[#6b6862]">
              Free: 1 product · Indie: 5 · Professional: unlimited · no credit card
            </p>
          </div>

          <div className={`${CONTAINER} mt-10 lg:mt-14`}>
            <ProductScreenshot
              src="/screenshots/herald-roadmap.png"
              alt="Herald's public roadmap, running on Herald, with planned and shipped feedback requests"
              width={2520}
              height={1080}
              priority
            />
          </div>
        </section>

        <section className="bg-[#1c1b19] text-[#f4f3ee]">
          <div
            className={`${CONTAINER} flex flex-col gap-2.5 py-6 sm:flex-row sm:items-baseline sm:gap-8 sm:py-7`}
          >
            <p className="shrink-0 text-[14px] text-[#a8a49c]">Built for founders who ship</p>
            <p className="text-pretty text-[15px] leading-snug text-[#dedad2]">
              Surveys, tours, help center, widget and win-back on every plan — no add-ons, no
              per-seat pricing.
            </p>
          </div>
        </section>

        <section className="bg-[#1c1b19] py-16 text-[#f4f3ee] lg:py-[104px]">
          <div className={`${CONTAINER} flex flex-col items-center text-center`}>
            <Eyebrow tone="light">Sound familiar?</Eyebrow>
            <h2 className={`${H2} mt-5 max-w-[860px]`}>
              This month, you shipped the fix. And nobody who asked for it heard about it.
            </h2>
            <p className="mt-5 max-w-[640px] text-[16px] leading-[1.55] text-[#b8b4ac] lg:text-[18px]">
              It is not for lack of caring. Five tools, five definitions of “shipped”, and a
              customer who cancelled two months ago with a reason nobody wrote down. Herald keeps
              the request, the release and the cancellation as one record.
            </p>
            <div className="mt-8 flex max-w-[880px] flex-wrap items-center justify-center gap-2">
              {FAMILIAR.map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-[#3a3733] px-3.5 py-1.5 text-[13px] text-[#dedad2]"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>
        </section>

        <section id="loop" className="scroll-mt-16 bg-[#f4f3ee] py-16 lg:py-[104px]">
          <div className={`${CONTAINER} flex flex-col gap-10`}>
            <div className="flex flex-col gap-4">
              <h2 className={`${H2} max-w-[760px]`}>Stop hoping the loop is closed. Know.</h2>
              <p className="max-w-[620px] text-[16px] leading-[1.55] text-[#4e4a44] lg:text-[18px]">
                Connect the board, the roadmap and the changelog to the one record your customers
                already voted on. Nothing is re-typed, and nothing ships quietly.
              </p>
            </div>

            <div className="grid gap-10 lg:grid-cols-3 lg:gap-8">
              {STEPS.map((step, index) => (
                <div key={step.title} className="flex flex-col gap-3 border-t border-[#d8d5ce] pt-5">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-medium tabular-nums text-[#6b6862]">
                      0{index + 1}
                    </span>
                    <step.icon className="size-4 text-[#1f6b45]" aria-hidden="true" />
                  </div>
                  <h3 className={`${DISPLAY} text-[1.35rem] font-semibold leading-snug`}>
                    {step.title}
                  </h3>
                  <p className="text-[15px] leading-[1.6] text-[#4e4a44]">{step.body}</p>
                </div>
              ))}
            </div>

            <div className="grid items-center gap-8 rounded-lg border border-[#d8d5ce] bg-white p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)] lg:p-8">
              <div className="flex flex-col gap-2">
                <p className="text-[12px] font-medium uppercase tracking-[0.14em] text-[#6b6862]">
                  The record behind the loop
                </p>
                <p className="text-[15px] leading-[1.6] text-[#4e4a44]">
                  Publishing marks both linked requests shipped, the public board now points at the
                  entry, and the cancellation reason still points at the release that answers it.
                </p>
              </div>
              <div className="rounded-md border border-[#e6e3da] bg-[#faf9f5] p-3">
                <div className="flex items-center gap-2 text-[11px] text-[#6b6862]">
                  <Check className="size-3.5 text-[#1f6b45]" aria-hidden="true" />
                  Release, requests and reasons linked
                </div>
                <ol className="mt-3 space-y-1.5 border-t border-[#e6e3da] pt-3 text-[11px] text-[#3f3d39]">
                  <li>Request · status became shipped</li>
                  <li>Release · linked in the changelog</li>
                  <li>Reason · matched for win-back</li>
                </ol>
              </div>
            </div>
          </div>
        </section>

        <section
          id="features"
          className="scroll-mt-16 bg-[#1c1b19] py-16 text-[#f4f3ee] lg:py-[104px]"
        >
          <div className={`${CONTAINER} flex flex-col gap-10 lg:gap-14`}>
            <div className="flex flex-col gap-4">
              <h2 className={`${H2} max-w-[760px]`}>
                The most complete customer loop you can run for every product.
              </h2>
              <p className="max-w-[640px] text-[16px] leading-[1.55] text-[#b8b4ac] lg:text-[18px]">
                A public board, roadmap, changelog, in-app widget, help center, surveys, tours,
                API docs and win-back in one place. Everything the customer loop needs and nothing
                it doesn&apos;t — no ticket engine, no CRM.
              </p>
            </div>

            <ProductScreenshot
              src="/screenshots/herald-feedback.png"
              alt="Herald's public feedback board with shipped, planned and improvement requests"
              width={2490}
              height={1200}
              className="border-[#3a3733]"
            />

            <div className="grid gap-4 md:grid-cols-3">
              {FEATURE_CARDS.map((card) => (
                <div key={card.title} className="rounded-lg bg-[#232220] p-6">
                  <h3 className={`${DISPLAY} text-[1.15rem] font-semibold leading-snug`}>
                    {card.title}
                  </h3>
                  <p className="mt-2 text-[13px] leading-[1.6] text-[#a8a49c]">{card.body}</p>
                </div>
              ))}
            </div>

            <div className="grid gap-x-8 gap-y-0 sm:grid-cols-2 lg:grid-cols-3">
              {CAPABILITIES.map((item) => (
                <div key={item.title} className="flex flex-col gap-2 border-t border-[#3a3733] py-6">
                  <item.icon className="size-4 text-[#a6e3a1]" aria-hidden="true" />
                  <p className="text-[15px] font-medium text-[#f4f3ee]">{item.title}</p>
                  <p className="text-[13px] leading-[1.6] text-[#a8a49c]">{item.body}</p>
                </div>
              ))}
            </div>

            <div className="flex max-w-[760px] flex-col gap-3">
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <Puzzle className="size-4 text-[#a6e3a1]" aria-hidden="true" />
                  <p className="text-[12px] font-medium uppercase tracking-[0.14em] text-[#a8a49c]">
                    The widget
                  </p>
                </div>
                <h3 className={`${DISPLAY} text-[1.5rem] font-semibold leading-tight lg:text-[1.9rem]`}>
                  One script tag. Changelog, feedback, roadmap and messages inside your app.
                </h3>
                <p className="max-w-[560px] text-[15px] leading-[1.6] text-[#a8a49c]">
                  An async script renders a shadow-DOM launcher, so your styles stay yours. Allow
                  your exact origins, and the unread badge stays current for signed-in customers.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <Button href="/sign-up" variant="bone">
                Start free
                <ArrowRight className="size-4" aria-hidden="true" />
              </Button>
              <p className="text-[13px] text-[#6b6862]">
                The public loop is on every plan. API access, Mira and SSO unlock on Professional.
              </p>
            </div>
          </div>
        </section>

        <section id="platform" className="scroll-mt-16 bg-[#f4f3ee] py-16 lg:py-[104px]">
          <div className={`${CONTAINER} flex flex-col gap-10`}>
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)] lg:items-end lg:gap-16">
              <div className="flex flex-col gap-4">
                <Eyebrow>The rest of the relationship</Eyebrow>
                <h2 className={`${H2} max-w-[640px]`}>
                  The answer, the docs and the follow-up live beside the loop.
                </h2>
              </div>
              <p className="max-w-[560px] text-[16px] leading-[1.55] text-[#4e4a44] lg:text-[18px]">
                Publishing an update is one moment. The same public home holds the help center
                customers search, the docs developers integrate against, and the surveys and tours
                that ask what happened next.
              </p>
            </div>

            <ProductScreenshot
              src="/screenshots/herald-portal.png"
              alt="Herald's customer portal showing feedback boards and the latest changelog updates"
              width={2520}
              height={1600}
            />

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="flex flex-col gap-5 rounded-lg border border-[#d8d5ce] bg-white p-6 lg:p-8">
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <BookOpen className="size-4 text-[#1f6b45]" aria-hidden="true" />
                    <p className="text-[12px] font-medium uppercase tracking-[0.14em] text-[#6b6862]">
                      Help center
                    </p>
                  </div>
                  <h3 className={`${DISPLAY} text-[1.35rem] font-semibold leading-snug`}>
                    Publish help once. Answer from the same articles.
                  </h3>
                  <p className="text-[14px] leading-[1.6] text-[#4e4a44]">
                    Collections and articles sit on the public portal, searchable beside updates
                    and feedback. Mira answers from the published version and cites the article it
                    used, so unpublishing removes it from future answers.
                  </p>
                </div>
                <p className="text-[12px] text-[#6b6862]">
                  Help is on every plan. Mira AI replies are part of Professional.
                </p>
              </div>

              <div className="flex flex-col gap-5 rounded-lg border border-[#d8d5ce] bg-white p-6 lg:p-8">
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <Code2 className="size-4 text-[#1f6b45]" aria-hidden="true" />
                    <p className="text-[12px] font-medium uppercase tracking-[0.14em] text-[#6b6862]">
                      API documentation
                    </p>
                  </div>
                  <h3 className={`${DISPLAY} text-[1.35rem] font-semibold leading-snug`}>
                    Ship the API and the page developers read.
                  </h3>
                  <p className="text-[14px] leading-[1.6] text-[#4e4a44]">
                    Import OpenAPI 3.1 from a file, URL or CI. Every import lands as a draft with a
                    reviewable diff; publish one live version and keep the history. The playground
                    uses your token&apos;s scopes, and a read-only token cannot send a write.
                  </p>
                </div>
                <p className="text-[12px] text-[#6b6862]">
                  Draft → review → one live version. Writes require a write-scoped token.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section id="ask" className="scroll-mt-16 bg-[#1c1b19] py-16 text-[#f4f3ee] lg:py-[104px]">
          <div className={`${CONTAINER} flex flex-col gap-10`}>
            <div className="flex flex-col gap-4">
              <Eyebrow tone="light">Ask at the right moment</Eyebrow>
              <h2 className={`${H2} max-w-[760px]`}>
                Surveys, tours and the numbers that follow them.
              </h2>
              <p className="max-w-[640px] text-[16px] leading-[1.55] text-[#b8b4ac] lg:text-[18px]">
                Ask while the customer is still in the product, show the tour that explains the
                change, and read the answer beside the request that caused it.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              {ASK_CARDS.map((card) => (
                <div
                  key={card.title}
                  className="flex flex-col gap-3 rounded-lg border border-[#3a3733] bg-[#232220] p-6"
                >
                  <card.icon className="size-4 text-[#a6e3a1]" aria-hidden="true" />
                  <h3 className={`${DISPLAY} text-[1.15rem] font-semibold leading-snug`}>
                    {card.title}
                  </h3>
                  <p className="text-[13px] leading-[1.6] text-[#a8a49c]">{card.body}</p>
                </div>
              ))}
            </div>

            <div className="flex items-start gap-3 rounded-lg border border-[#3a3733] bg-[#232220] px-4 py-3">
              <Check className="mt-0.5 size-4 shrink-0 text-[#a6e3a1]" aria-hidden="true" />
              <p className="text-[13px] leading-[1.6] text-[#dedad2]">
                A survey response or tour completion counts once per recipient in reports — not
                once per view, reload or resume.
              </p>
            </div>
          </div>
        </section>

        <section className="bg-[#1f6b45] py-16 text-[#f4f3ee] lg:py-[104px]">
          <div
            className={`${CONTAINER} grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)] lg:gap-16`}
          >
            <div className="flex flex-col gap-4">
              <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#c9e6d5]">
                Switching
              </p>
              <h2 className={`${H2} max-w-[600px]`}>
                The migration you keep putting off takes ten minutes.
              </h2>
              <p className="max-w-[540px] text-[16px] leading-[1.55] text-[#d3e8dc] lg:text-[18px]">
                Bring the board, the votes and the cancellation reasons. Everything you imported
                arrives as it was, and nothing is rewritten by the import itself.
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2.5">
                <Button href="/sign-up" variant="bone">
                  Start free
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Button>
                <Button href="#compare" variant="onGreen">
                  See what moves
                </Button>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-[#c9e6d5]">
                <span className="mr-1 uppercase tracking-[0.14em]">Imports from</span>
                {["CSV", "Public API", "Intercom", "Canny", "Nolt"].map((name) => (
                  <span key={name} className="rounded border border-[#f4f3ee]/25 px-2 py-0.5">
                    {name}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <div className="rounded-lg bg-[#f4f3ee] p-7 text-[#1c1b19]">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#1f6b45]">
                  What actually moves
                </p>
                <p className={`${DISPLAY} mt-3 text-[1.35rem] font-semibold leading-snug lg:text-[1.55rem]`}>
                  Feedback, votes, cancellations, subscribers and every release.
                </p>
                <ul className="mt-4 space-y-2 text-[14px] leading-[1.55] text-[#3f3d39]">
                  {MIGRATION_POINTS.map((item) => (
                    <li key={item} className="flex items-start gap-2.5">
                      <Check className="mt-0.5 size-4 shrink-0 text-[#1f6b45]" aria-hidden="true" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <p className="text-[12px] leading-[1.6] text-[#c9e6d5]">
                No board, vote, comment or reason is re-typed, and replaying the same file creates
                no duplicates.
              </p>
            </div>
          </div>
        </section>

        <section id="plans" className="scroll-mt-16 bg-[#f4f3ee] py-16 lg:py-[104px]">
          <div className={`${CONTAINER} flex flex-col gap-8`}>
            <h2 className={`${H2} max-w-[760px]`}>
              One account. Every product. No per-seat maths.
            </h2>
            <p className="max-w-[680px] text-[16px] leading-[1.55] text-[#4e4a44] lg:text-[18px]">
              Free covers one product. Indie covers five — each with five boards, its own roadmap
              and changelog — and Professional removes the product cap. The public loop is on every
              plan, and so is the request brief. Viewers never count as paid seats.
            </p>

            <PricingCards />

            <LifetimeOffer
              remaining={null}
              workspaceSlug={null}
              signedIn={false}
              href="/pricing#lifetime"
            />

            <p className="max-w-[760px] text-[13px] leading-relaxed text-[#6b6862]">
              Prices are per workspace in US dollars, billed monthly or yearly. Stripe Checkout
              shows the exact amount, any discount and tax before you pay. Win-back and the approval
              step are included on every plan, including the free one. Product limits on this page
              come from the same catalogue the server enforces.
            </p>
          </div>
        </section>

        <section
          id="compare"
          className="scroll-mt-16 border-t border-[#dedad2] bg-[#f4f3ee] py-16 lg:py-[104px]"
        >
          <div className={`${CONTAINER} flex flex-col gap-8`}>
            <h2 className={`${H2} max-w-[760px]`}>How Herald compares.</h2>
            <p className="max-w-[680px] text-[16px] leading-[1.55] text-[#4e4a44] lg:text-[18px]">
              UserJot and Featurebase both ship a good public loop. The difference is what one
              account covers, and what an agent gets to start from.
            </p>

            <div className="flex flex-wrap gap-2">
              {[
                { href: "/compare/canny", label: "Herald vs Canny" },
                { href: "/compare/featurebase", label: "Herald vs Featurebase" },
                { href: "/compare/userjot", label: "Herald vs UserJot" },
              ].map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#d8d5ce] bg-white px-3 text-[13px] font-medium text-[#1c1b19] hover:border-[#1f6b45] hover:text-[#1f6b45]"
                >
                  {link.label}
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </Link>
              ))}
            </div>

            <UserJotComparison />

            <p className="max-w-[860px] text-[13px] leading-relaxed text-[#6b6862]">
              UserJot plan details and prices were checked on 22 November 2026 and can change.
              Verify anything that decides a purchase on their page, or read the{" "}
              <Link href="/compare/userjot" className="text-[#1f6b45] underline">
                dated comparison with sources
              </Link>
              .
            </p>

            <h3 className={`${DISPLAY} mt-4 text-[1.6rem] font-semibold leading-tight`}>
              Featurebase, as a capability check.
            </h3>
            <p className="max-w-[680px] text-[15px] leading-[1.55] text-[#4e4a44]">
              Featurebase is a good product with more surface area than most founders need. This
              table checks which jobs each product covers; it is not the pricing story.
            </p>

            <FeaturebaseComparison />

            <p className="max-w-[860px] text-[13px] leading-relaxed text-[#6b6862]">
              Featurebase capabilities and prices were read from their published product and
              pricing pages on 7 November 2026 and can change. Verify anything that decides a
              purchase at featurebase.app/pricing, or read the{" "}
              <Link href="/compare/featurebase" className="text-[#1f6b45] underline">
                dated comparison with sources
              </Link>
              .
            </p>
          </div>
        </section>

        <section id="faq" className="scroll-mt-16 bg-[#f4f3ee] py-16 lg:py-[104px]">
          <div
            className={`${CONTAINER} grid gap-10 lg:grid-cols-[minmax(0,400px)_minmax(0,640px)] lg:justify-between lg:gap-20`}
          >
            <div className="flex flex-col gap-4 lg:sticky lg:top-24 lg:self-start">
              <h2 className={`${H2} max-w-[400px]`}>
                The things people ask before they switch.
              </h2>
              <p className="text-[15px] leading-[1.6] text-[#4e4a44]">
                Anything missing? The product is the documentation — start free and look around.
              </p>
            </div>

            <div className="border-t border-[#d8d5ce]">
              {FAQ.map((item) => (
                <details key={item.question} className="group border-b border-[#d8d5ce]">
                  <summary className="flex cursor-pointer list-none items-start gap-3 py-[22px] text-[16px] text-[#1c1b19] [&::-webkit-details-marker]:hidden">
                    <span className="flex-1 font-medium">{item.question}</span>
                    <ChevronDown
                      className="mt-1 size-4 shrink-0 text-[#6b6862] transition-transform group-open:rotate-180"
                      aria-hidden="true"
                    />
                  </summary>
                  <p className="max-w-[600px] pb-5 pr-6 text-[14px] leading-[1.65] text-[#4e4a44]">
                    {item.answer}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#1c1b19] py-16 text-[#f4f3ee] lg:py-[104px]">
          <div className={`${CONTAINER} flex flex-col items-center gap-5 text-center`}>
            <h2 className={`${H2} max-w-[760px]`}>
              Your customers told you what to build. Finish the loop in ten minutes.
            </h2>
            <div className="flex flex-wrap items-center justify-center gap-2.5">
              <Button href="/sign-up">
                Start free
                <ArrowRight className="size-4" aria-hidden="true" />
              </Button>
              <Button href="/sign-in" variant="onGreen">
                I already have an account
              </Button>
            </div>
            <p className="text-[13px] text-[#a8a49c]">
              Free to start · paid plans from $19 per workspace · export your data whenever
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#302d29] bg-[#1c1b19] pb-8 pt-14 text-[#f4f3ee] lg:pt-16">
        <div className={`${CONTAINER} flex flex-col gap-10`}>
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))] lg:gap-8">
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2.5">
                <span className="flex size-8 items-center justify-center rounded-md bg-[#f4f3ee] text-[#1c1b19]">
                  <Newspaper className="size-4" aria-hidden="true" />
                </span>
                <span className={`${DISPLAY} text-[18px] font-semibold tracking-[-0.02em]`}>
                  Herald
                </span>
              </div>
              <p className="max-w-[300px] text-[13px] leading-[1.6] text-[#a8a49c]">
                Feedback, changelog, roadmap, help, surveys, tours, API docs, widget and win-back
                in one loop — priced per workspace, not per seat.
              </p>
            </div>

            {FOOTER_COLUMNS.map((column) => (
              <div key={column.title} className="flex flex-col gap-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8c887f]">
                  {column.title}
                </p>
                <ul className="flex flex-col gap-2 text-[13px] text-[#dedad2]">
                  {column.links.map((link) => (
                    <li key={link.href}>
                      <Link href={link.href} className="transition-colors hover:text-[#a6e3a1]">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-2 border-t border-[#302d29] pt-5 text-[12px] text-[#8c887f] sm:flex-row sm:items-center sm:justify-between">
            <p>© {currentYear()} Herald</p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <ConsentSettingsButton />
              <p>Win-back campaigns are sent only after explicit approval.</p>
            </div>
          </div>
        </div>
      </footer>
      <ConsentBanner />
    </div>
  );
}
