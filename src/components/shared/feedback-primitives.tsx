import { ArrowBigUp } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Presentational pieces shared by the team inbox and public feedback pages.
 *
 * These components take only display values. They never read the dashboard
 * snapshot or a database row, so a public page can reuse the look without
 * gaining access to internal data.
 */

export function VoteCountBox({
  count,
  label,
  ariaLabel,
  className,
  locale = "en",
}: {
  count: number;
  label?: string;
  ariaLabel?: string;
  className?: string;
  /** Public pages pass the active locale; dashboard calls keep English digits. */
  locale?: string;
}) {
  const displayCount = new Intl.NumberFormat(locale).format(count);

  return (
    <span
      aria-label={ariaLabel}
      className={cn(
        "flex h-fit shrink-0 flex-col items-center rounded-md border bg-muted/40",
        label ? "w-12 py-1.5" : "w-9 py-1",
        className,
      )}
    >
      <ArrowBigUp className="size-3.5 text-muted-foreground" aria-hidden="true" />
      <span className="text-sm font-semibold tabular-nums">{displayCount}</span>
      {label ? (
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
      ) : null}
    </span>
  );
}

/** A board tag shown as a compact chip with its optional colour. */
export function TagChip({
  name,
  color,
  className,
}: {
  name: string;
  color: string | null;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-xs",
        className,
      )}
    >
      {color ? (
        <span
          aria-hidden="true"
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
      ) : null}
      <span className="truncate">{name}</span>
    </span>
  );
}
