"use client";

import {
  BookOpen,
  CornerDownLeft,
  Loader2,
  MessageSquare,
  MessagesSquare,
  Rocket,
  Search,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import { getNavItems } from "@/components/layout/nav-items";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { getRouteContext } from "@/features/live/selectors";
import { useDashboard } from "@/features/live/store";
import {
  isSearchableQuery,
  normalizeSearchQuery,
  type GlobalSearchGroup,
  type GlobalSearchKind,
} from "@/features/search/query";
import { hasPermission } from "@/lib/permissions";
import { cn } from "@/lib/utils";

type PaletteItem = {
  key: string;
  title: string;
  subtitle: string;
  href: string;
  icon: LucideIcon;
};

type PaletteSection = {
  label: string;
  items: PaletteItem[];
};

const SEARCH_ICONS: Record<GlobalSearchKind, LucideIcon> = {
  request: MessageSquare,
  conversation: MessagesSquare,
  release: Rocket,
  help: BookOpen,
  customer: UserRound,
};

/**
 * Command palette for navigation and cross-record search.
 *
 * Navigation is local and instant. Search is a debounced, authenticated request
 * to `/api/app/.../search`, which applies the same role checks as the pages the
 * results point at. No record data is cached in the browser.
 */
export function CommandPalette({
  workspaceSlug,
  productSlug,
}: {
  workspaceSlug: string;
  productSlug: string;
}) {
  const router = useRouter();
  const { state } = useDashboard();
  const context = getRouteContext(state, workspaceSlug, productSlug);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GlobalSearchGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [triggerNode, setTriggerNode] = useState<HTMLButtonElement | null>(null);
  const restoreFocusOnClose = useRef(false);

  const normalized = normalizeSearchQuery(query);
  const showResults = isSearchableQuery(normalized);

  const navItems = useMemo(() => {
    if (!context) return [];
    return getNavItems(workspaceSlug, productSlug)
      .filter((item) => hasPermission(context.role, item.permission))
      .map<PaletteItem>((item) => ({
        key: `nav:${item.href}`,
        title: item.label,
        subtitle: item.description,
        href: item.href,
        icon: item.icon,
      }));
  }, [context, workspaceSlug, productSlug]);

  const sections = useMemo<PaletteSection[]>(() => {
    const needle = normalized.toLowerCase();
    const navMatches = navItems
      .filter(
        (item) =>
          needle === "" ||
          item.title.toLowerCase().includes(needle) ||
          item.subtitle.toLowerCase().includes(needle),
      )
      .slice(0, needle === "" ? 10 : 4);

    const next: PaletteSection[] = [
      { label: needle === "" ? "Navigate" : "Go to", items: navMatches },
    ];

    if (showResults) {
      for (const group of results) {
        next.push({
          label: group.label,
          items: group.items.map((item) => ({
            key: `${group.kind}:${item.id}`,
            title: item.title,
            subtitle: item.subtitle,
            href: item.href,
            icon: SEARCH_ICONS[group.kind],
          })),
        });
      }
    }

    return next.filter((section) => section.items.length > 0);
  }, [navItems, normalized, results, showResults]);

  const flatItems = useMemo(
    () => sections.flatMap((section) => section.items),
    [sections],
  );

  useEffect(() => {
    if (open || !restoreFocusOnClose.current) return;
    restoreFocusOnClose.current = false;
    let frame = 0;
    let attempts = 0;
    const focusWhenReady = () => {
      attempts += 1;
      // The dialog keeps its focus trap and aria-hidden cleanup mounted
      // through the exit animation. Focusing before that finishes lets the
      // trap pull focus back, leaving focus on <body> once the portal unmounts.
      if (triggerNode && !document.querySelector('[role="dialog"]')) {
        triggerNode.focus();
        if (document.activeElement === triggerNode) return;
      }
      if (attempts < 90) frame = window.requestAnimationFrame(focusWhenReady);
    };
    frame = window.requestAnimationFrame(focusWhenReady);
    return () => window.cancelAnimationFrame(frame);
  }, [open, triggerNode]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      if (open) restoreFocusOnClose.current = true;
      setOpen(!open);
      setQuery("");
      setResults([]);
      setActiveIndex(0);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open || !showResults) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void (async () => {
        setLoading(true);
      try {
        const response = await fetch(
          `/api/app/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(
            productSlug,
          )}/search?q=${encodeURIComponent(normalized)}`,
          { signal: controller.signal, headers: { accept: "application/json" } },
        );
        if (!response.ok) throw new Error("Search failed");
        const data = (await response.json()) as { groups?: GlobalSearchGroup[] };
        setResults(Array.isArray(data.groups) ? data.groups : []);
        setActiveIndex(0);
      } catch {
        if (!controller.signal.aborted) setResults([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
      })();
    }, 180);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [normalized, open, productSlug, showResults, workspaceSlug]);

  function go(href: string): void {
    setOpen(false);
    setQuery("");
    setResults([]);
    setActiveIndex(0);
    router.push(href);
  }

  function handleInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => Math.min(flatItems.length - 1, current + 1));
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(0, current - 1));
    }
    if (event.key === "Enter") {
      const item = flatItems[activeIndex];
      if (!item) return;
      event.preventDefault();
      go(item.href);
    }
  }

  let itemIndex = -1;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) restoreFocusOnClose.current = true;
        setOpen(next);
        setQuery("");
        setResults([]);
        setActiveIndex(0);
      }}
    >
      <DialogTrigger asChild>
        <Button
          ref={setTriggerNode}
          type="button"
          variant="outline"
          size="sm"
          className="gap-2 text-muted-foreground"
          aria-label="Search (Command K)"
        >
          <Search aria-hidden="true" />
          <span className="hidden md:inline">Search</span>
          <kbd className="hidden rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground md:inline">
            ⌘K
          </kbd>
        </Button>
      </DialogTrigger>

      <DialogContent className="top-[12%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl">
          <DialogTitle className="sr-only">Search</DialogTitle>
          <DialogDescription className="sr-only">
            Search requests, conversations, releases, help articles and customers, or jump to a
            dashboard section.
          </DialogDescription>

          <div className="flex items-center gap-2 border-b px-3">
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <Input
              autoFocus
              value={query}
              onChange={(event) => {
                const value = event.target.value;
                setQuery(value);
                setActiveIndex(0);
                setResults([]);
                if (!isSearchableQuery(normalizeSearchQuery(value))) {
                  setLoading(false);
                }
              }}
              onKeyDown={handleInputKeyDown}
              placeholder="Search requests, releases, help, customers…"
              aria-label="Search workspace"
              role="combobox"
              aria-expanded="true"
              aria-controls="command-palette-results"
              aria-autocomplete="list"
              className="h-12 border-0 bg-transparent px-0 shadow-none focus-visible:outline-none focus-visible:ring-0"
            />
            {loading ? (
              <Loader2
                className="size-4 shrink-0 animate-spin text-muted-foreground"
                aria-label="Searching"
              />
            ) : (
              <kbd className="shrink-0 rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                Esc
              </kbd>
            )}
          </div>

          <div
            id="command-palette-results"
            role="listbox"
            aria-label="Search results"
            className="max-h-[min(60vh,420px)] overflow-y-auto p-2"
          >
            {sections.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                {loading
                  ? "Searching…"
                  : showResults
                    ? `No matches for “${normalized}”.`
                    : "Type at least two characters to search."}
              </p>
            ) : (
              sections.map((section) => (
                <div key={section.label} className="pb-1">
                  <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {section.label}
                  </p>
                  {section.items.map((item) => {
                    itemIndex += 1;
                    const index = itemIndex;
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        role="option"
                        aria-selected={activeIndex === index}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => go(item.href)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-md px-2 py-2 text-left",
                          activeIndex === index
                            ? "bg-accent text-accent-foreground"
                            : "text-foreground",
                        )}
                      >
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                          <Icon className="size-3.5" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{item.title}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {item.subtitle}
                          </span>
                        </span>
                        {activeIndex === index ? (
                          <CornerDownLeft
                            className="size-3.5 shrink-0 text-muted-foreground"
                            aria-hidden="true"
                          />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          <div className="flex items-center gap-3 border-t px-3 py-2 text-[11px] text-muted-foreground">
            <span>↑↓ move</span>
            <span aria-hidden="true">·</span>
            <span>↵ open</span>
            <span aria-hidden="true">·</span>
            <span>Esc close</span>
            <span className="ml-auto">⌘K</span>
          </div>
      </DialogContent>
    </Dialog>
  );
}
