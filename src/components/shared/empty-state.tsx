import { Inbox, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type EmptyStateProps = {
  /** Surface-specific icon. Defaults to an inbox so every empty state has one. */
  icon?: LucideIcon;
  title: string;
  /** One sentence. Say what is missing, not how the product works. */
  description: string;
  /** At most one control: the next useful action. */
  action?: ReactNode;
  className?: string;
  compact?: boolean;
};

/**
 * The single empty / no-results state.
 *
 * Every surface uses this shape: icon, a short title, one sentence and at most
 * one action. Filters and permission limits are explained in the description;
 * the card never invents content or shows a status chip.
 */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
  compact = false,
}: EmptyStateProps) {
  return (
    <div
      data-empty-state
      className={cn(
        "flex flex-col items-center justify-center rounded-[10px] border border-dashed border-input bg-card/70 px-6 text-center",
        compact ? "py-8" : "min-h-56 py-12",
        className,
      )}
    >
      <span className="mb-3 flex size-10 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
        <Icon className="size-4.5" aria-hidden="true" />
      </span>
      <h3 className="[font-family:var(--font-archivo)] text-[15px] font-semibold tracking-[-0.01em]">
        {title}
      </h3>
      <p className="mx-auto mt-1 max-w-md text-[13px] leading-relaxed text-muted-foreground">
        {description}
      </p>
      {action ? <div className="mt-4 flex items-center gap-2">{action}</div> : null}
    </div>
  );
}
