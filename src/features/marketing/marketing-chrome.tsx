import { Newspaper } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { ConsentBanner } from "@/features/consent/consent-banner";
import { ConsentSettingsButton } from "@/features/consent/consent-settings-button";

const CONTAINER = "mx-auto w-full max-w-[1280px] px-5 sm:px-8 lg:px-20";
const DISPLAY = "[font-family:var(--font-archivo)] tracking-[-0.035em]";

/**
 * Shared chrome for the marketing routes outside the landing page.
 *
 * It deliberately repeats the landing page's header and footer rather than
 * pulling the whole landing page into a client boundary: these pages are
 * server-rendered and only the pricing switcher needs JavaScript.
 */
export function MarketingHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-[#dedad2] bg-[#f4f3ee]/95 backdrop-blur">
      <div className={`${CONTAINER} flex h-16 items-center gap-4`}>
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-md bg-[#1f6b45] text-[#f4f3ee]">
            <Newspaper className="size-4" aria-hidden="true" />
          </span>
          <span className={`${DISPLAY} text-[18px] font-semibold tracking-[-0.02em]`}>Herald</span>
        </Link>

        <nav
          aria-label="Main"
          className="ml-auto hidden items-center gap-1 text-[14px] text-[#4e4a44] sm:flex"
        >
          <Link href="/pricing" className="rounded-md px-3 py-1.5 hover:bg-[#eae7df]">
            Pricing
          </Link>
          <Link href="/compare" className="rounded-md px-3 py-1.5 hover:bg-[#eae7df]">
            Compare
          </Link>
          <Link href="/demo" className="rounded-md px-3 py-1.5 hover:bg-[#eae7df]">
            Demo
          </Link>
          <Link href="/docs" className="rounded-md px-3 py-1.5 hover:bg-[#eae7df]">
            Docs
          </Link>
          <Link href="/roadmap" className="rounded-md px-3 py-1.5 hover:bg-[#eae7df]">
            Roadmap
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-2 sm:ml-0">
          <Link
            href="/sign-in"
            className="hidden rounded-md px-3 py-1.5 text-[14px] text-[#4e4a44] hover:text-[#1c1b19] sm:block"
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
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-[#d8d5ce] bg-[#f4f3ee]">
      <div className={`${CONTAINER} grid gap-8 py-12 sm:grid-cols-2 lg:grid-cols-4`}>
        <div>
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-md bg-[#1f6b45] text-[#f4f3ee]">
              <Newspaper className="size-4" aria-hidden="true" />
            </span>
            <span className={`${DISPLAY} text-[18px] font-semibold`}>Herald</span>
          </Link>
          <p className="mt-3 max-w-[240px] text-[13px] leading-relaxed text-[#6b6862]">
            One customer loop for every product you run.
          </p>
        </div>

        <FooterColumn
          title="Product"
          links={[
            { label: "Pricing", href: "/pricing" },
            { label: "Compare", href: "/compare" },
            { label: "Demo", href: "/demo" },
            { label: "Docs", href: "/docs" },
            { label: "Open source", href: "/open-source" },
            { label: "Roadmap", href: "/roadmap" },
            { label: "Status", href: "/status" },
            { label: "Trust", href: "/trust" },
          ]}
        />
        <FooterColumn
          title="Start"
          links={[
            { label: "Start free", href: "/sign-up" },
            { label: "Sign in", href: "/sign-in" },
            { label: "Dashboard", href: "/app" },
          ]}
        />
        <FooterColumn
          title="Legal"
          links={[
            { label: "Privacy", href: "/legal/privacy" },
            { label: "Terms", href: "/legal/terms" },
            { label: "DPA", href: "/legal/dpa" },
            { label: "Sub-processors", href: "/legal/subprocessors" },
            { label: "Data residency", href: "/legal/data-residency" },
            { label: "Accessibility", href: "/accessibility" },
          ]}
        />
      </div>
      <div className={`${CONTAINER} flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[#d8d5ce] py-4 text-xs text-[#6b6862]`}>
        <ConsentSettingsButton />
      </div>
      <ConsentBanner />
    </footer>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: readonly { label: string; href: string }[];
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6b6862]">
        {title}
      </p>
      <ul className="mt-3 grid gap-2 text-[14px] text-[#3f3d39]">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="hover:text-[#1f6b45]">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MarketingPage({
  children,
  eyebrow,
  title,
  intro,
  actions,
}: {
  children: ReactNode;
  eyebrow: string;
  title: string;
  intro: string;
  actions?: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#f4f3ee] text-[#1c1b19] antialiased [font-family:var(--font-inter)]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:border focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-medium"
      >
        Skip to content
      </a>
      <MarketingHeader />
      <main id="main" tabIndex={-1}>
        <section className="border-b border-[#dedad2]">
          <div className={`${CONTAINER} py-14 lg:py-20`}>
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#1f6b45]">
              {eyebrow}
            </p>
            <h1
              className={`${DISPLAY} mt-4 max-w-[880px] text-balance text-[2.4rem] font-semibold leading-[1.02] sm:text-[3.2rem]`}
            >
              {title}
            </h1>
            <p className="mt-5 max-w-[720px] text-[16px] leading-[1.6] text-[#4e4a44] sm:text-[18px]">
              {intro}
            </p>
            {actions ? <div className="mt-7 flex flex-wrap gap-2.5">{actions}</div> : null}
          </div>
        </section>
        {children}
      </main>
      <MarketingFooter />
    </div>
  );
}

export function MarketingButton({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary";
}) {
  return (
    <Link
      href={href}
      className={
        variant === "primary"
          ? "inline-flex h-[47px] items-center justify-center gap-2 rounded-md border border-[#175236] bg-[#1f6b45] px-5 text-[15px] font-medium text-white hover:bg-[#175236]"
          : "inline-flex h-[47px] items-center justify-center gap-2 rounded-md border border-[#d8d5ce] bg-white px-5 text-[15px] font-medium text-[#1c1b19] hover:bg-[#fbfaf6]"
      }
    >
      {children}
    </Link>
  );
}
