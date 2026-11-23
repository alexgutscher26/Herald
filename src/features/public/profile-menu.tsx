"use client";

import { LogOut } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { usePublicI18n } from "./i18n/provider";
import type { PublicViewerIdentity } from "./viewer";

/**
 * Public account menu.
 *
 * Only the visitor's own name and email are shown, and only to that visitor.
 * The menu is a convenience: every write endpoint still resolves the session
 * itself, so hiding or forging this component grants nothing.
 */

async function revokeSession(): Promise<boolean> {
  try {
    const response = await fetch("/api/public/session/logout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function LogoutButton({
  label,
  variant = "outline",
}: {
  label?: string;
  variant?: "outline" | "ghost" | "default";
}) {
  const router = useRouter();
  const { t } = usePublicI18n();
  const [pending, setPending] = useState(false);

  async function signOut() {
    if (pending) return;
    setPending(true);
    const ok = await revokeSession();
    setPending(false);
    if (ok) {
      router.refresh();
    } else {
      toast.error(t("common.signOutError"));
    }
  }

  return (
    <Button
      type="button"
      variant={variant}
      size="sm"
      onClick={() => void signOut()}
      disabled={pending}
    >
      <LogOut aria-hidden="true" />
      {pending ? t("common.signingOut") : label ?? t("common.signOut")}
    </Button>
  );
}

export function ProfileMenu({
  viewer,
  loginHref,
}: {
  viewer: PublicViewerIdentity | null;
  loginHref: string;
}) {
  const router = useRouter();
  const { t } = usePublicI18n();
  const [pending, setPending] = useState(false);

  if (!viewer || !viewer.identified) {
    return (
      <Button asChild variant="outline" size="sm">
        <Link href={loginHref}>{t("common.signIn")}</Link>
      </Button>
    );
  }

  const label = viewer.name ?? viewer.email ?? t("profile.you");
  const initial = label.slice(0, 1).toUpperCase();

  async function signOut() {
    if (pending) return;
    setPending(true);
    const ok = await revokeSession();
    setPending(false);
    if (ok) {
      router.refresh();
    } else {
      toast.error(t("common.signOutError"));
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("header.accountMenu")}
          className="flex size-9 items-center justify-center rounded-full border bg-muted text-sm font-semibold text-foreground transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {initial}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="space-y-1">
          <span className="block truncate text-sm font-medium text-foreground">
            {label}
          </span>
          {viewer.email ? (
            <span className="block truncate text-xs font-normal text-muted-foreground">
              {viewer.email}
            </span>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => void signOut()}
          disabled={pending}
          className="gap-2"
        >
          <LogOut aria-hidden="true" />
          {pending ? t("common.signingOut") : t("common.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
