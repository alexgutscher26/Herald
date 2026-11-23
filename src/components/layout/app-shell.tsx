"use client";

import { Lightbulb, Newspaper, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";

import { AccountMenu } from "@/components/layout/account-menu";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { CommandPalette } from "@/components/layout/command-palette";
import { MobileNav } from "@/components/layout/mobile-nav";
import { RouteFocusManager } from "@/components/layout/route-focus";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { WorkspaceProductSwitcher } from "@/components/layout/workspace-product-switcher";
import {
  ShortcutHelpButton,
  ShortcutProvider,
} from "@/components/shared/keyboard-shortcuts";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { LiveAnnouncerProvider } from "@/features/accessibility/live-announcer";
import { DashboardLivePoller } from "@/features/live/dashboard-poller";
import { getRouteContext } from "@/features/live/selectors";
import { useDashboard } from "@/features/live/store";
import { cn } from "@/lib/utils";

type AppShellProps = {
  workspaceSlug: string;
  productSlug: string;
  children: ReactNode;
};

/**
 * Persistent product shell.
 *
 * Renders the database snapshot loaded by the server layout. Every write is
 * re-checked by a server action, which is the real authorization boundary.
 */
export function AppShell({ workspaceSlug, productSlug, children }: AppShellProps) {
  const { state } = useDashboard();
  const context = getRouteContext(state, workspaceSlug, productSlug);
  const [collapsed, setCollapsed] = useState(false);

  function toggleSidebar() {
    setCollapsed((current) => !current);
  }

  if (!context) {
    return <main className="p-8">This product is not available to this account.</main>;
  }

  const { workspace, product, role } = context;
  const base = `/app/${workspace.slug}/${product.slug}`;

  const collapseButton = (
    <Button
      type="button"
      variant="ghost"
      size={collapsed ? "icon" : "sm"}
      onClick={toggleSidebar}
      className={cn(
        "w-full text-muted-foreground hover:bg-card/70 hover:text-foreground",
        collapsed ? "" : "justify-start",
      )}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      aria-pressed={collapsed}
    >
      {collapsed ? (
        <PanelLeftOpen aria-hidden="true" />
      ) : (
        <>
          <PanelLeftClose aria-hidden="true" />
          Collapse sidebar
        </>
      )}
    </Button>
  );

  return (
    <ShortcutProvider base={base}>
      <LiveAnnouncerProvider>
      <TooltipProvider delayDuration={180}>
      <DashboardLivePoller />
      <RouteFocusManager />
      <a
        href="#dashboard-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
      >
        Skip to content
      </a>

      <div data-dashboard className="flex min-h-screen w-full bg-background">
        <aside
          className={cn(
            "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-150 lg:flex",
            collapsed ? "w-16" : "w-64",
          )}
        >
          <div
            className={cn(
              "flex h-16 shrink-0 items-center gap-2 border-b border-sidebar-border",
              collapsed ? "justify-center px-2" : "px-3",
            )}
          >
            <Link
              href={base}
              className="flex min-w-0 items-center gap-2 rounded-md font-semibold tracking-tight transition-opacity hover:opacity-80 [font-family:var(--font-archivo)]"
              aria-label="Herald dashboard home"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-[#175236] bg-primary text-primary-foreground shadow-[0_1px_2px_rgba(23,22,20,0.12)]">
                <Newspaper className="size-4" aria-hidden="true" />
              </span>
              {collapsed ? null : (
                <span className="min-w-0">
                  <span className="block truncate text-[15px] leading-tight">Herald</span>
                  <span className="block truncate text-[10px] font-normal leading-tight text-muted-foreground">
                    Changelog & customer loops
                  </span>
                </span>
              )}
            </Link>
          </div>

          <div className={cn("shrink-0", collapsed ? "px-2 py-3" : "px-3 py-3")}>
            <WorkspaceProductSwitcher
              activeWorkspaceSlug={workspace.slug}
              activeProductSlug={product.slug}
              collapsed={collapsed}
            />
          </div>

          <div
            className={cn(
              "min-h-0 flex-1 overflow-y-auto overscroll-contain py-3 pb-4 [scrollbar-color:var(--sidebar-border)_transparent] [scrollbar-width:thin]",
              collapsed ? "px-2" : "px-3",
            )}
          >
            <SidebarNav
              workspaceSlug={workspace.slug}
              productSlug={product.slug}
              role={role}
              collapsed={collapsed}
            />
          </div>

          <div className="shrink-0 space-y-2 border-t border-sidebar-border/80 p-2">
            {collapsed ? null : (
              <div className="rounded-lg border border-sidebar-border/80 bg-card/60 p-3">
                <div className="flex items-center gap-2 text-[11px] font-semibold text-foreground">
                  <span className="flex size-5 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Lightbulb className="size-3" aria-hidden="true" />
                  </span>
                  Connect the loop
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                  Link feedback to a release. Publishing marks those requests as shipped.
                </p>
              </div>
            )}
            {collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>{collapseButton}</TooltipTrigger>
                <TooltipContent side="right">Expand sidebar</TooltipContent>
              </Tooltip>
            ) : (
              collapseButton
            )}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b border-border bg-background/90 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-5">
            <MobileNav workspaceSlug={workspace.slug} productSlug={product.slug} role={role} />
            <div className="min-w-0 flex-1">
              <Breadcrumbs
                workspaceSlug={workspace.slug}
                workspaceName={workspace.name}
                productSlug={product.slug}
                productName={product.name}
              />
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <CommandPalette workspaceSlug={workspace.slug} productSlug={product.slug} />
              <ThemeToggle />
              <ShortcutHelpButton />
              <AccountMenu workspaceId={workspace.id} />
            </div>
          </header>

          <main
            id="dashboard-content"
            tabIndex={-1}
            className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-7"
          >
            {children}
          </main>
        </div>
        </div>
      </TooltipProvider>
      </LiveAnnouncerProvider>
    </ShortcutProvider>
  );
}
