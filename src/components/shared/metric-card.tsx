import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { InfoTip } from "@/components/shared/info-tip";
import { cn } from "@/lib/utils";

type MetricCardProps = {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  definition: string;
  icon?: LucideIcon;
  className?: string;
};

export function MetricCard({
  label,
  value,
  hint,
  definition,
  icon: Icon,
  className,
}: MetricCardProps) {
  return (
    <div
      className={cn(
        "rounded-[10px] border bg-card p-4 shadow-[0_1px_2px_rgba(23,22,20,0.04)]",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {Icon ? <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}
          <span className="truncate text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            {label}
          </span>
        </div>
        <InfoTip text={definition} />
      </div>
      <p className="mt-2.5 [font-family:var(--font-archivo)] text-[27px] font-semibold leading-none tracking-[-0.02em] tabular-nums">
        {value}
      </p>
      {hint ? <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
