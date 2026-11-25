import { ArrowRight, ChevronRight, Gift, LifeBuoy, Map, MailPlus } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { ReleaseCover } from "@/components/shared/release-cover";
import { ReleaseCategoryBadge } from "@/components/shared/status-badge";
import type {
  PublicReleaseCategory,
  PublicReleaseCover,
} from "@/features/public/types";

/**
 * The widget Home screen.
 *
 * It is shared by the live iframe panel and the settings preview so the
 * preview cannot drift from the real design. Everything arranges its own
 * hrefs and labels, so the preview can point at in-panel tabs while the live
 * panel points at the embed routes.
 */

export type WidgetHomeActionIcon = "help" | "request" | "roadmap";

export type WidgetHomeAction = {
  href: string;
  label: string;
  icon: WidgetHomeActionIcon;
};

export type WidgetHomeLatestUpdate = {
  id: string;
  href: string;
  title: string;
  summary: string;
  category: PublicReleaseCategory;
  cover: PublicReleaseCover;
  dateLabel: string;
};

export type WidgetHomeMoreUpdate = {
  id: string;
  href: string;
  title: string;
};

export type WidgetHomeMessage = {
  href: string;
  title: string;
  body: string;
  placeholder: string;
};

export type WidgetHomeLabels = {
  latestUpdate: string;
  viewAllUpdates: string;
  emptyTitle: string;
  emptyBody: string;
};

const ACTION_ICONS = {
  help: LifeBuoy,
  request: MailPlus,
  roadmap: Map,
} as const;

export function WidgetHomeView({
  productInitial,
  logoUrl = null,
  accentColor,
  accentForeground,
  greeting,
  title,
  message,
  actions,
  latestUpdate,
  moreUpdates,
  updatesHref,
  labels,
  updatesEnabled,
}: {
  productInitial: string;
  /** Plan-gated workspace logo; falls back to the product initial. */
  logoUrl?: string | null;
  accentColor: string;
  accentForeground: string;
  greeting: string;
  title: string;
  message: WidgetHomeMessage | null;
  actions: WidgetHomeAction[];
  latestUpdate: WidgetHomeLatestUpdate | null;
  moreUpdates: WidgetHomeMoreUpdate[];
  updatesHref: string;
  labels: WidgetHomeLabels;
  updatesEnabled: boolean;
}) {
  return (
    <div className="widget-stagger space-y-4 pb-1">
      <section className="pt-1">
        <h1 className="text-[26px] font-semibold leading-[1.06] tracking-[-0.03em]">
          {greeting} <span aria-hidden="true">👋</span>
        </h1>
        <p className="mt-1 break-words text-[23px] font-semibold leading-[1.12] tracking-[-0.025em] text-muted-foreground">
          {title}
        </p>
      </section>

      {message ? (
        <Link
          href={message.href}
          className="group block rounded-[20px] border border-border/70 bg-card p-4 transition-[transform,border-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
        >
          <div className="flex items-center gap-3">
            {logoUrl ? (
              <Image
                src={logoUrl}
                alt=""
                width={36}
                height={36}
                unoptimized
                className="size-9 shrink-0 rounded object-contain transition-transform duration-300 ease-out group-hover:scale-105"
              />
            ) : (
              <span
                aria-hidden="true"
                className="flex size-9 shrink-0 items-center justify-center rounded-full text-[12px] font-bold transition-transform duration-300 ease-out group-hover:scale-105"
                style={{
                  backgroundColor: accentColor,
                  color: accentForeground,
                }}
              >
                {productInitial}
              </span>
            )}
            <div className="min-w-0">
              <p className="text-[15px] font-semibold leading-tight">
                {message.title}
              </p>
              <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
                {message.body}
              </p>
            </div>
          </div>
          <span className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-background px-3.5 py-2.5 text-[12.5px] text-muted-foreground ring-1 ring-border/70 transition-colors group-hover:ring-primary/30">
            <span className="truncate">{message.placeholder}</span>
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-transform duration-200 ease-out group-hover:translate-x-0.5">
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </span>
          </span>
        </Link>
      ) : null}

      {actions.length > 0 ? (
        <ul className="space-y-2">
          {actions.map((action) => {
            const Icon = ACTION_ICONS[action.icon];

            return (
              <li key={action.icon}>
                <Link
                  href={action.href}
                  className="group flex min-h-12 items-center gap-3 rounded-[16px] border border-border/70 bg-card px-4 py-2.5 transition-[transform,border-color,background-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-primary/40 hover:bg-muted/20"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-foreground transition-transform duration-200 ease-out group-hover:scale-110">
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1 text-[13px] font-semibold">
                    {action.label}
                  </span>
                  <ChevronRight
                    className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-out group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}

      {updatesEnabled ? (
        <section aria-labelledby="widget-latest-update">
          <div className="flex items-center justify-between gap-2">
            <h2
              id="widget-latest-update"
              className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground"
            >
              <Gift className="size-3.5" aria-hidden="true" />
              {labels.latestUpdate}
            </h2>
            <Link
              href={updatesHref}
              className="group inline-flex items-center gap-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {labels.viewAllUpdates}
              <ChevronRight
                className="size-3 transition-transform duration-200 ease-out group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </Link>
          </div>

          {latestUpdate ? (
            <>
              <Link
                href={latestUpdate.href}
                className="group mt-2 block overflow-hidden rounded-[20px] border border-border/70 bg-card transition-[transform,border-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
              >
                <div className="p-2 pb-0">
                  <div className="overflow-hidden rounded-xl border border-border/60 bg-background transition-transform duration-300 ease-out group-hover:scale-[1.015]">
                    <div
                      aria-hidden="true"
                      className="flex h-6 items-center gap-1 border-b border-border/60 bg-muted/50 px-2"
                    >
                      <span className="size-1.5 rounded-full bg-destructive/50" />
                      <span className="size-1.5 rounded-full bg-warning/60" />
                      <span className="size-1.5 rounded-full bg-success/60" />
                    </div>
                    <ReleaseCover
                      cover={latestUpdate.cover}
                      accentColor={accentColor}
                      productInitial={productInitial}
                      className="h-24 w-full"
                    />
                  </div>
                </div>
                <div className="p-3.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <ReleaseCategoryBadge category={latestUpdate.category} />
                    <span className="text-[10.5px] text-muted-foreground">
                      {latestUpdate.dateLabel}
                    </span>
                  </div>
                  <h3 className="mt-1.5 break-words text-[13.5px] font-semibold leading-snug">
                    {latestUpdate.title}
                  </h3>
                  {latestUpdate.summary ? (
                    <p className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-muted-foreground">
                      {latestUpdate.summary}
                    </p>
                  ) : null}
                </div>
              </Link>

              {moreUpdates.length > 0 ? (
                <ul className="mt-2 overflow-hidden rounded-[16px] border border-border/70 bg-card">
                  {moreUpdates.map((entry) => (
                    <li
                      key={entry.id}
                      className="border-b border-border/70 last:border-b-0"
                    >
                      <Link
                        href={entry.href}
                        className="group flex items-center gap-2 px-3.5 py-2.5 text-[12px] font-medium transition-colors hover:bg-muted/40"
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {entry.title}
                        </span>
                        <ChevronRight
                          className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-out group-hover:translate-x-0.5"
                          aria-hidden="true"
                        />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <div className="mt-2 rounded-2xl border border-dashed bg-card p-5 text-center">
              <h2 className="text-sm font-semibold text-foreground">
                {labels.emptyTitle}
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {labels.emptyBody}
              </p>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
