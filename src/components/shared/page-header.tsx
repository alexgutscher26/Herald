import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export { EmptyState } from "@/components/shared/empty-state";

type PageHeaderProps = {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  className?: string;
};

/** Consistent heading block used by every dashboard route. */
export function PageHeader({ title, description, actions, meta, className }: PageHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 space-y-1.5">
          <h1 className="[font-family:var(--font-archivo)] text-[26px] font-semibold leading-[1.1] tracking-[-0.02em] text-foreground sm:text-[30px]">
            {title}
          </h1>
          {description ? (
            <div className="max-w-2xl text-[13.5px] leading-relaxed text-muted-foreground">
              {description}
            </div>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {meta ? (
        <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-muted-foreground">
          {meta}
        </div>
      ) : null}
    </div>
  );
}
