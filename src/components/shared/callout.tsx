import { Info, Lock, ShieldAlert, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type CalloutTone = "info" | "warning" | "danger" | "neutral";

const STYLES: Record<CalloutTone, string> = {
  info: "border-info/30 bg-info-muted text-info",
  warning: "border-warning/30 bg-warning-muted text-warning",
  danger: "border-destructive/25 bg-destructive/5 text-destructive",
  neutral: "border-border bg-muted/50 text-muted-foreground",
};

const ICONS = {
  info: Info,
  warning: TriangleAlert,
  danger: ShieldAlert,
  neutral: Info,
};

export function Callout({
  tone = "info",
  title,
  children,
  className,
  icon: CustomIcon,
}: {
  tone?: CalloutTone;
  title?: string;
  children: ReactNode;
  className?: string;
  icon?: typeof Info;
}) {
  const Icon = CustomIcon ?? ICONS[tone];
  return (
    <div className={cn("flex gap-2.5 rounded-md border p-3 text-xs leading-relaxed", STYLES[tone], className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        {title ? <p className="mb-0.5 text-sm font-semibold">{title}</p> : null}
        <div className={tone === "info" ? "text-foreground/80" : undefined}>{children}</div>
      </div>
    </div>
  );
}

export function ReadOnlyNotice({ role }: { role: string }) {
  return (
    <Callout tone="warning" icon={Lock} title={`Read-only for the ${role} role`}>
      This page shows the stored configuration, but changing it requires admin permission. UI
      affordances are not authorization: mutations must re-check the session and workspace role on
      the server.
    </Callout>
  );
}
