import { BookOpen, FileQuestion, LayoutDashboard } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function DashboardNotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-8 text-center shadow-[0_1px_2px_rgba(23,22,20,0.06),0_16px_40px_-28px_rgba(23,22,20,0.4)] sm:p-10">
        <span className="mx-auto flex size-12 items-center justify-center rounded-xl border border-border bg-muted text-muted-foreground">
          <FileQuestion className="size-5" aria-hidden="true" />
        </span>
        <p className="mt-5 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          404 · Not found
        </p>
        <h1 className="mt-2 [font-family:var(--font-archivo)] text-[26px] font-semibold leading-tight tracking-[-0.03em]">
          We couldn’t find that page
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-[14px] leading-relaxed text-muted-foreground">
          This workspace or product does not exist, or your account is not a member of it. Check
          the address, or ask a workspace admin to invite you.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <Button asChild>
            <Link href="/app">
              <LayoutDashboard aria-hidden="true" />
              Back to overview
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/docs">
              <BookOpen aria-hidden="true" />
              Browse the docs
            </Link>
          </Button>
        </div>
        <p className="mt-6 text-xs text-muted-foreground">
          Still stuck?{" "}
          <a
            className="text-primary underline-offset-4 hover:underline"
            href="mailto:support@herald.app?subject=Herald%20support%3A%20cannot%20reach%20a%20workspace%20page"
          >
            Email support
          </a>
        </p>
      </div>
    </div>
  );
}
