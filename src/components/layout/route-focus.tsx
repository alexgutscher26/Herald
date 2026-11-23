"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/** How long to wait for a streamed page heading before staying on `main`. */
const HEADING_WAIT_MS = 2_000;

/**
 * Move focus to the new page after a client-side route change.
 *
 * Next.js preserves the DOM and focus can otherwise remain on the link that
 * started the navigation. Focusing the page heading (or the main landmark when
 * there is no heading) tells a screen reader where it arrived without moving
 * focus on the first render or on query-string-only updates.
 *
 * A product page renders its skeleton immediately and streams the real content
 * behind a loading boundary, so the heading often does not exist yet when the
 * route commits. In that case focus lands on the main landmark and moves to
 * the heading when it arrives — but only while the landmark still holds focus,
 * so a visitor who has already moved on is never interrupted.
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

    let observer: MutationObserver | null = null;
    let timer: number | null = null;

    const focus = (target: HTMLElement) => {
      if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: false });
    };

    const frame = window.requestAnimationFrame(() => {
      const main = document.getElementById(mainId);
      if (!main) return;

      const heading = main.querySelector<HTMLElement>("h1");
      if (heading) {
        focus(heading);
        return;
      }

      focus(main);
      observer = new MutationObserver(() => {
        const streamed = main.querySelector<HTMLElement>("h1");
        if (!streamed || document.activeElement !== main) return;
        observer?.disconnect();
        observer = null;
        focus(streamed);
      });
      observer.observe(main, { childList: true, subtree: true });
      timer = window.setTimeout(() => {
        observer?.disconnect();
        observer = null;
      }, HEADING_WAIT_MS);
    });

    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [mainId, pathname]);

  return null;
}
