import { Activity, ArrowRight, BookOpen, Compass, LogIn, Newspaper } from "lucide-react";
import Link from "next/link";

const FOOTER_LINKS = [
  { label: "Documentation", href: "/docs", icon: BookOpen },
  { label: "Roadmap", href: "/roadmap", icon: Compass },
  { label: "Service status", href: "/status", icon: Activity },
  { label: "Sign in", href: "/sign-in", icon: LogIn },
] as const;

export default function NotFound() {
  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-[#f4f3ee] text-[#1c1b19]">
      <meta name="robots" content="noindex, follow" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-10%,rgba(31,107,69,0.16),transparent_62%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.5] [background-image:linear-gradient(to_right,rgba(28,27,25,0.055)_1px,transparent_1px),linear-gradient(to_bottom,rgba(28,27,25,0.055)_1px,transparent_1px)] [background-size:64px_64px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_72%)] dark:opacity-0"
      />

      <div className="relative mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-6 py-16">
        <Link href="/" className="inline-flex w-fit items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-md bg-[#1f6b45] text-[#f4f3ee]">
            <Newspaper className="size-4" aria-hidden="true" />
          </span>
          <span className="[font-family:var(--font-archivo)] text-[18px] font-semibold tracking-[-0.02em]">
            Herald
          </span>
        </Link>

        <p className="mt-12 font-mono text-[12px] font-semibold uppercase tracking-[0.18em] text-[#6b6862]">
          404 · Not found
        </p>
        <h1 className="mt-3 max-w-xl [font-family:var(--font-archivo)] text-[clamp(2.25rem,6vw,3.5rem)] font-semibold leading-[1.03] tracking-[-0.04em]">
          This page isn’t here.
        </h1>
        <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-[#4e4a44]">
          The link may be out of date, or the page was moved or removed. Your workspace, changelog
          and feedback boards are unaffected.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            href="/"
            className="inline-flex h-10 items-center gap-1.5 rounded-md border border-[#175236] bg-[#1f6b45] px-4 text-[14px] font-medium text-white transition-colors hover:bg-[#175236]"
          >
            Go to Herald
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
          <Link
            href="/pricing"
            className="inline-flex h-10 items-center rounded-md border border-[#d8d5ce] bg-white px-4 text-[14px] font-medium text-[#1c1b19] transition-colors hover:bg-[#eae7df]"
          >
            See plans and pricing
          </Link>
        </div>

        <div className="mt-12 border-t border-[#dedad2] pt-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6b6862]">
            Looking for something else?
          </p>
          <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-3">
            {FOOTER_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="inline-flex items-center gap-2 text-[14px] text-[#4e4a44] underline-offset-4 transition-colors hover:text-[#1c1b19] hover:underline"
                >
                  <link.icon className="size-4 text-[#6b6862]" aria-hidden="true" />
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  );
}
