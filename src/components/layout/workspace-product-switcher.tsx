"use client";

import { Check, ChevronsUpDown, Layers, Plus } from "lucide-react";
import Link from "next/link";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getSwitcherWorkspaces } from "@/features/live/selectors";
import { useDashboard } from "@/features/live/store";
import { hasPermission } from "@/lib/permissions";
import { cn } from "@/lib/utils";

type WorkspaceProductSwitcherProps = {
  activeWorkspaceSlug: string;
  activeProductSlug: string;
  collapsed?: boolean;
};

export function WorkspaceProductSwitcher({
  activeWorkspaceSlug,
  activeProductSlug,
  collapsed = false,
}: WorkspaceProductSwitcherProps) {
  const { state } = useDashboard();
  const workspaces = getSwitcherWorkspaces(state);
  const activeWorkspace = workspaces.find((workspace) => workspace.slug === activeWorkspaceSlug);
  const activeProduct = activeWorkspace?.products.find(
    (product) => product.slug === activeProductSlug,
  );

  const trigger = (
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        aria-label="Switch workspace or product"
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg border border-sidebar-border bg-card/80 text-left text-sm shadow-[0_1px_2px_rgba(23,22,20,0.04)] transition-colors hover:border-[#cfc9bc] hover:bg-card focus-visible:ring-2 focus-visible:ring-ring",
          collapsed ? "justify-center px-0 py-2" : "px-2.5 py-2",
        )}
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Layers className="size-3.5" aria-hidden="true" />
        </span>
        {collapsed ? null : (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">
                {activeProduct?.name ?? "Select product"}
              </span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {activeWorkspace?.name ?? "Select workspace"}
              </span>
            </span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          </>
        )}
      </button>
    </DropdownMenuTrigger>
  );

  return (
    <DropdownMenu>
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent side="right">
            {activeWorkspace?.name ?? "Select workspace"} ·{" "}
            {activeProduct?.name ?? "Select product"}
          </TooltipContent>
        </Tooltip>
      ) : (
        trigger
      )}

      <DropdownMenuContent
        align="start"
        className="max-h-[min(70vh,30rem)] w-72 overflow-y-auto p-1.5"
      >
        {workspaces.length === 0 ? (
          <DropdownMenuLabel>No workspaces</DropdownMenuLabel>
        ) : (
          workspaces.map((workspace) => (
            <div key={workspace.id}>
              <DropdownMenuLabel className="flex items-center justify-between gap-2">
                <span className="truncate">{workspace.name}</span>
                <span className="rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] font-normal capitalize text-muted-foreground">
                  {workspace.role}
                </span>
              </DropdownMenuLabel>
              {workspace.products.map((product) => {
                const isActive =
                  workspace.slug === activeWorkspaceSlug && product.slug === activeProductSlug;
                return (
                  <DropdownMenuItem
                    key={product.id}
                    asChild
                    className={
                      isActive
                        ? "bg-primary/5 text-primary focus:bg-primary/10 focus:text-primary"
                        : undefined
                    }
                  >
                    <Link href={`/app/${workspace.slug}/${product.slug}`}>
                      <span className="truncate">{product.name}</span>
                      {isActive ? <Check className="ml-auto size-4" aria-hidden="true" /> : null}
                    </Link>
                  </DropdownMenuItem>
                );
              })}
              {workspace.products.length === 0 ? (
                <DropdownMenuLabel className="font-normal text-muted-foreground">
                  No products yet
                </DropdownMenuLabel>
              ) : null}
              {hasPermission(workspace.role, "product:create") ? (
                <DropdownMenuItem asChild>
                  <Link href={`/app/${workspace.slug}/settings#product`}>
                    <Plus className="size-4" aria-hidden="true" />
                    <span className="truncate">New product</span>
                  </Link>
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
            </div>
          ))
        )}
        <p className="px-2 pb-1 pt-2 text-[11px] leading-relaxed text-muted-foreground">
          Each workspace keeps its own products and data.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
