"use client";

import { AlertTriangle, ArrowLeft, LifeBuoy, RotateCcw } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ErrorStateProps = {
  title: string;
  description: string;
  /** Short status such as `403` or `Error`. Rendered above the title. */
  code?: string | undefined;
  /** Retry the failed render. Omit when retrying cannot help (for example a 403). */
  onRetry?: (() => void) | undefined;
  /** `/p/{workspace}/{product}/support?...` or a prefilled mailto link. */
  supportHref: string;
  statusHref?: string | undefined;
  backHref?: string | undefined;
  backLabel?: string | undefined;
  /** Error digest or request id shown without exposing internals. */
  reference?: string | undefined;
  footer?: ReactNode | undefined;
  className?: string | undefined;
};

/**
 * The single error pattern: what happened, a retry, and a support link that
 * already carries the route and reference. Error boundaries only choose the
 * copy, the retry handler and the prefilled support URL.
 */
export function ErrorState({
  title,
  description,
  code,
  onRetry,
  supportHref,
  statusHref,
  backHref,
  backLabel = "Go back",
  reference,
  footer,
  className,
}: ErrorStateProps) {
  return (
    <div
      data-error-state
      className={cn(
        "flex min-h-64 flex-col items-center justify-center px-6 py-16 text-center",
        className,
      )}
    >
      <span className="relative flex size-12 items-center justify-center rounded-xl border border-border bg-card text-destructive shadow-[0_1px_2px_rgba(23,22,20,0.06)]">
        <span
          aria-hidden="true"
          className="absolute -inset-2 -z-10 rounded-2xl bg-destructive/[0.06]"
        />
        <AlertTriangle className="size-5" aria-hidden="true" />
      </span>

      {code ? (
        <p className="mt-5 inline-flex items-center rounded-full border border-border bg-card px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {code}
        </p>
      ) : null}

      <h1 className="mt-3 [font-family:var(--font-archivo)] text-[26px] font-semibold leading-tight tracking-[-0.03em]">
        {title}
      </h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p>

      <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
        {onRetry ? (
          <Button onClick={onRetry} variant="outline">
            <RotateCcw aria-hidden="true" />
            Try again
          </Button>
        ) : null}
        <Button asChild variant={onRetry ? "default" : "outline"}>
          <Link href={supportHref}>
            <LifeBuoy aria-hidden="true" />
            Contact support
          </Link>
        </Button>
        {backHref ? (
          <Button asChild variant="ghost">
            <Link href={backHref}>
              <ArrowLeft aria-hidden="true" />
              {backLabel}
            </Link>
          </Button>
        ) : null}
        {statusHref ? (
          <Button asChild variant="ghost">
            <Link href={statusHref}>Service status</Link>
          </Button>
        ) : null}
      </div>

      {reference ? (
        <p className="mt-6 text-xs text-muted-foreground">
          Reference:{" "}
          <span className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
            {reference}
          </span>
        </p>
      ) : null}
      {footer ? <div className="mt-3 text-xs text-muted-foreground">{footer}</div> : null}
    </div>
  );
}
