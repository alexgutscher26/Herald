"use client";

import { useEffect, useRef } from "react";

/**
 * Records which settings sections actually become visible.
 *
 * The tracker is deliberately dumb: it observes the server-owned section ids,
 * waits until a section has been visible for a moment, then posts the slug.
 * It never reads field values, text content or the URL, and it keeps a
 * session-scoped set so a re-render or a scroll back up does not inflate the
 * count. If `IntersectionObserver` is unavailable, it records nothing rather
 * than guessing.
 */

type Props = {
  workspaceSlug: string;
  surface: "workspace_settings" | "product_settings";
  sections: readonly string[];
  productSlug?: string;
};

const VISIBLE_MS = 800;
const SESSION_PREFIX = "herald.dashboard-view:";

function storageKey(surface: string, workspaceSlug: string): string {
  return `${SESSION_PREFIX}${surface}:${workspaceSlug}`;
}

function alreadySeen(key: string): Set<string> {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

function persist(key: string, seen: Set<string>): void {
  try {
    sessionStorage.setItem(key, JSON.stringify([...seen]));
  } catch {
    // Private mode or a full quota: losing the dedupe set only risks a dupe.
  }
}

export function DashboardViewBeacon({
  workspaceSlug,
  surface,
  sections,
  productSlug,
}: Props) {
  const sent = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (typeof IntersectionObserver !== "function") return;

    const key = storageKey(surface, workspaceSlug);
    sent.current = alreadySeen(key);

    const timers = new Map<string, number>();
    const targets = sections
      .map((section) => document.getElementById(section))
      .filter((element): element is HTMLElement => element !== null);

    if (targets.length === 0) return;

    const flush = (section: string) => {
      if (sent.current.has(section)) return;
      sent.current.add(section);
      persist(key, sent.current);

      const body: Record<string, unknown> = { surface, sections: [section] };
      if (surface === "product_settings" && productSlug) body.productSlug = productSlug;

      void fetch(
        `/api/app/${encodeURIComponent(workspaceSlug)}/dashboard-views`,
        {
          method: "POST",
          credentials: "same-origin",
          keepalive: true,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      ).catch(() => undefined);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const section = entry.target.id;
          if (entry.isIntersecting) {
            if (timers.has(section)) continue;
            const timer = window.setTimeout(() => {
              timers.delete(section);
              flush(section);
            }, VISIBLE_MS);
            timers.set(section, timer);
          } else {
            const timer = timers.get(section);
            if (timer !== undefined) {
              window.clearTimeout(timer);
              timers.delete(section);
            }
          }
        }
      },
      { threshold: 0.25 },
    );

    for (const target of targets) observer.observe(target);

    return () => {
      observer.disconnect();
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
    };
  }, [workspaceSlug, surface, sections, productSlug]);

  return null;
}
