"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Five-second polling for the dashboard inbox and thread.
 *
 * This is deliberately the first realtime step: no socket, no long-lived
 * connection to maintain, and nothing runs while the tab is hidden. When a
 * measured need appears (typing indicators, presence cursors) the same
 * visibility guard can gate an SSE subscription instead.
 */
export function ConversationPoller({ intervalMs = 5000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs, router]);

  return null;
}
