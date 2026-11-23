"use client";

import { Lock } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { getNavItems, NAV_GROUPS } from "@/components/layout/nav-items";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { hasPermission, type WorkspaceRole } from "@/lib/permissions";
import { cn } from "@/lib/utils";

type SidebarNavProps = {
  workspaceSlug: string;
  productSlug: string;
  role: WorkspaceRole;
  collapsed?: boolean | undefined;
  onNavigate?: (() => void) | undefined;
};

/**
 * Shared navigation list for the desktop sidebar and mobile sheet.
 *
 * Only sections backed by a working page are listed; unbuilt placeholders are
 * kept out until they ship. Every listed section stays visible so read-only
 * roles can still inspect the data, with a small lock when they cannot manage
 * it. This is a usability affordance, never the authorization itself.
 */
export function SidebarNav({
  workspaceSlug,
  productSlug,
  role,
  collapsed = false,
  onNavigate = () => {},
}: SidebarNavProps) {
  const pathname = usePathname();
  const base = `/app/${workspaceSlug}/${productSlug}`;
  const items = getNavItems(workspaceSlug, productSlug);
  const groups = NAV_GROUPS.map((label) => ({
    label,
    items: items
      .filter((item) => item.group === label)
      .map((item) => ({
        item,
        active:
          item.segment === ""
            ? pathname === base
            : pathname === `${base}/${item.segment}` ||
              pathname.startsWith(`${base}/${item.segment}/`),
      })),
  })).filter((group) => group.items.length > 0);

  return (
    <nav aria-label="Product sections" className="flex flex-col">
      {groups.map((group, groupIndex) => {
        const groupActive = group.items.some((entry) => entry.active);

        return (
          <div
            key={group.label}
            className={cn("flex flex-col gap-0.5", groupIndex > 0 && "mt-3")}
          >
            {collapsed ? (
              groupIndex > 0 ? (
                <div
                  className="mx-auto mb-2 mt-1 h-px w-6 rounded-full bg-sidebar-border"
                  aria-hidden="true"
                />
              ) : null
            ) : (
              <p
                className={cn(
                  "mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.14em]",
                  groupActive ? "text-foreground/60" : "text-muted-foreground/75",
                )}
              >
                {group.label}
              </p>
            )}

            {group.items.map(({ item, active }) => {
              const canManage = hasPermission(role, item.permission);

              const link = (
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : "false"}
                  aria-label={
                    collapsed
                      ? `${item.label}${canManage ? "" : " (read-only)"}`
                      : item.label
                  }
                  className={cn(
                    "group relative flex items-center gap-2.5 rounded-lg text-[13px] font-medium transition-colors",
                    collapsed ? "h-9 justify-center" : "min-h-8 px-2 py-1",
                    active
                      ? "bg-card text-foreground shadow-[0_1px_2px_rgba(23,22,20,0.06)] ring-1 ring-sidebar-border/70"
                      : "text-muted-foreground hover:bg-card/60 hover:text-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-md transition-colors",
                      active
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground group-hover:text-foreground",
                    )}
                  >
                    <item.icon className="size-4" aria-hidden="true" />
                  </span>
                  {collapsed ? (
                    <span className="sr-only">{item.label}</span>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {!canManage ? (
                        <>
                          <Lock
                            className="size-3 shrink-0 text-muted-foreground/70"
                            aria-hidden="true"
                          />
                          <span className="sr-only">Read-only</span>
                        </>
                      ) : null}
                    </>
                  )}
                </Link>
              );

              if (!collapsed) {
                return <div key={item.href}>{link}</div>;
              }

              return (
                <Tooltip key={item.href}>
                  <TooltipTrigger asChild>{link}</TooltipTrigger>
                  <TooltipContent side="right">
                    {item.label}
                    {!canManage ? " · read-only" : ""}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}
