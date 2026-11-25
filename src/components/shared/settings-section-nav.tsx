"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

export type SettingsSection = {
  id: string;
  label: string;
};

/**
 * In-page navigation for the long settings screens.
 *
 * Links are plain anchors so they keep working before hydration. The effect
 * only adds the active marker, smooth scrolling and the scroll offset-aware
 * highlight; it never changes what a link does.
 */
export function SettingsSectionNav({ sections }: { sections: SettingsSection[] }) {
  const [active, setActive] = useState(sections[0]?.id ?? "");

  useEffect(() => {
    if (sections.length === 0) return;

    const root = document.documentElement;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduceMotion) root.style.scrollBehavior = "smooth";

    let frame = 0;

    const update = () => {
      frame = 0;
      let current = sections[0]?.id ?? "";

      // The dashboard header is sticky, so a section only becomes current once
      // its top has passed below the header rather than the viewport edge.
      for (const section of sections) {
        const element = document.getElementById(section.id);
        if (element && element.getBoundingClientRect().top <= 140) {
          current = section.id;
        }
      }

      if (window.innerHeight + window.scrollY >= root.scrollHeight - 2) {
        current = sections[sections.length - 1]?.id ?? current;
      }

      setActive(current);
    };

    const onScroll = () => {
      if (frame === 0) frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    window.addEventListener("hashchange", onScroll);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("hashchange", onScroll);
      root.style.scrollBehavior = "";
    };
  }, [sections]);

  return (
    <nav
      aria-label="Settings sections"
      className="min-w-0 max-w-full xl:sticky xl:top-20 xl:self-start"
    >
      <p className="hidden px-3 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground xl:block">
        On this page
      </p>
      <ul className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1 pb-1 xl:mx-0 xl:mt-2 xl:flex-col xl:overflow-visible xl:px-0 xl:pb-0">
        {sections.map((section) => {
          const current = active === section.id;
          return (
            <li key={section.id} className="shrink-0 xl:shrink">
              <a
                href={`#${section.id}`}
                aria-current={current ? "location" : undefined}
                onClick={() => setActive(section.id)}
                className={cn(
                  "flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  current
                    ? "bg-card text-foreground ring-1 ring-border/70"
                    : "text-muted-foreground hover:bg-card/60 hover:text-foreground",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-1.5 rounded-full transition-colors",
                    current ? "bg-primary" : "bg-border",
                  )}
                />
                {section.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
