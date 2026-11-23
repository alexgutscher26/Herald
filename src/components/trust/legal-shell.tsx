import Link from "next/link";
import type { ReactNode } from "react";

import { ConsentBanner } from "@/features/consent/consent-banner";
import { ConsentSettingsButton } from "@/features/consent/consent-settings-button";
import { TRUST_LAST_UPDATED } from "@/features/trust/content";

/**
 * Shared chrome for the public trust pages.
 *
 * These routes are deliberately plain server components: a procurement reader
 * must be able to load them without an account, JavaScript or a workspace.
 */

export const TRUST_NAV = [
  { href: "/trust", label: "Security" },
  { href: "/legal/privacy", label: "Privacy" },
  { href: "/legal/terms", label: "Terms" },
  { href: "/legal/dpa", label: "DPA" },
  { href: "/legal/subprocessors", label: "Sub-processors" },
  { href: "/legal/data-residency", label: "Data residency" },
  { href: "/accessibility", label: "Accessibility" },
] as const;

export function LegalShell({
  title,
  summary,
  children,
}: {
  title: string;
  summary: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <a
        href="#legal-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:border focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground"
      >
        Skip to content
      </a>
      <main id="legal-main" tabIndex={-1} className="min-h-screen bg-background">
        <header className="border-b bg-card">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-5 py-6 sm:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link href="/" className="text-sm font-semibold tracking-tight">
              Herald
            </Link>
            <nav aria-label="Trust pages" className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
              {TRUST_NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="text-muted-foreground hover:text-foreground"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Trust centre · updated {TRUST_LAST_UPDATED}
            </p>
            <h1 className="mt-2 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              {title}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {summary}
            </p>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-4xl px-5 py-10 sm:px-8">{children}</div>

      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-4xl flex-wrap gap-x-5 gap-y-2 px-5 py-6 text-xs text-muted-foreground sm:px-8">
          {TRUST_NAV.map((item) => (
            <Link key={item.href} href={item.href} className="hover:text-foreground">
              {item.label}
            </Link>
          ))}
          <Link href="/status" className="hover:text-foreground">
            Status
          </Link>
          <ConsentSettingsButton className="hover:text-foreground" />
          <Link href="/" className="ml-auto hover:text-foreground">
            Herald home
          </Link>
        </div>
      </footer>
      </main>
      <ConsentBanner />
    </div>
  );
}

export function ProseSection({
  id,
  title,
  paragraphs,
}: {
  id?: string | undefined;
  title: string;
  paragraphs: readonly string[];
}) {
  return (
    <section id={id} className="scroll-mt-6 border-t py-6 first:border-t-0 first:pt-0">
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      <div className="mt-2 space-y-2.5">
        {paragraphs.map((paragraph) => (
          <p key={paragraph} className="text-sm leading-relaxed text-muted-foreground">
            {paragraph}
          </p>
        ))}
      </div>
    </section>
  );
}
