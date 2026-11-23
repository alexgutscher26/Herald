"use client";

import { ChevronsUpDown, LogOut, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getEffectiveRole } from "@/features/live/selectors";
import { useDashboard } from "@/features/live/store";
import { authClient } from "@/lib/auth-client";
import type { WorkspaceRole } from "@/lib/permissions";

type AccountMenuProps = {
  workspaceId: string;
};

function initials(name: string, email: string): string {
  const source = name.trim() || email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const second = parts[1]?.[0] ?? "";
  return (first + second).toUpperCase() || "?";
}

const ROLE_LABELS: Record<WorkspaceRole, string> = {
  owner: "Owner",
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer (free)",
};

/** The signed-in account and its role in the active workspace. */
export function AccountMenu({ workspaceId }: AccountMenuProps) {
  const router = useRouter();
  const { state } = useDashboard();
  const [signingOut, setSigningOut] = useState(false);
  const role = getEffectiveRole(state, workspaceId);

  async function signOut() {
    setSigningOut(true);
    try {
      const result = await authClient.signOut();
      if (result.error) {
        toast.error("Could not sign out", { description: result.error.message });
        return;
      }
      router.replace("/sign-in");
      router.refresh();
    } catch (error) {
      toast.error("Could not sign out", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 gap-2 px-1.5" aria-label="Account menu">
          <Avatar className="size-7 border border-[#d8d5ce]">
            <AvatarFallback className="bg-[#e4efe6] text-[11px] font-semibold text-[#1f6b45]">
              {initials(state.currentUser.name, state.currentUser.email)}
            </AvatarFallback>
          </Avatar>
          <span className="hidden max-w-36 truncate text-sm md:inline">{state.currentUser.name}</span>
          <ChevronsUpDown className="hidden size-3.5 text-muted-foreground md:inline" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-normal">
          <span className="block truncate font-medium">{state.currentUser.name}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {state.currentUser.email}
          </span>
          <span className="mt-1 inline-block rounded border bg-info-muted px-1.5 py-0.5 text-[10px] font-medium text-info">
            Signed in · database-backed
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/app/account">
            <UserRound aria-hidden="true" />
            Account settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Role</DropdownMenuLabel>
        <p className="px-2 pb-1 text-[11px] leading-relaxed text-muted-foreground">
          Signed in as {ROLE_LABELS[role]}. Server actions re-check this role on every write.
        </p>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()} disabled={signingOut}>
          <LogOut aria-hidden="true" />
          {signingOut ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
