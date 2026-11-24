"use client";

import {
  ArrowUp,
  Check,
  MessageCircle,
  Minus,
  Plus,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import type { PublicFeedbackStatus } from "@/features/public/types";
import { cn } from "@/lib/utils";

/**
 * Feedback index for the widget.
 *
 * Requests are already on the page, so search, ordering and status filters
 * stay client-side and the iframe never needs a second route. Each row opens
 * the real request panel; submitting goes to the existing compose route.
 */

export type WidgetFeedbackRow = {
  id: string;
  title: string;
  body: string;
  authorName: string;
  status: PublicFeedbackStatus;
  voteCount: number;
  votesAria: string;
  createdAt: string;
  href: string;
};

export type WidgetFeedbackLabels = {
  title: string;
  search: string;
  noResults: string;
  noMatches: string;
  searchHint: string;
  filterHint: string;
  filters: string;
  sortSection: string;
  statusSection: string;
  sortTop: string;
  sortNew: string;
  sortTrending: string;
  statuses: Record<PublicFeedbackStatus, string>;
  submit: string;
  list: string;
  emptyTitle: string;
  emptyBody: string;
};

type FeedbackSort = "top" | "new" | "trending";

const FEEDBACK_STATUSES: PublicFeedbackStatus[] = [
  "open",
  "under_review",
  "planned",
  "in_progress",
  "shipped",
  "closed",
];

const STATUS_COLORS: Record<PublicFeedbackStatus, string> = {
  open: "#eab308",
  under_review: "#f97316",
  planned: "#3b82f6",
  in_progress: "#8b5cf6",
  shipped: "#22c55e",
  closed: "#9ca3af",
};

const AVATAR_TONES = [
  "#6366f1",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ec4899",
  "#8b5cf6",
];

function avatarTone(name: string): string {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) | 0;
  }
  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length]!;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return "?";
  return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}

function Avatar({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const tone = avatarTone(name);

  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-semibold",
        className,
      )}
      style={{ backgroundColor: `${tone}26`, color: tone }}
    >
      {initials(name)}
    </span>
  );
}

/**
 * The status marks in the filter panel: an outlined ring for open work, a
 * filled green check for completed, and a filled grey mark for closed.
 */
function StatusGlyph({ status }: { status: PublicFeedbackStatus }) {
  if (status === "shipped") {
    return (
      <span
        aria-hidden="true"
        className="flex size-[18px] shrink-0 items-center justify-center rounded-full bg-[#22c55e] text-white"
      >
        <Check className="size-3" strokeWidth={3} />
      </span>
    );
  }

  if (status === "closed") {
    return (
      <span
        aria-hidden="true"
        className="flex size-[18px] shrink-0 items-center justify-center rounded-full bg-muted-foreground/60 text-background"
      >
        <Minus className="size-3" strokeWidth={3} />
      </span>
    );
  }

  const color = STATUS_COLORS[status];

  return (
    <span
      aria-hidden="true"
      className="flex size-[18px] shrink-0 items-center justify-center rounded-full border-2"
      style={{ borderColor: color }}
    >
      {status === "open" ? null : (
        <span
          className="h-[2px] w-[7px] rounded-full"
          style={{ backgroundColor: color }}
        />
      )}
    </span>
  );
}

function trendingScore(row: WidgetFeedbackRow): number {
  const ageDays = Math.max(
    0,
    (Date.now() - Date.parse(row.createdAt)) / 86_400_000,
  );
  return (row.voteCount + 1) / Math.pow(ageDays + 2, 0.65);
}

