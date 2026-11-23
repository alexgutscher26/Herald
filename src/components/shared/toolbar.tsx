import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between", className)}>
      {children}
    </div>
  );
}

export function ToolbarGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center gap-2", className)}>{children}</div>;
}

export function ResultCount({
  shown,
  total,
  noun,
  className,
}: {
  shown: number;
  total: number;
  noun: string;
  className?: string;
}) {
  return (
    <p className={cn("text-xs tabular-nums text-muted-foreground", className)} aria-live="polite">
      Showing {shown} of {total} {noun}
    </p>
  );
}
