import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function SettingsSectionHeader({
  icon: Icon,
  title,
  description,
  badge,
  action,
}: {
  icon: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  badge?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[8px] border border-border/80 bg-muted/60 text-muted-foreground">
          <Icon className="size-4" strokeWidth={1.8} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="[font-family:var(--font-archivo)] text-[15px] font-semibold leading-snug tracking-[-0.01em] text-foreground">
              {title}
            </h2>
            {badge}
          </div>
          {description ? (
            <p className="mt-1 max-w-2xl text-[13px] leading-5 text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {action ? <div className="shrink-0 sm:pt-0.5">{action}</div> : null}
    </div>
  );
}

export function SettingsSection({
  id,
  icon,
  title,
  description,
  badge,
  action,
  children,
  footer,
  className,
  contentClassName,
}: {
  id?: string;
  icon: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  badge?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Card id={id} className={cn("scroll-mt-24 overflow-hidden", className)}>
      <div className="p-5 pb-0">
        <SettingsSectionHeader
          icon={icon}
          title={title}
          description={description}
          badge={badge}
          action={action}
        />
      </div>
      <div className={cn("p-5", contentClassName)}>{children}</div>
      {footer ? (
        <div className="border-t border-border/70 bg-muted/15 px-5 py-3.5">{footer}</div>
      ) : null}
    </Card>
  );
}