export function WidgetFeedbackView({
  rows,
  labels,
  submitHref,
  locale,
}: {
  rows: WidgetFeedbackRow[];
  labels: WidgetFeedbackLabels;
  submitHref: string;
  locale: string;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<FeedbackSort>("top");
  const [statuses, setStatuses] = useState<Set<PublicFeedbackStatus>>(
    () => new Set(FEEDBACK_STATUSES),
  );
  const [menuOpen, setMenuOpen] = useState(false);

  const needle = query.trim().toLowerCase();

  const visible = useMemo(() => {
    const matches = rows.filter((row) => {
      if (!statuses.has(row.status)) return false;
      if (!needle) return true;
      return `${row.title}\n${row.body}\n${row.authorName}`
        .toLowerCase()
        .includes(needle);
    });

    return [...matches].sort((a, b) => {
      if (sort === "new") {
        return Date.parse(b.createdAt) - Date.parse(a.createdAt);
      }
      if (sort === "trending") {
        return (
          trendingScore(b) - trendingScore(a) ||
          Date.parse(b.createdAt) - Date.parse(a.createdAt)
        );
      }
      return (
        b.voteCount - a.voteCount ||
        Date.parse(b.createdAt) - Date.parse(a.createdAt)
      );
    });
  }, [rows, needle, sort, statuses]);

  const numberFormat = useMemo(() => new Intl.NumberFormat(locale), [locale]);

  const sortOptions: { id: FeedbackSort; label: string }[] = [
    { id: "top", label: labels.sortTop },
    { id: "new", label: labels.sortNew },
    { id: "trending", label: labels.sortTrending },
  ];

  function toggleStatus(status: PublicFeedbackStatus) {
    setStatuses((current) => {
      const next = new Set(current);
      if (next.has(status)) {
        next.delete(status);
      } else {
        next.add(status);
      }
      return next;
    });
  }

  const emptyTitle =
    rows.length === 0
      ? labels.emptyTitle
      : needle
        ? labels.noResults
        : labels.noMatches;
  const emptyBody =
    rows.length === 0
      ? labels.emptyBody
      : needle
        ? labels.searchHint
        : labels.filterHint;

  return (
    <div className="flex min-h-full flex-col pb-1">
      <div className="flex items-start justify-between gap-3 pt-1">
        <h1 className="text-[28px] font-semibold leading-[1.05] tracking-[-0.035em]">
          {labels.title}
        </h1>

        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label={labels.filters}
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            className={cn(
              "flex size-10 items-center justify-center rounded-full transition-colors duration-200 hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              menuOpen ? "bg-muted text-foreground" : "bg-muted/60 text-foreground",
            )}
          >
            <SlidersHorizontal
              className="size-[18px]"
              strokeWidth={1.8}
              aria-hidden="true"
            />
          </button>

          {menuOpen ? (
            <div
              role="dialog"
              aria-label={labels.filters}
              onKeyDown={(event) => {
                if (event.key === "Escape") setMenuOpen(false);
              }}
              className="absolute right-0 top-full z-30 mt-2 max-h-[calc(100dvh-16rem)] w-[min(21rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-border/80 bg-card p-1 shadow-2xl"
            >
              <p className="px-3 pb-1 pt-3 text-[12px] font-medium text-muted-foreground">
                {labels.sortSection}
              </p>
              {sortOptions.map((option) => {
                const selected = sort === option.id;

                return (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setSort(option.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-[13.5px] transition-colors hover:bg-muted",
                      selected
                        ? "font-semibold text-foreground"
                        : "text-foreground/90",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {option.label}
                    </span>
                    {selected ? (
                      <Check
                        className="size-4 shrink-0 text-foreground"
                        aria-hidden="true"
                      />
                    ) : null}
                  </button>
                );
              })}

              <div className="my-1.5 h-px bg-border/70" />

              <p className="px-3 pb-1 pt-2 text-[12px] font-medium text-muted-foreground">
                {labels.statusSection}
              </p>
              {FEEDBACK_STATUSES.map((status) => {
                const selected = statuses.has(status);

                return (
                  <button
                    key={status}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleStatus(status)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13.5px] transition-colors hover:bg-muted",
                      selected
                        ? "font-semibold text-foreground"
                        : "text-foreground/90",
                    )}
                  >
                    <StatusGlyph status={status} />
                    <span className="min-w-0 flex-1 truncate">
                      {labels.statuses[status]}
                    </span>
                    {selected ? (
                      <Check
                        className="size-4 shrink-0 text-foreground"
                        aria-hidden="true"
                      />
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      <label className="mt-4 flex h-12 items-center gap-2.5 rounded-2xl bg-muted/60 px-4 text-muted-foreground ring-1 ring-transparent transition-[background-color,box-shadow] duration-200 focus-within:bg-muted focus-within:ring-border">
        <Search className="size-4 shrink-0" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={labels.search}
          aria-label={labels.search}
          className="w-full min-w-0 bg-transparent text-[13.5px] text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
        />
      </label>

      {rows.length === 0 || visible.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-border/80 bg-card/50 px-4 py-9 text-center">
          <span className="mx-auto flex size-10 items-center justify-center rounded-full border text-muted-foreground">
            <MessageCircle className="size-4" aria-hidden="true" />
          </span>
          <p className="mt-2.5 text-[13px] font-medium text-foreground">
            {emptyTitle}
          </p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
            {emptyBody}
          </p>
        </div>
      ) : (
        <ul aria-label={labels.list} className="mt-1">
          {visible.map((row) => (
            <li
              key={row.id}
              className="border-b border-border/60 last:border-b-0"
            >
              <Link
                href={row.href}
                className="group flex items-start gap-3 py-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <Avatar
                  name={row.authorName}
                  className="size-[42px] text-[13px]"
                />

                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14.5px] font-semibold leading-snug transition-colors duration-200 group-hover:text-primary">
                    {row.title}
                  </p>
                  {row.body.trim() ? (
                    <p className="mt-0.5 line-clamp-1 text-[12.5px] leading-relaxed text-muted-foreground">
                      {row.body}
                    </p>
                  ) : null}
                  <span className="mt-2 flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted-foreground">
                    <Avatar
                      name={row.authorName}
                      className="size-4 text-[7px]"
                    />
                    <span className="truncate">{row.authorName}</span>
                  </span>
                </div>

                <span
                  aria-label={row.votesAria}
                  className="mt-0.5 flex h-8 shrink-0 items-center gap-1 rounded-full border border-border/80 px-2.5 text-[12.5px] font-medium tabular-nums text-muted-foreground transition-colors duration-200 group-hover:border-foreground/20 group-hover:text-foreground"
                >
                  <ArrowUp className="size-3.5" aria-hidden="true" />
                  {numberFormat.format(row.voteCount)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="sticky bottom-0 z-10 -mx-4 mt-auto flex justify-center bg-gradient-to-t from-background via-background/95 to-transparent px-4 pb-1 pt-8">
        <Link
          href={submitHref}
          className="inline-flex min-h-11 items-center gap-2 rounded-full bg-foreground px-5 text-[13px] font-semibold text-background shadow-[0_12px_30px_-12px_rgba(0,0,0,0.55)] transition-transform duration-200 ease-out hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-[0.98]"
        >
          <Plus className="size-4" strokeWidth={2.4} aria-hidden="true" />
          {labels.submit}
        </Link>
      </div>
    </div>
  );
}
