import { FileQuestion, LifeBuoy } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

/**
 * Public 404.
 *
 * Unknown workspaces, products and boards, private boards and archived boards
 * all land here with the same wording so the page never confirms that a
 * non-public board exists. There is deliberately no workspace-specific data on
 * it: a not-found boundary has no route params, and guessing from the request
 * would be a disclosure in itself.
 */
export default function PublicNotFound() {
  return (
    <main
      id="public-main"
      tabIndex={-1}
      className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center px-4 py-16 sm:px-6"
    >
      <meta name="robots" content="noindex, nofollow" />
      <div className="rounded-xl border border-border bg-card p-8 text-center shadow-sm sm:p-10">
        <span className="mx-auto flex size-12 items-center justify-center rounded-xl border border-border bg-muted text-muted-foreground">
          <FileQuestion className="size-5" aria-hidden="true" />
        </span>
        <p className="mt-5 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          404 · Not found
        </p>
        <h1 className="mt-2 [font-family:var(--font-archivo)] text-[26px] font-semibold leading-tight tracking-[-0.03em] text-foreground">
          This page isn’t available
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
          This page may have been removed, archived, or the link is incorrect. Nothing else in this
          portal has changed.
        </p>
        <div className="mt-6 flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:items-center">
          <Button asChild>
            <Link href="/">Go to Herald</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/status">
              <LifeBuoy aria-hidden="true" />
              Service status
            </Link>
          </Button>
        </div>
      </div>
      <p className="mt-6 text-center text-xs text-muted-foreground">
        Looking for a team’s help centre? Use the link they shared with you.
      </p>
    </main>
  );
}
