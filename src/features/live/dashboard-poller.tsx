"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Keeps every dashboard section current without a manual reload.
 *
 * This follows the existing realtime contract: a visibility-guarded timer that
 * refreshes the server components instead of a socket. Conversation pages
 * already run their own poller, so they are left alone rather than refreshed
 * twice. A refresh is also skipped while a form field has focus or any dialog,
 * menu or select list is open, so typing and an in-progress choice are not
 * disturbed.
 */

const EDITING_SELECTOR =
  "input, textarea, select, [contenteditable='true']";

function hasOpenOverlay(): boolean {
  return Boolean(
    document.querySelector(
      "[role='dialog'][data-state='open'], [role='alertdialog'][data-state='open'], [role='listbox'], [role='menu']",
    ),
  );
}

function isEditing(): boolean {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.closest(EDITING_SELECTOR)) {
    return true;
  }
  return hasOpenOverlay();
}

export function DashboardLivePoller({
  intervalMs = 5000,
}: {
  intervalMs?: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const conversationRoute = pathname?.includes("/conversations") ?? false;

  useEffect(() => {
    if (conversationRoute) return;

    const refresh = () => {
      if (document.visibilityState !== "visible" || isEditing()) return;
      router.refresh();
    };

    const timer = window.setInterval(refresh, intervalMs);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refresh();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [conversationRoute, intervalMs, router]);

  return null;
}
