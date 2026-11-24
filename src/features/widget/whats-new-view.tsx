"use client";

import { Bell, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * The searchable changelog list shared by the widget's Updates panel.
 *
 * The list and search are client-side because every entry is already on the
 * page; there is no widget-only query. Entries open the real public changelog
 * entry in a new tab, so the iframe never needs to grow a second navigation.
 */

export type WhatsNewItem = {
  id: string;
  title: string;
  summary: string;
  categoryLabel: string;
  category: "feature" | "improvement" | "fix";
  dateLabel: string;
  href: string;
};

export function WidgetWhatsNewView({
  items,
  labels,
}: {
  items: WhatsNewItem[];
  labels: {
    search: string;
    noResults: string;
    emptyTitle: string;
    emptyBody: string;
  };
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;

    return items.filter(
      (item) =>
        item.title.toLowerCase().includes(needle) ||
        item.summary.toLowerCase().includes(needle),
    );
  }, [items, query]);

  return (
    <div className="space-y-2.5">
      <label className="flex items-center gap-2 rounded-xl border border-border/80 bg-card px-3 py-2 text-muted-foreground transition-all duration-200 focus-within:border-ring focus-within:bg-background focus-within:shadow-sm">
        <Search className="size-3.5 shrink-0" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={labels.search}
          aria-label={labels.search}
          className="w-full min-w-0 bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground"
        />
      </label>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card/50 px-4 py-8 text-center">
          <span className="mx-auto flex size-10 items-center justify-center rounded-full border text-muted-foreground">
            <Bell className="size-4" aria-hidden="true" />
          </span>
          <p className="mt-2.5 text-[13px] font-medium text-foreground">
            {query.trim() ? labels.noResults : labels.emptyTitle}
          </p>
          {query.trim() ? null : (
            <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
              {labels.emptyBody}
            </p>
          )}
        </div>
      ) : (
        <div className="widget-stagger overflow-hidden rounded-2xl border border-border/70 bg-card">
          {filtered.map((item, index) => (
            <article
              key={item.id}
              className={cn(
                "px-3.5 py-3 transition-colors duration-200 hover:bg-muted/30",
                index > 0 && "border-t border-border/70",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={cn(
                    "inline-flex rounded-full px-1.5 py-0.5 text-[9px] font-semibold",
                    item.category === "feature"
                      ? "bg-primary/10 text-primary"
                      : item.category === "improvement"
                        ? "bg-info-muted text-info"
                        : "bg-warning-muted text-warning",
                  )}
                >
                  {item.categoryLabel}
                </span>
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {item.dateLabel}
                </span>
              </div>
              <h3 className="mt-1.5 text-[12.5px] font-semibold leading-snug text-foreground">
                <a
                  href={item.href}
                  className="hover:text-primary hover:underline"
                >
                  {item.title}
                </a>
              </h3>
              {item.summary ? (
                <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                  {item.summary}
                </p>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
