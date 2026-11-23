"use client";

import { Lightbulb, Menu, Newspaper } from "lucide-react";
import { useState } from "react";

import { SidebarNav } from "@/components/layout/sidebar-nav";
import { WorkspaceProductSwitcher } from "@/components/layout/workspace-product-switcher";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { WorkspaceRole } from "@/lib/permissions";

type MobileNavProps = {
  workspaceSlug: string;
  productSlug: string;
  role: WorkspaceRole;
};

export function MobileNav({ workspaceSlug, productSlug, role }: MobileNavProps) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
          <Menu aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="flex w-72 flex-col gap-4 border-sidebar-border bg-sidebar p-4">
        <SheetHeader className="space-y-3 pr-8 text-left">
          <SheetTitle className="flex items-center gap-2 text-[15px] font-semibold [font-family:var(--font-archivo)]">
            <span className="flex size-7 items-center justify-center rounded-lg border border-[#175236] bg-primary text-primary-foreground shadow-[0_1px_2px_rgba(23,22,20,0.12)]">
              <Newspaper className="size-3.5" aria-hidden="true" />
            </span>
            Herald
          </SheetTitle>
          <SheetDescription className="sr-only">Product navigation</SheetDescription>
          <WorkspaceProductSwitcher
            activeWorkspaceSlug={workspaceSlug}
            activeProductSlug={productSlug}
          />
        </SheetHeader>
        <div className="flex-1 overflow-y-auto">
          <SidebarNav
            workspaceSlug={workspaceSlug}
            productSlug={productSlug}
            role={role}
            onNavigate={() => setOpen(false)}
          />
        </div>
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
      </SheetContent>
    </Sheet>
  );
}
