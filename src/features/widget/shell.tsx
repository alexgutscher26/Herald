import {
  Bell,
  BookOpen,
  House,
  Megaphone,
  MessageCircle,
  MessagesSquare,
  type LucideIcon,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import type { PublicLocaleCode, Translate } from "@/features/public/i18n";
import { cn } from "@/lib/utils";

import { WidgetCloseButton } from "./frame-bridge";
import type { WidgetSection } from "./policy";
import {
  widgetEmbedHref,
  type WidgetPanelName,
  type WidgetQuery,
  type WidgetRoute,
} from "./paths";
import type { WidgetShell } from "./service";

/**
 * Chrome shared by every widget panel.
 *
 * The brand row and the bottom tab bar mirror the compact support widget
 * layout: the product is always identifiable, the primary destinations stay
 * one tap away, and the content between them is the only scrolling region.
 * Changelog and notifications stay reachable without adding a crowded second
 * row of text links.
 */

type WidgetTab = {
  key: WidgetPanelName;
  label: string;
  route: WidgetRoute;
  icon: LucideIcon;
};

export function WidgetTabBar({
  shell,
  active,
  sections,
  query,
  t,
}: {
  shell: WidgetShell;
  active: WidgetPanelName;
  sections: WidgetSection[];
  query: WidgetQuery;
  t: Translate;
}) {
  const items: WidgetTab[] = [
    {
      key: "home",
      label: t("widget.home"),
      route: { view: "home" },
      icon: House,
    },
  ];

  if (sections.includes("messages") && shell.panels.messages) {
    items.push({
      key: "messages",
      label: t("widget.messages"),
      route: { view: "messages" },
      icon: MessagesSquare,
    });
  }
  if (sections.includes("help") && shell.panels.help) {
    items.push({
      key: "help",
      label: t("widget.help"),
      route: { view: "help" },
      icon: BookOpen,
    });
  }
  if (sections.includes("feedback") && shell.panels.feedback) {
    items.push({
      key: "feedback",
      label: t("widget.feedback"),
      route: { view: "feedback", boardSlug: null },
      icon: MessageCircle,
    });
  }
  if (shell.panels.updates) {
    items.push({
      key: "updates",
      label: t("widget.updatesTab"),
      route: { view: "updates", slug: null },
      icon: Megaphone,
    });
  }

  return (
    <nav
      aria-label={t("widget.nav")}
      data-widget-chrome="tabs"
      className="shrink-0 border-t border-border/70 bg-card/70 px-1.5 pt-1"
    >
      <ul className="flex items-stretch">
        {items.map((item) => {
          const current = item.key === active;
          const Icon = item.icon;

          return (
            <li key={item.key} className="min-w-0 flex-1">
              <Link
                href={widgetEmbedHref(
                  shell.workspace.slug,
                  shell.product.slug,
                  item.route,
                  query,
                )}
                aria-current={current ? "page" : undefined}
                className="group flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-0.5 py-1.5 transition-transform duration-150 active:scale-[0.97]"
              >
                <span
                  className={cn(
                    "flex h-7 w-11 items-center justify-center rounded-full transition-[background-color,color,transform,box-shadow] duration-200 ease-out group-hover:-translate-y-0.5 group-active:scale-95",
                    current
                      ? "widget-tab-pop bg-foreground text-background shadow-sm"
                      : "text-muted-foreground group-hover:bg-muted group-hover:text-foreground",
                  )}
                >
                  <Icon
                    className="size-4"
                    strokeWidth={1.8}
                    aria-hidden="true"
                  />
                </span>
                <span
                  className={cn(
                    "w-full truncate text-center text-[10px] leading-none transition-colors duration-200",
                    current
                      ? "font-semibold text-foreground"
                      : "font-medium text-muted-foreground",
                  )}
                >
                  {item.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function WidgetChrome({
  shell,
  accentColor,
  accentForeground = "#ffffff",
  logoUrl = null,
  locale,
  t,
  active,
  routeKey,
  query,
  hostOrigin,
  sections,
  hideAttribution = false,
  focused = false,
  children,
}: {
  shell: WidgetShell;
  accentColor: string;
  accentForeground?: string;
  /** Plan-gated workspace logo; the product name already labels this row. */
  logoUrl?: string | null;
  locale: PublicLocaleCode;
  t: Translate;
  active: WidgetPanelName;
  /** Changes for every panel and detail route so its entrance can replay. */
  routeKey?: string;
  query: WidgetQuery;
  hostOrigin: string | null;
  sections: WidgetSection[];
  /** Paid-plan setting; the caller must pass the plan-gated value. */
  hideAttribution?: boolean;
  /** Full-panel surface for a single task, such as the feedback composer. */
  focused?: boolean;
  children: ReactNode;
}) {
  const initial =
    shell.product.name.trim().charAt(0).toUpperCase() || "H";

  return (
    <div className="widget-scrollbars-hidden flex h-full min-h-0 flex-col bg-background text-foreground">
      {focused ? null : (
        <header
          data-widget-chrome="header"
          className="flex shrink-0 items-center justify-between gap-3 px-4 pb-1.5 pt-3"
        >
          <div className="flex min-w-0 items-center gap-2.5">
            {logoUrl ? (
              <Image
                src={logoUrl}
                alt=""
                width={32}
                height={32}
                unoptimized
                className="size-8 shrink-0 rounded object-contain"
              />
            ) : (
              <span
                aria-hidden="true"
                className="flex size-8 shrink-0 items-center justify-center rounded-full text-[12px] font-bold"
                style={{ backgroundColor: accentColor, color: accentForeground }}
              >
                {initial}
              </span>
            )}
            <p className="truncate text-[15px] font-semibold tracking-tight">
              {shell.product.name}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            {shell.panels.notifications ? (
              <Link
                href={widgetEmbedHref(
                  shell.workspace.slug,
                  shell.product.slug,
                  { view: "notifications" },
                  query,
                )}
                aria-label={
                  shell.unread > 0
                    ? t("notifications.bellWithUnread", { count: shell.unread })
                    : t("notifications.title")
                }
                aria-current={active === "notifications" ? "page" : undefined}
                className={cn(
                  "group relative inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                  active === "notifications" && "bg-muted text-foreground",
                )}
              >
                <Bell
                  className="size-4 transition-transform duration-300 ease-out group-hover:-rotate-12"
                  aria-hidden="true"
                />
                {shell.unread > 0 ? (
                  <span
                    aria-hidden="true"
                    className="widget-badge-pop absolute right-1.5 top-1.5 size-1.5 rounded-full bg-primary ring-2 ring-background"
                  />
                ) : null}
              </Link>
            ) : null}
            <WidgetCloseButton
              hostOrigin={hostOrigin}
              label={t("widget.close")}
            />
          </div>
        </header>
      )}

      <main
        key={routeKey ?? active}
        id="public-main"
        tabIndex={-1}
        lang={locale}
        className="widget-panel-enter min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 py-2"
      >
        {children}
      </main>

      {focused ? null : (
        <WidgetTabBar
          shell={shell}
          active={active}
          sections={sections}
          query={query}
          t={t}
        />
      )}

      {/* `hideAttribution` is already gated by the workspace plan in
       * getPublicSite(), so a downgrade restores the footer automatically. */}
      {hideAttribution ? null : (
        <p className="shrink-0 pb-1.5 text-center text-[9.5px] leading-tight text-muted-foreground/80">
          {t("widget.poweredBy")}
        </p>
      )}
    </div>
  );
}

export function WidgetEmpty({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed bg-card p-5 text-center">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
        {body}
      </p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
