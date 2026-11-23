"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Move focus to the new page after a client-side route change.
 *
 * Next.js preserves the DOM and focus can otherwise remain on the link that
 * started the navigation. Focusing the page heading (or the main landmark when
 * there is no heading) tells a screen reader where it arrived without moving
 * focus on the first render or on query-string-only updates.
 */
export function RouteFocusManager({ mainId = "dashboard-content" }: { mainId?: string }) {
  const pathname = usePathname();
  const previous = useRef<string | null>(null);

  useEffect(() => {
    if (previous.current === null) {
      previous.current = pathname;
      return;
    }
    if (previous.current === pathname) return;
    previous.current = pathname;

    const frame = window.requestAnimationFrame(() => {
      const main = document.getElementById(mainId);
      if (!main) return;
      const heading = main.querySelector<HTMLElement>("h1");
      const target = heading ?? main;
      if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: false });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [mainId, pathname]);

  return null;
}
